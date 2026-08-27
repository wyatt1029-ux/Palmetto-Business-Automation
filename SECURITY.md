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
- `/owner/*`, including the browser-facing `/owner/api/leads` endpoint, is owner-only. Configure a
  Cloudflare Access application for the owner path with the same `POLICY_AUD`, `TEAM_DOMAIN`, and
  `OWNER_EMAIL` values used by the existing owner APIs before exposing the route. The legacy
  `/api/leads` handler also requires a valid Access JWT and cannot return data publicly.
- Stripe webhook signatures are verified, timestamps are limited to five minutes, payload sizes are
  bounded, and processed event IDs are deduplicated.
- Stripe invoice and subscription creation uses deterministic idempotency keys and reuses an existing hosted invoice when one has already been created for the approved SOW.
- PBA Books validates Cloudflare Access on every asset and API request, scopes database queries to
  the PBA company, checks mutation origins, and never exposes database or Stripe credentials.
- Receipt uploads are private, size-limited, restricted to PDF/JPEG/PNG, checked by file signature,
  and downloaded as attachments with `nosniff`.
- Posted accounting journals are immutable and balanced; corrections use reversal entries.

## Required production configuration

Before deployment:

1. Create a Turnstile widget for `palmettobusinessautomation.com`.
2. Store `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` as Pages environment variables. The public key is returned by `/api/public-config`; the secret is never sent to the browser.
3. Protect `/api/publish-sow` with Cloudflare Access and configure `POLICY_AUD`, `TEAM_DOMAIN`, and
   `OWNER_EMAIL`.
4. Configure Stripe webhook signing secrets independently for test and production.
5. Apply the schema additions for intake idempotency and Stripe webhook event deduplication.
6. Apply `migrations/0004_sales_workspace.sql` after the existing schema/migrations. It is additive,
   creates archival lead records and activities, and links website intake records without copying
   private form fields into public lead-contact fields.
6. Merge the reviewed branch into `main` and push it to GitHub. The Cloudflare Pages Git integration must build the allowlisted `dist-site/` artifact; do not deploy the repository root directly.
7. Confirm `/README.md`, `/wrangler.toml`, `/schema.sql`, `/package.json`, and `/.env` return 404.
8. Confirm the production response includes the Content Security Policy in `_headers`.

The development authentication bypass must remain disabled in production.
