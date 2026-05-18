# k6 load test

Use this folder to run a quick smoke/stress test against the static site.

## Local run

Start a static server from the project root, then run:

```powershell
k6 run k6/site-smoke.js
```

If your local server uses a different port or the live site is already deployed, point the script at it with `BASE_URL`:

```powershell
$env:BASE_URL = "http://127.0.0.1:8080"
$env:VUS = "10"
$env:DURATION = "1m"
k6 run k6/site-smoke.js
```

## What it checks

- The core pages return `200`.
- Each page responds with HTML.
- The page content includes the site title.

## Notes

- This site is static, so k6 should target the served URL, not the raw files.
- Keep the test lightweight unless you want a heavier spike test.
