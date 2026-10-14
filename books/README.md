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
- Sales-tax amounts can be recorded and posted to Sales Tax Payable; tax determination, calculation, collection registration, and filing remain owner responsibilities. See the internal [South Carolina sales-tax note](docs/south-carolina-sales-tax.md).

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

For the monthly-billing end-to-end smoke test, use only the **Palmetto Business Automation
sandbox** Stripe test key (account `acct_1Tz2RYH1zz06h42p`) and the separate **PBA Preview** Neon
database. The test script checks both identities before creating a synthetic customer, invoice,
test-card payment, and signed webhook. It checks payment recording, duplicate-webhook handling,
saved-card autopay activation, and schedules its synthetic subscription to cancel before the
first renewal. Run `PBA_BOOKS_SANDBOX_SMOKE=yes node scripts/smoke-monthly-sandbox.mjs` with
`STRIPE_SECRET_KEY` and `DATABASE_URL` supplied in the process environment. Do not save either
credential in the OneDrive-synced repository or use a live Stripe key. This smoke test does not
send or charge any real customer.

## Neon setup

Apply `migrations/0001_accounting.sql`, `migrations/0002_invoice_customization.sql`, and `migrations/0003_recurring_billing_schedule.sql` after the existing root `schema.sql`. Use a separate Neon
development branch first. The migration creates a service-business chart of accounts, the 2026
accounting period, invoice/bill sequences, the immutable journal, banking/reconciliation records,
document metadata, import history, audit events, and the invoice memo, footer, and custom-field
storage used when PBA sends invoices through Stripe. The recurring billing migration stores a
monthly anchor day and the Stripe payment-method setup state; it is additive and safe to rerun.

For a new invoice, choose **One-time invoice** or **Monthly automatic billing** in the invoice
form. Monthly billing accepts one service line, a manually entered tax amount, and a renewal day.
The Send invoice action creates a Stripe subscription with an initial service-period invoice and
future monthly prices, then emails that first invoice. The first invoice is due before the next
renewal day. Stripe is asked to save the payment method used for that invoice; after Stripe confirms
the first payment and a saved method, the webhook switches the subscription to automatic collection.
If Stripe cannot save a method, Books leaves autopay pending and offers a separate setup link as a
fallback. Confirm the invoice shows monthly autopay as **active** before relying on automatic collection. Legacy recurring
invoices already sent as standalone Stripe invoices retain their original two-step setup flow;
the new form choice does not alter or resend them. The monthly tax amount is fixed from the amount
entered; PBA Books does not calculate future tax changes. Verify the applicable rate and update
the billing arrangement when needed.

For a sent, open invoice with no payment, **Edit details** updates only the customer memo and due
date in both PBA Books and the existing Stripe invoice. It keeps the original invoice number,
amount, and payment link; it does not void or resend the invoice. Recheck the Stripe payment page
before using Stripe's separate **Resend invoice** action. Do not use Stripe's general **Edit
invoice** action for this purpose: finalizing its replacement draft voids the original invoice.

The owner confirmed on October 13, 2026 that there is no opening balance to enter. Do not create
a nonzero opening-balance journal entry. Review the chart of accounts against the December 31,
2025 statement and existing books before production use.

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

Production Stripe uses the `PBA Books Live Billing` event destination
(`we_1UQX8rQUrzwsOfuAB7JIdgJe`) at
`https://books.palmettobusinessautomation.com/api/stripe/webhook`.
Keep its signing secret in the Worker's `STRIPE_WEBHOOK_SECRET` binding and the
live API key in `STRIPE_SECRET_KEY`; never commit either value. The public
`STRIPE_PUBLISHABLE_KEY` is set in `wrangler.toml`. The PBA Books Worker is
deployed with Wrangler to its custom domain; this does not deploy the public
marketing site through Cloudflare Pages.

## Production safeguards

The recurring billing migration was applied to production on October 14, 2026 with owner
approval. Tidal's existing invoice `PBA-INV-000004` was assigned its agreed 7th-of-month
billing anchor; it was not sent. Production Stripe keys and the live webhook secret are
Worker bindings, not repository files. Review the chart of accounts before relying on
financial reports, and obtain owner approval before future production migrations, live
Stripe sessions, or a bank connection. The owner confirmed the opening balance is zero;
do not fabricate an opening-balance entry.

Stripe caps the customer-facing invoice memo at 500 characters. PBA Books enforces that
limit for new invoices and edits to open invoices; use a separate scope document when
longer service terms or exclusions must accompany an invoice.
For a finalized invoice's due-date correction, Stripe requires a revision. Finalizing
the revision voids the original invoice and gives the customer a new payment link.
After confirming the revision is open, unpaid, and otherwise identical, use Edit details
in PBA Books with the revision's exact memo and due date to reconnect the existing
accounting record. This does not create a second receivable or send customer email.
