import test from "node:test";
import assert from "node:assert/strict";
import { requireOwner } from "../worker/auth.js";

test("development owner bypass requires the complete guarded configuration", async () => {
  const owner = await requireOwner(new Request("https://books.example.test"), {
    ENVIRONMENT: "development",
    DEV_BYPASS_AUTH: "true",
    DEV_OWNER_EMAIL: "OWNER@EXAMPLE.COM",
  });
  assert.equal(owner.email, "owner@example.com");
});

test("production never accepts the development bypass", async () => {
  await assert.rejects(
    () => requireOwner(new Request("https://books.example.test"), {
      ENVIRONMENT: "production",
      DEV_BYPASS_AUTH: "true",
      DEV_OWNER_EMAIL: "owner@example.com",
    }),
    /Cloudflare Access is not configured/,
  );
});
