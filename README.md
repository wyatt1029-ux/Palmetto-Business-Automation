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
- `/contact/`

## Project Structure

- `index.html`
- `services/index.html`
- `example-builds/index.html`
- `who-i-help/index.html`
- `about/index.html`
- `contact/index.html`
- `assets/css/styles.css`
- `assets/js/main.js`
- `assets/images/`
- `_redirects`
- `_headers`

## Notes

- The site is fully static.
- No backend, forms, or database are used.
- The pages are folder-based so they work cleanly on Cloudflare Pages.
- `_redirects` keeps the URLs tidy.
- `_headers` adds basic security headers.

## Editing

- Update page content directly in the relevant `index.html` file.
- Keep shared styling in `assets/css/styles.css`.
- Keep lightweight behavior in `assets/js/main.js`.
- Store brand images in `assets/images/`.

## Deployment

Cloudflare Pages is the intended host for this version of the site.

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
