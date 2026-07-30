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
  const scope = await readFile(new URL("../scope/index.html", import.meta.url), "utf8");
  const payment = await readFile(new URL("../pay/index.html", import.meta.url), "utf8");
  assert.ok(!scope.includes("main.js"));
  assert.ok(!payment.includes("main.js"));
  assert.ok(!scope.includes("posthog"));
  assert.ok(!payment.includes("posthog"));
});

test("intake revision links use hashed expiring tokens", async () => {
  const api = await readFile(new URL("../functions/api/intake.js", import.meta.url), "utf8");
  assert.ok(api.includes("revision_token_hash = ${tokenHash}"));
  assert.ok(api.includes("revision_token_expires_at > now()"));
  assert.ok(api.includes("export async function onRequestPut"));
  assert.ok(!api.includes("revisionToken }"));
});

test("Outlook uses application OAuth instead of a static access token", async () => {
  const outlook = await readFile(new URL("../functions/_lib/outlook.js", import.meta.url), "utf8");
  assert.ok(outlook.includes("grant_type: \"client_credentials\""));
  assert.ok(outlook.includes("/users/${sender}/sendMail"));
  assert.ok(!outlook.includes("OUTLOOK_ACCESS_TOKEN"));
});

test("owner review endpoints require verified owner access", async () => {
  const review = await readFile(new URL("../functions/api/review.js", import.meta.url), "utf8");
  const publish = await readFile(new URL("../functions/api/publish-sow.js", import.meta.url), "utf8");
  assert.ok(review.includes("requireOwner(request, env)"));
  assert.ok(publish.includes("requireOwner(request, env)"));
});
