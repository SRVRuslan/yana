const REVIEW_ENDPOINT = '/api/reviews';
const FORM_CONFIG_ENDPOINT = '/api/form-config';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_REQUEST_BYTES = 16_384;

const ALLOWED_SERVICES = new Set([
  'Residential cleaning',
  'Commercial cleaning',
  'Move-in / move-out cleaning',
  'Airbnb cleaning',
  'Professional carpet care',
  'Post-construction cleaning',
]);

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === FORM_CONFIG_ENDPOINT) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
    }

    if (url.pathname === REVIEW_ENDPOINT) {
      return handleReview(request, env, url);
    }

    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

async function handleReview(request, env, url) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) return error('This form can only be submitted from this website.', 403);
    } catch {
      return error('Invalid request origin.', 403);
    }
  }

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return error('Please send the form as JSON.', 415);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return error('The form is too large.', 413);

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return error('The form could not be read.', 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return error('The form is too large.', 413);

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return error('The form contains invalid data.', 400);
  }

  // Quietly accept bot submissions caught by the honeypot without sending email.
  if (clean(input.website, 200)) return json({ ok: true, message: 'Thank you. Your review has been received.' });

  const review = validateReview(input);
  if (!review.ok) return error(review.message, 400);

  const missingConfiguration = ['TURNSTILE_SECRET_KEY', 'EMAIL_FROM', 'EMAIL_TO']
    .filter((key) => !env[key]);
  if (missingConfiguration.length || !env.NOTIFY_OWNER) {
    console.error('Review form configuration is incomplete:', missingConfiguration.join(', ') || 'NOTIFY_OWNER binding');
    return error('The review form is temporarily unavailable. Please email care.cleanyyc@outlook.com.', 503);
  }

  const turnstile = await verifyTurnstile(review.value.turnstileToken, request, env);
  if (!turnstile.ok) return error(turnstile.message, 400);

  const submittedAt = new Date().toISOString();
  const email = buildNotification(review.value, submittedAt);

  try {
    await env.NOTIFY_OWNER.send({
      from: { email: env.EMAIL_FROM, name: 'Care & Clean website' },
      to: env.EMAIL_TO,
      replyTo: { email: review.value.email, name: review.value.name },
      subject: `New ${review.value.rating}-star client review from ${review.value.name}`,
      text: email.text,
      html: email.html,
    });
  } catch (sendError) {
    console.error('Review notification email failed:', sendError);
    return error('We could not send your review right now. Please try again or email care.cleanyyc@outlook.com.', 502);
  }

  if (env.ENABLE_AUTOREPLY === 'true' && env.EMAIL) {
    try {
      await env.EMAIL.send({
        from: { email: env.EMAIL_AUTOREPLY_FROM || env.EMAIL_FROM, name: 'Care & Clean Home Inc.' },
        to: review.value.email,
        subject: 'We received your request — Care & Clean Home Inc.',
        text: `Hi ${review.value.name},\n\nThank you for contacting Care & Clean Home Inc. We have received your request and will get back to you shortly.\n\nCare & Clean Home Inc.\nCalgary, Alberta\n+1 (403) 667-4392`,
        html: `<p>Hi ${escapeHtml(review.value.name)},</p><p>Thank you for contacting Care &amp; Clean Home Inc. We have received your request and will get back to you shortly.</p><p>Care &amp; Clean Home Inc.<br>Calgary, Alberta<br><a href="tel:+14036674392">+1 (403) 667-4392</a></p>`,
      });
    } catch (sendError) {
      // The client submission is still successful if only the optional acknowledgement fails.
      console.error('Review acknowledgement email failed:', sendError);
    }
  }

  return json({ ok: true, message: 'Thank you. Your review has been sent to Care & Clean for verification.' });
}

function validateReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'The form contains invalid data.' };
  }

  const name = clean(input.name, 60);
  const emailAddress = clean(input.email, 120).toLowerCase();
  const service = clean(input.service, 80);
  const visitDate = clean(input.visitDate, 7);
  const review = clean(input.review, 1000);
  const turnstileToken = clean(input.turnstileToken, 2048);
  const rating = Number(input.rating);

  if (name.length < 2) return { ok: false, message: 'Please enter your first name.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) return { ok: false, message: 'Please enter a valid email address.' };
  if (!ALLOWED_SERVICES.has(service)) return { ok: false, message: 'Please choose a service.' };
  if (visitDate && !/^\d{4}-(0[1-9]|1[0-2])$/.test(visitDate)) return { ok: false, message: 'Please enter a valid visit month.' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, message: 'Please choose a rating.' };
  if (review.length < 20) return { ok: false, message: 'Please share at least 20 characters about your experience.' };
  if (input.permission !== true) return { ok: false, message: 'Please confirm the review permission.' };
  if (!turnstileToken) return { ok: false, message: 'Please complete the security check.' };

  return {
    ok: true,
    value: { name, email: emailAddress, service, visitDate, rating, review, turnstileToken },
  };
}

async function verifyTurnstile(token, request, env) {
  let response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
    });
  } catch (verifyError) {
    console.error('Turnstile verification request failed:', verifyError);
    return { ok: false, message: 'The security check is temporarily unavailable. Please try again.' };
  }

  if (!response.ok) return { ok: false, message: 'The security check is temporarily unavailable. Please try again.' };

  let result;
  try {
    result = await response.json();
  } catch {
    return { ok: false, message: 'The security check is temporarily unavailable. Please try again.' };
  }
  if (!result.success || result.action !== 'review') {
    return { ok: false, message: 'The security check expired or was unsuccessful. Please try again.' };
  }
  const allowedHostnames = String(env.SITE_HOSTNAMES || '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  if (allowedHostnames.length && !allowedHostnames.includes(result.hostname)) {
    return { ok: false, message: 'The security check did not match this website.' };
  }

  return { ok: true };
}

function buildNotification(review, submittedAt) {
  const visitDate = review.visitDate || 'Not provided';
  const text = [
    'CARE & CLEAN HOME INC. — NEW CLIENT REVIEW',
    '',
    `First name: ${review.name}`,
    `Contact email: ${review.email}`,
    `Service: ${review.service}`,
    `Approximate visit date: ${visitDate}`,
    `Rating: ${review.rating}/5`,
    `Submitted: ${submittedAt}`,
    '',
    'Review:',
    review.review,
    '',
    'Permission confirmed: The client states this is their own experience, permits verification contact, and permits publication of their first name and review after verification.',
  ].join('\n');

  const html = `
    <h1 style="font-size:20px">New client review</h1>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr><th align="left">First name</th><td>${escapeHtml(review.name)}</td></tr>
      <tr><th align="left">Contact email</th><td><a href="mailto:${escapeHtml(review.email)}">${escapeHtml(review.email)}</a></td></tr>
      <tr><th align="left">Service</th><td>${escapeHtml(review.service)}</td></tr>
      <tr><th align="left">Approximate visit date</th><td>${escapeHtml(visitDate)}</td></tr>
      <tr><th align="left">Rating</th><td>${review.rating}/5</td></tr>
      <tr><th align="left">Submitted</th><td>${escapeHtml(submittedAt)}</td></tr>
    </table>
    <h2 style="font-size:16px">Review</h2>
    <p style="white-space:pre-wrap">${escapeHtml(review.review)}</p>
    <p style="color:#5f6b64;font-size:12px">Permission confirmed for verification contact and possible publication of the client’s first name and review.</p>`;

  return { text, html };
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function error(message, status, extraHeaders = {}) {
  return json({ ok: false, message }, status, extraHeaders);
}

function methodNotAllowed(allowedMethod) {
  return error('Method not allowed.', 405, { Allow: allowedMethod });
}
