# Palmetto Business Automation

Static marketing website for Palmetto Business Automation, LLC.

## Stack

- HTML
- CSS
- JavaScript
- Cloudflare Pages

## Live Structure

- `/`
- `/services/`
- `/example-builds/`
- `/who-i-help/`
- `/about/`
- `/faq/`
- `/contact/`
- `/owner/leads/` (owner-only; protected by Cloudflare Access)

## Project Structure

- `index.html`
- `services/index.html`
- `example-builds/index.html`
- `who-i-help/index.html`
- `about/index.html`
- `contact/index.html`
- `faq/index.html`
- `assets/css/styles.css`
- `assets/js/main.js`
- `assets/images/`
- `functions/`
- `owner/leads/`
- `migrations/0004_sales_workspace.sql`
- `scripts/build-public.mjs`
- `_redirects`
- `_headers`

## Notes

- The public marketing pages are static and the private customer workflows use Cloudflare Pages Functions.
- `scripts/build-public.mjs` creates the allowlisted `dist-site/` deployment artifact and fingerprints mutable CSS and JavaScript assets.
- The pages are folder-based so they work cleanly on Cloudflare Pages.
- `_redirects` keeps the URLs tidy.
- `_headers` adds basic security headers.

## Private sales workspace

The owner-only Leads workspace is the private source of truth for researched prospects and
website inquiries. It uses the existing Neon database and `requireOwner` authorization helper;
it does not create a second CRM or expose lead data through public routes. Apply
`migrations/0004_sales_workspace.sql` after the existing schema migrations, then configure the
same Cloudflare Access policy and owner allowlist used by the SOW builder. Website inquiries are
matched to a lead by normalized organization name and receive an internal `inquiry_received`
activity. Existing SOW, payment, project, and care records remain the related downstream records.

### Owner-triggered lead discovery

New Business Radar includes an owner-only public-web search form. It accepts a city, ZIP code,
county, region, or telephone area code plus optional business types. Search runs are explicit and
bounded; they do not run in the background, send outreach, or automatically create lead records.
The owner reviews source links and observed website checks before selecting **Add to Radar**.

The production search adapter uses the Brave Search API. Add its key as a Cloudflare Pages secret
named `BRAVE_SEARCH_API_KEY`; never commit the key or place it in `wrangler.toml`. A search may use
provider quota. Website checks inspect only public HTTP(S) business pages, reject local/private
targets, cap response size and duration, and record neutral evidence such as a missing intake form
or booking link. Unknown opening dates stay unknown. Marine-related results enter a pending Tidal
conflict review and are not treated as ready for outreach.

For a local UI preview with clearly labeled sanitized demo leads:

```text
npm run build:site
npm run preview
```

Open `http://127.0.0.1:8788/owner/leads/?demo=1`. Demo mode is hostname-gated to localhost and
does not call the database or search provider. Open New Business Radar and run a search to see a
sanitized candidate. Remove `?demo=1` to exercise the owner-authenticated production path.

## Editing

- Update page content directly in the relevant `index.html` file.
- Keep shared styling in `assets/css/styles.css`.
- Keep lightweight behavior in `assets/js/main.js`.
- Store brand images in `assets/images/`.

## Deployment

GitHub is the source of truth and `main` is the production branch. The existing Cloudflare Pages Git integration builds and deploys production after `main` is pushed. Normal releases should use a reviewed feature branch or pull request and should not deploy a local artifact directly with Wrangler.

Before merging, run:

```text
npm ci
npm --prefix books ci
npm test
npm run check
npm run build:site
npm run books:test
npm run books:build
```

## Engagement and payment policy

- Each project receives a written Statement of Work (SOW) covering scope, exclusions, price, payment timing, timeline assumptions, and client responsibilities.
- Clients approve the exact SOW version before payment setup. One-time projects begin only after written approval and payment are received.
- One-time projects use Stripe hosted invoices due at approval. Larger custom systems may use payment milestones only when they are documented in the project SOW.
- Optional ongoing care is billed automatically monthly in advance and may be canceled with 30 days’ written notice.
- Work outside an approved SOW is separately quoted and requires written approval before it begins.
- Client businesses retain ownership of their domains and core accounts; PBA receives only the access needed to build and support the agreed system.

## Load Testing

- k6 scripts live in `k6/`.
- Run a local server for the site, then execute `k6 run k6/site-smoke.js`.
- Override the target with `BASE_URL` if you want to test a deployed Pages URL instead of `http://127.0.0.1:8080`.
