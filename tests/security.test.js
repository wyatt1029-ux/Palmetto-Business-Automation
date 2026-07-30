import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSameOrigin,
  cleanText,
  escapeHtml,
  readJson,
  requireOwner,
} from "../functions/_lib/security.js";

test("HTML escaping neutralizes markup in email content", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert(1)"> & 'quoted'`),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;",
  );
});

test("text limits reject oversized submissions", () => {
  assert.throws(() => cleanText("x".repeat(11), "Field", { max: 10 }), /too long/);
});

test("JSON reader rejects oversized bodies", async () => {
  await assert.rejects(
    () => readJson(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(100) }),
    }), 20),
    /too large/,
  );
});

test("same-origin check rejects a hostile origin", () => {
  assert.throws(
    () => assertSameOrigin(
      new Request("https://palmettobusinessautomation.com/api/intake", {
        headers: { origin: "https://evil.example" },
      }),
      "https://palmettobusinessautomation.com",
    ),
    /Cross-origin/,
  );
});

test("production cannot use the owner development bypass", async () => {
  await assert.rejects(
    () => requireOwner(new Request("https://example.test"), {
      ENVIRONMENT: "production",
      DEV_BYPASS_AUTH: "true",
      DEV_OWNER_EMAIL: "owner@example.test",
    }),
    /Owner access is not configured/,
  );
});
