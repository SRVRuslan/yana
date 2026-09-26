# Cloudflare form setup

The estimate and review forms are served with the static site by one Cloudflare Worker. `POST /api/quotes` sends cleaning requests with the client's contact details, while `POST /api/reviews` sends client reviews. Both endpoints validate Turnstile on the server and deliver notifications to `care.cleanyyc@outlook.com` through the destination-restricted `NOTIFY_OWNER` binding.

## 1. Onboard the domain for Email Sending

Email Routing is enabled for `carecleanhome.ca`, and `care.cleanyyc@outlook.com` is a verified destination. This allows owner notifications on Workers Free.

To send automatic replies to arbitrary client addresses:

1. Upgrade the account to Workers Paid.
2. In the Cloudflare dashboard, open **Compute > Email Service > Email Sending**.
3. Select **Onboard Domain** for `carecleanhome.ca` and complete the DNS checks.

The Worker sends from `reviews@carecleanhome.ca`. The visitor's address is used as `replyTo`, so replying to the notification in Outlook replies to the client.

## 2. Create Turnstile keys

Create a Turnstile widget for these hostnames:

- `carecleanhome.ca`
- `www.carecleanhome.ca` if that hostname is used
- the `yana.*.workers.dev` hostname for deployment testing, if needed

Save both values as Worker secrets:

```sh
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

The site key is safe to expose in the browser, but keeping both values in Worker configuration avoids committing environment-specific keys.

The same hostnames are listed in `SITE_HOSTNAMES` in `wrangler.jsonc`. Keep the Turnstile widget list and this variable in sync.

## 3. Build and deploy

```sh
npx wrangler login
sh scripts/build.sh
npx wrangler deploy
```

The Worker configuration publishes `dist/` as static assets and routes `/api/*` through `src/worker.js` first. Do not enable `remote: true` on the email binding during local development unless real emails are intended.

The deployment configuration attaches both `carecleanhome.ca` and `www.carecleanhome.ca` as Worker Custom Domains. Cloudflare manages the DNS target and certificate for those hostnames. Remove an existing conflicting CNAME before the first deployment if Cloudflare reports one.

## 4. Email modes

`ENABLE_AUTOREPLY` is enabled. The owner notification is sent to the verified Outlook address. When Workers Paid and Email Sending domain onboarding are active, the client also receives a short confirmation that their request was received and that the team will respond shortly. The estimate notification includes the client's name, phone, email, selected service, space details, frequency, notes, and planning rate.

The separate `EMAIL` binding is restricted to the `hello@carecleanhome.ca` sender. Sending the acknowledgement to arbitrary client addresses requires Workers Paid. On Workers Free, an acknowledgement failure does not discard the owner's notification; the form explicitly tells the visitor that the request was received but a confirmation email could not be sent. To temporarily disable the attempt, change `ENABLE_AUTOREPLY` to `false` and redeploy.

## 5. Local preview

Create `.dev.vars` without committing it:

```dotenv
TURNSTILE_SITE_KEY=your_test_site_key
TURNSTILE_SECRET_KEY=your_test_secret_key
```

Then run:

```sh
sh scripts/build.sh
npx wrangler dev
```

By default, local Wrangler email bindings log the email instead of sending it.
