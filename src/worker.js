const REVIEW_ENDPOINT = '/api/reviews';
const QUOTE_ENDPOINT = '/api/quotes';
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

const QUOTE_SERVICES = {
  residential: { title: 'Residential cleaning', rate: '$35 CAD per hour for one cleaner' },
  commercial: { title: 'Commercial cleaning', rate: '$35 CAD per hour for one cleaner' },
  move: { title: 'Move-in / move-out cleaning', rate: '$35 CAD per hour for one cleaner' },
  airbnb: { title: 'Airbnb cleaning', rate: '$35 CAD per hour for one cleaner' },
  carpet: { title: 'Professional carpet care', rate: '$40–$60 CAD per room' },
  'post-construction': { title: 'Post-construction cleaning', rate: '$40 CAD per hour for one cleaner' },
};

const QUOTE_SQUARE_FEET = {
  'under-1000': 'Under 1,000 sq ft',
  '1000-1499': '1,000–1,499 sq ft',
  '1500-1999': '1,500–1,999 sq ft',
  '2000-2499': '2,000–2,499 sq ft',
  '2500-2999': '2,500–2,999 sq ft',
  '3000-plus': '3,000+ sq ft',
};

const QUOTE_FREQUENCIES = {
  once: 'One-time clean',
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
};

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

    if (url.pathname === QUOTE_ENDPOINT) {
      return handleQuote(request, env, url);
    }

    if (!env.ASSETS) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

async function handleQuote(request, env, url) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const payload = await readFormPayload(request, url);
  if (!payload.ok) return payload.response;
  const input = payload.input;

  if (clean(input.website, 200)) return json({ ok: true, message: 'Thank you. Your request has been received.' });

  const quote = validateQuote(input);
  if (!quote.ok) return error(quote.message, 400);

  const missingConfiguration = ['TURNSTILE_SECRET_KEY', 'EMAIL_FROM', 'EMAIL_TO']
    .filter((key) => !env[key]);
  if (missingConfiguration.length || !env.NOTIFY_OWNER) {
    console.error('Estimate form configuration is incomplete:', missingConfiguration.join(', ') || 'NOTIFY_OWNER binding');
    return error('The estimate form is temporarily unavailable. Please call +1 (403) 667-4392 or email care.cleanyyc@outlook.com.', 503);
  }

  const turnstile = await verifyTurnstile(quote.value.turnstileToken, request, env, 'quote');
  if (!turnstile.ok) return error(turnstile.message, 400);

  const email = buildQuoteNotification(quote.value, new Date().toISOString());
  try {
    await env.NOTIFY_OWNER.send({
      from: { email: env.EMAIL_FROM, name: 'Care & Clean website' },
      to: env.EMAIL_TO,
      replyTo: { email: quote.value.email, name: quote.value.name },
      subject: `New cleaning request from ${quote.value.name}`,
      text: email.text,
      html: email.html,
    });
  } catch (sendError) {
    console.error('Estimate notification email failed:', sendError);
    return error('We could not send your request right now. Please try again or call +1 (403) 667-4392.', 502);
  }

  const acknowledgementQueued = await sendAcknowledgement(env, quote.value.name, quote.value.email);
  return json({
    ok: true,
    acknowledgementQueued,
    message: 'Thank you. Your request has been sent. We’ll get back to you shortly.',
  });
}

async function handleReview(request, env, url) {
  if (request.method !== 'POST') return methodNotAllowed('POST');

  const payload = await readFormPayload(request, url);
  if (!payload.ok) return payload.response;
  const input = payload.input;

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

  const turnstile = await verifyTurnstile(review.value.turnstileToken, request, env, 'review');
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

  await sendAcknowledgement(env, review.value.name, review.value.email);

  return json({ ok: true, message: 'Thank you. Your review has been sent to Care & Clean for verification.' });
}

async function readFormPayload(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        return { ok: false, response: error('This form can only be submitted from this website.', 403) };
      }
    } catch {
      return { ok: false, response: error('Invalid request origin.', 403) };
    }
  }

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return { ok: false, response: error('Please send the form as JSON.', 415) };
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return { ok: false, response: error('The form is too large.', 413) };

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, response: error('The form could not be read.', 400) };
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return { ok: false, response: error('The form is too large.', 413) };
  }

  try {
    return { ok: true, input: JSON.parse(rawBody) };
  } catch {
    return { ok: false, response: error('The form contains invalid data.', 400) };
  }
}

function validateQuote(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'The form contains invalid data.' };
  }

  const name = clean(input.name, 60);
  const phone = clean(input.phone, 30);
  const emailAddress = clean(input.email, 120).toLowerCase();
  const service = clean(input.service, 40);
  const squareFeet = clean(input.squareFeet, 20);
  const frequency = clean(input.frequency, 20);
  const notes = clean(input.notes, 1200);
  const turnstileToken = clean(input.turnstileToken, 2048);
  const bathrooms = Number(input.bathrooms);

  if (name.length < 2) return { ok: false, message: 'Please enter your name.' };
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return { ok: false, message: 'Please enter a phone number with 7 to 15 digits.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) return { ok: false, message: 'Please enter a valid email address.' };
  if (!Object.hasOwn(QUOTE_SERVICES, service)) return { ok: false, message: 'Please choose a service.' };
  if (!Object.hasOwn(QUOTE_SQUARE_FEET, squareFeet)) return { ok: false, message: 'Please choose the size of your space.' };
  if (!Object.hasOwn(QUOTE_FREQUENCIES, frequency)) return { ok: false, message: 'Please choose a cleaning frequency.' };
  if (!Number.isInteger(bathrooms) || bathrooms < 1 || bathrooms > 4) return { ok: false, message: 'Please choose the number of bathrooms.' };
  if (!turnstileToken) return { ok: false, message: 'Please complete the security check.' };

  return {
    ok: true,
    value: { name, phone, email: emailAddress, service, squareFeet, bathrooms, frequency, notes, turnstileToken },
  };
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

async function verifyTurnstile(token, request, env, expectedAction) {
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
  const usesTurnstileTestKey = result.metadata?.result_with_testing_key === true;
  if (!result.success || (!usesTurnstileTestKey && result.action !== expectedAction)) {
    return { ok: false, message: 'The security check expired or was unsuccessful. Please try again.' };
  }
  const allowedHostnames = String(env.SITE_HOSTNAMES || '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  if (!usesTurnstileTestKey && allowedHostnames.length && !allowedHostnames.includes(result.hostname)) {
    return { ok: false, message: 'The security check did not match this website.' };
  }

  return { ok: true };
}

async function sendAcknowledgement(env, name, emailAddress) {
  if (env.ENABLE_AUTOREPLY !== 'true' || !env.EMAIL) return false;
  try {
    await env.EMAIL.send({
      from: { email: env.EMAIL_AUTOREPLY_FROM || env.EMAIL_FROM, name: 'Care & Clean Home Inc.' },
      to: emailAddress,
      subject: 'We received your request — Care & Clean Home Inc.',
      text: `Hi ${name},\n\nThank you for contacting Care & Clean Home Inc. We have received your request and will get back to you shortly.\n\nCare & Clean Home Inc.\nCalgary, Alberta\n+1 (403) 667-4392`,
      html: `<p>Hi ${escapeHtml(name)},</p><p>Thank you for contacting Care &amp; Clean Home Inc. We have received your request and will get back to you shortly.</p><p>Care &amp; Clean Home Inc.<br>Calgary, Alberta<br><a href="tel:+14036674392">+1 (403) 667-4392</a></p>`,
    });
    return true;
  } catch (sendError) {
    // The submission remains successful if only the optional acknowledgement fails.
    console.error('Client acknowledgement email failed:', sendError);
    return false;
  }
}

function buildQuoteNotification(quote, submittedAt) {
  const service = QUOTE_SERVICES[quote.service];
  const bathrooms = quote.service === 'carpet' ? 'Not applicable' : String(quote.bathrooms);
  const text = [
    'CARE & CLEAN HOME INC. — NEW CLEANING REQUEST',
    '',
    `Name: ${quote.name}`,
    `Phone: ${quote.phone}`,
    `Email: ${quote.email}`,
    `Submitted: ${submittedAt}`,
    '',
    `Service: ${service.title}`,
    `Planning rate: ${service.rate}`,
    `Space: ${QUOTE_SQUARE_FEET[quote.squareFeet]}`,
    `Bathrooms / washrooms: ${bathrooms}`,
    `Frequency: ${QUOTE_FREQUENCIES[quote.frequency]}`,
    `Additional details: ${quote.notes || 'Not provided'}`,
    '',
    'This is a planning request. Final scope, anticipated hours, pricing, applicable tax, and availability still need to be confirmed with the client.',
  ].join('\n');

  const html = `
    <h1 style="font-size:20px">New cleaning request</h1>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr><th align="left">Name</th><td>${escapeHtml(quote.name)}</td></tr>
      <tr><th align="left">Phone</th><td><a href="tel:${escapeHtml(quote.phone)}">${escapeHtml(quote.phone)}</a></td></tr>
      <tr><th align="left">Email</th><td><a href="mailto:${escapeHtml(quote.email)}">${escapeHtml(quote.email)}</a></td></tr>
      <tr><th align="left">Service</th><td>${escapeHtml(service.title)}</td></tr>
      <tr><th align="left">Planning rate</th><td>${escapeHtml(service.rate)}</td></tr>
      <tr><th align="left">Space</th><td>${escapeHtml(QUOTE_SQUARE_FEET[quote.squareFeet])}</td></tr>
      <tr><th align="left">Bathrooms / washrooms</th><td>${escapeHtml(bathrooms)}</td></tr>
      <tr><th align="left">Frequency</th><td>${escapeHtml(QUOTE_FREQUENCIES[quote.frequency])}</td></tr>
      <tr><th align="left">Submitted</th><td>${escapeHtml(submittedAt)}</td></tr>
    </table>
    <h2 style="font-size:16px">Additional details</h2>
    <p style="white-space:pre-wrap">${escapeHtml(quote.notes || 'Not provided')}</p>
    <p style="color:#5f6b64;font-size:12px">Final scope, anticipated hours, pricing, applicable tax, and availability still need to be confirmed with the client.</p>`;

  return { text, html };
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
