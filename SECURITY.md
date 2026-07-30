# PBA Site Security

## Reporting

Report suspected vulnerabilities privately to `hello@palmettobusinessautomation.com`. Do not include
passwords, payment details, or client data in the initial message.

## Implemented controls

- Cloudflare Pages deployments use an explicit public-file allowlist. Source, schemas, environment
  examples, package files, documentation, tests, and Worker configuration are not uploaded.
- Browser responses include a restrictive Content Security Policy, no-referrer policy, HSTS,
  clickjacking protection, MIME sniffing protection, and restricted browser permissions.
- Intake submissions require Cloudflare Turnstile, consent, bounded field lengths, and a unique
  idempotency key.
- Client-supplied text is HTML-escaped before it is included in Outlook email.
- Sentry and PostHog are disabled on intake, SOW, and payment pages so magic links and client
  context are not captured by telemetry.
- SOW, payment, and billing mutations reject cross-origin browser requests and validate identifiers,
  tokens, dates, amounts, and request sizes.
- The private SOW publisher requires a verified Cloudflare Access JWT and an explicit owner-email
  allowlist.
- Stripe webhook signatures are verified, timestamps are limited to five minutes, payload sizes are
  bounded, and processed event IDs are deduplicated.
- Stripe Checkout creation reuses an open session and uses a deterministic idempotency key.
- PBA Books validates Cloudflare Access on every asset and API request, scopes database queries to
  the PBA company, checks mutation origins, and never exposes database or Stripe credentials.
- Receipt uploads are private, size-limited, restricted to PDF/JPEG/PNG, checked by file signature,
  and downloaded as attachments with `nosniff`.
- Posted accounting journals are immutable and balanced; corrections use reversal entries.

## Required production configuration

Before deployment:

1. Create a Turnstile widget for `palmettobusinessautomation.com`.
2. Put its public site key in `assets/js/site-config.js` and store `TURNSTILE_SECRET_KEY` as a Pages secret.
3. Configure a Microsoft Entra application with `Mail.Send` application permission and store
   `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and
   `OUTLOOK_SENDER_EMAIL` as Pages secrets.
4. Protect `/review/`, `/api/review`, and `/api/publish-sow` with Cloudflare Access and configure `POLICY_AUD`, `TEAM_DOMAIN`, and
   `OWNER_EMAIL`.
5. Configure Stripe webhook signing secrets independently for test and production.
6. Apply the schema additions for intake idempotency and Stripe webhook event deduplication.
7. Deploy with `npm run deploy`; do not deploy the repository root directly.
8. Confirm `/README.md`, `/wrangler.toml`, `/schema.sql`, `/package.json`, and `/.env` return 404.
9. Confirm the production response includes the Content Security Policy in `_headers`.

The development authentication bypass must remain disabled in production.
