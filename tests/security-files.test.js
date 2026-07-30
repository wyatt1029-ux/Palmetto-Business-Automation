import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Cloudflare headers enforce the browser security baseline", async () => {
  const headers = await readFile(new URL("../_headers", import.meta.url), "utf8");
  for (const expected of [
    "Content-Security-Policy:",
    "frame-ancestors 'none'",
    "Referrer-Policy: no-referrer",
    "Strict-Transport-Security:",
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "! Access-Control-Allow-Origin",
  ]) {
    assert.ok(headers.includes(expected), `Missing security header: ${expected}`);
  }
});

test("public build script uses an allowlist and excludes source material", async () => {
  const script = await readFile(new URL("../scripts/build-public.mjs", import.meta.url), "utf8");
  for (const forbidden of ["schema.sql", "package.json", "README.md", "wrangler.toml", ".env.example"]) {
    assert.equal(script.includes(`"${forbidden}"`), false, `${forbidden} must not be public`);
  }
  assert.ok(script.includes('"_headers"'));
});

test("telemetry is disabled on magic-link pages", async () => {
  const source = await readFile(new URL("../observability.js", import.meta.url), "utf8");
  assert.ok(source.includes('"/sow.html"'));
  assert.ok(source.includes('"/payment.html"'));
  assert.ok(source.includes("!sensitivePage"));
  assert.ok(source.includes("disable_session_recording: true"));
});
