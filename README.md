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
