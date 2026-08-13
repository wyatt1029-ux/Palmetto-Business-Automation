# PBA Books

Private bookkeeping software for Palmetto Business Automation. The application is designed for
`books.palmettobusinessautomation.com` and is kept separate from the public marketing site.

## Product boundary

- Owner-only access through Cloudflare Access.
- Neon is the accounting source of truth.
- Stripe collects customer payments, runs monthly autopay, provides bank-data access, and emits
  the events used to record payments, fees, refunds, and payouts.
- Cloudflare R2 stores receipt and vendor-document bytes privately.
- Vendor bills are tracked, but the application never initiates a vendor payment.
- Sales-tax amounts can be recorded; tax calculation and filing are intentionally excluded.

## Local validation

Install dependencies and validate the package:

```powershell
npm install
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
```

For local API testing, copy `.dev.vars.example` to `.dev.vars`, use non-production credentials,
and run `npx wrangler dev`. The development authentication bypass only works when all three values
are present:

```text
ENVIRONMENT=development
DEV_BYPASS_AUTH=true
DEV_OWNER_EMAIL=...
```

The production Worker rejects the bypass.

## Neon setup

Apply `migrations/0001_accounting.sql` after the existing root `schema.sql`. Use a separate Neon
development branch first. The migration creates a service-business chart of accounts, the 2026
accounting period, invoice/bill sequences, the immutable journal, banking/reconciliation records,
document metadata, import history, and audit events.

Before production use, have the opening balance and chart of accounts reviewed against the
December 31, 2025 statement and existing books.

## Cloudflare setup

Create the Worker and bind:

- `books.palmettobusinessautomation.com`
- a private R2 bucket named `pba-books-receipts`
- a separate preview bucket named `pba-books-receipts-preview`
- a daily Cron Trigger

Create a Cloudflare Access self-hosted application for the entire books hostname. Permit only the
owner email, then configure `TEAM_DOMAIN` and the Access application `POLICY_AUD`. The Worker
validates the `Cf-Access-Jwt-Assertion` signature, issuer, audience, and owner allowlist before
serving either the application or its APIs.

## Runtime values

Configure these as Worker secrets or environment values:

- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_ACCOUNT_CUSTOMER_ID`
- `PUBLIC_BOOKS_URL`
- `PUBLIC_SITE_URL`
- `POLICY_AUD`
- `TEAM_DOMAIN`
- `OWNER_EMAIL`

`STRIPE_ACCOUNT_CUSTOMER_ID` is a Stripe Customer representing PBA for the owner-authorized
Financial Connections session. Complete Stripe Financial Connections registration before using
transaction data in live mode.

Subscribe the accounting webhook endpoint to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `invoice.paid`
- `charge.succeeded`
- `charge.refunded`
- `charge.dispute.created`
- `payout.paid`
- `financial_connections.account.refreshed_transactions`

## Approval gate

Do not run the migration against production, create live Stripe sessions, connect the live bank,
or deploy the Worker until the accounting branch and opening balances are approved.
