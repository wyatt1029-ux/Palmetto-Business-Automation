# Palmetto Business Automation

Marketing website and secure project workflow for Palmetto Business Automation, LLC.

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
- `/start/` — guided project intake
- `/scope/` — private magic-link SOW review and approval
- `/pay/` — private Stripe payment and autopay setup
- `/review/` — private owner intake and SOW workspace

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

- Public marketing pages are static and the secure workflow uses Cloudflare Pages Functions.
- Neon stores intake, SOW, payment, and accounting records.
- Stripe handles one-time and recurring payments without card data passing through the site.
- Microsoft Graph sends client and owner notifications.
- The pages are folder-based so they work cleanly on Cloudflare Pages.
- `_redirects` keeps the URLs tidy.
- `_headers` adds a restrictive browser-security baseline.
- `npm run build:site` creates an explicit allowlisted deployment bundle.

## Editing

- Update page content directly in the relevant `index.html` file.
- Keep shared styling in `assets/css/styles.css`.
- Keep lightweight behavior in `assets/js/main.js`.
- Store brand images in `assets/images/`.

## Deployment

Cloudflare Pages is the intended host for this version of the site.

## Load Testing

- k6 scripts live in `k6/`.
- Run a local server for the site, then execute `k6 run k6/site-smoke.js`.
- Override the target with `BASE_URL` if you want to test a deployed Pages URL instead of `http://127.0.0.1:8080`.
