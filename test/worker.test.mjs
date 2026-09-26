import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/worker.js';

const validReview = {
  name: 'Olena',
  email: 'olena@example.com',
  service: 'Residential cleaning',
  visitDate: '2026-09',
  rating: 5,
  review: 'The team was punctual, thoughtful, and very thorough.',
  permission: true,
  website: '',
  turnstileToken: 'valid-test-token',
};

const validQuote = {
  name: 'Olena',
  phone: '+1 (403) 555-0123',
  email: 'olena@example.com',
  service: 'residential',
  squareFeet: '1000-1499',
  bathrooms: 2,
  frequency: 'biweekly',
  notes: 'Please focus on the kitchen and bathrooms.',
  website: '',
  turnstileToken: 'valid-test-token',
};

function createEnv(overrides = {}) {
  const sent = [];
  return {
    env: {
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'secret-key',
      EMAIL_FROM: 'reviews@carecleanhome.ca',
      EMAIL_TO: 'care.cleanyyc@outlook.com',
      ENABLE_AUTOREPLY: 'false',
      SITE_HOSTNAMES: 'carecleanhome.ca,www.carecleanhome.ca',
      NOTIFY_OWNER: { send: async (message) => sent.push(message) },
      EMAIL: { send: async (message) => sent.push(message) },
      ...overrides,
    },
    sent,
  };
}

function reviewRequest(body = validReview, headers = {}) {
  return new Request('https://carecleanhome.ca/api/reviews', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://carecleanhome.ca',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function quoteRequest(body = validQuote, headers = {}) {
  return new Request('https://carecleanhome.ca/api/quotes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://carecleanhome.ca',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('exposes only the public Turnstile site key', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(new Request('https://carecleanhome.ca/api/form-config'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { turnstileSiteKey: 'site-key' });
});

test('rejects cross-origin form submissions before verification', async () => {
  const { env, sent } = createEnv();
  const response = await worker.fetch(reviewRequest(validReview, { Origin: 'https://example.com' }), env);
  assert.equal(response.status, 403);
  assert.equal(sent.length, 0);
});

test('validates required review fields before sending email', async () => {
  const { env, sent } = createEnv();
  const response = await worker.fetch(reviewRequest({ ...validReview, review: 'Too short' }), env);
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.match(result.message, /20 characters/);
  assert.equal(sent.length, 0);
});

test('validates contact details on cleaning requests', async () => {
  const { env, sent } = createEnv();
  const response = await worker.fetch(quoteRequest({ ...validQuote, phone: '12' }), env);
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.match(result.message, /phone number/);
  assert.equal(sent.length, 0);
});

test('accepts common phone number formatting and extensions', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ success: true, action: 'quote', hostname: 'carecleanhome.ca' });

  const { env, sent } = createEnv();
  const response = await worker.fetch(quoteRequest({ ...validQuote, phone: '403.667.4392 ext 5' }), env);

  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
});

test('sends a complete cleaning request and client acknowledgement', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const payload = JSON.parse(options.body);
    assert.equal(payload.response, 'valid-test-token');
    return Response.json({ success: true, action: 'quote', hostname: 'carecleanhome.ca' });
  };

  const { env, sent } = createEnv({ ENABLE_AUTOREPLY: 'true', EMAIL_AUTOREPLY_FROM: 'hello@carecleanhome.ca' });
  const response = await worker.fetch(quoteRequest(), env);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.acknowledgementQueued, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'care.cleanyyc@outlook.com');
  assert.deepEqual(sent[0].replyTo, { email: 'olena@example.com', name: 'Olena' });
  assert.match(sent[0].text, /Phone: \+1 \(403\) 555-0123/);
  assert.match(sent[0].text, /Residential cleaning/);
  assert.equal(sent[1].to, 'olena@example.com');
});

test('keeps the request successful when the optional acknowledgement fails', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ success: true, action: 'quote', hostname: 'carecleanhome.ca' });

  const { env, sent } = createEnv({
    ENABLE_AUTOREPLY: 'true',
    EMAIL: { send: async () => { throw new Error('Paid plan required'); } },
  });
  const response = await worker.fetch(quoteRequest(), env);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.acknowledgementQueued, false);
  assert.equal(sent.length, 1);
});

test('verifies Turnstile and sends the owner notification with reply-to', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const payload = JSON.parse(options.body);
    assert.equal(payload.secret, 'secret-key');
    assert.equal(payload.response, 'valid-test-token');
    return Response.json({ success: true, action: 'review', hostname: 'carecleanhome.ca' });
  };

  const { env, sent } = createEnv();
  const response = await worker.fetch(reviewRequest(), env);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'care.cleanyyc@outlook.com');
  assert.deepEqual(sent[0].replyTo, { email: 'olena@example.com', name: 'Olena' });
  assert.match(sent[0].text, /Residential cleaning/);
  assert.match(sent[0].html, /New client review/);
});

test('rejects a Turnstile result with the wrong action', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ success: true, action: 'contact', hostname: 'carecleanhome.ca' });

  const { env, sent } = createEnv();
  const response = await worker.fetch(reviewRequest(), env);
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test('accepts Cloudflare Turnstile test-key metadata during local development', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({
    success: true,
    hostname: 'example.com',
    metadata: { result_with_testing_key: true },
  });

  const { env, sent } = createEnv();
  const response = await worker.fetch(quoteRequest(), env);
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
});

test('sends the optional client acknowledgement only when enabled', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ success: true, action: 'review', hostname: 'carecleanhome.ca' });

  const { env, sent } = createEnv({ ENABLE_AUTOREPLY: 'true', EMAIL_AUTOREPLY_FROM: 'hello@carecleanhome.ca' });
  const response = await worker.fetch(reviewRequest(), env);
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to, 'olena@example.com');
  assert.equal(sent[1].from.email, 'hello@carecleanhome.ca');
  assert.equal(sent[1].subject, 'We received your request — Care & Clean Home Inc.');
  assert.match(sent[1].text, /received your request and will get back to you shortly/);
});
