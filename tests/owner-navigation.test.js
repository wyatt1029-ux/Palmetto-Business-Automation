import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { onRequestGet as getOwnerRecords } from "../functions/owner/api/records.js";

const source = (path) => new URL(`../${path}`, import.meta.url);

test("every owner header destination resolves to a real page", async () => {
  const routes = new Map([
    ["/owner/leads/", "owner/leads/index.html"],
    ["/sow-builder.html", "sow-builder.html"],
    ["/owner/clients-projects/", "owner/clients-projects/index.html"],
    ["/owner/payments/", "owner/payments/index.html"],
  ]);
  const pages = await Promise.all([...routes.values()].map((path) => readFile(source(path), "utf8")));
  for (const html of pages.filter((page) => page.includes("owner-nav"))) {
    for (const route of routes.keys()) assert.match(html, new RegExp(`href=["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
    assert.doesNotMatch(html, /class=["'][^"']*owner-nav[^"']*["'][\s\S]*href=["']#["']/);
  }
  await Promise.all([...routes.values()].map((path) => access(source(path))));
});

test("owner record pages remain private and use the protected API", async () => {
  const [clients, payments, headers, script, leads, leadsHtml] = await Promise.all([
    readFile(source("owner/clients-projects/index.html"), "utf8"),
    readFile(source("owner/payments/index.html"), "utf8"),
    readFile(source("_headers"), "utf8"),
    readFile(source("owner/records/records.js"), "utf8"),
    readFile(source("owner/leads/leads.js"), "utf8"),
    readFile(source("owner/leads/index.html"), "utf8"),
  ]);
  assert.match(clients, /noindex,nofollow,noarchive/);
  assert.match(payments, /noindex,nofollow,noarchive/);
  assert.match(headers, /\/owner\/\*/);
  assert.match(script, /\/owner\/api\/records/);
  assert.match(leads, /URLSearchParams\(location\.search\)\.get\("lead"\)/);
  assert.match(leads, /openDetail\(leadId\)/);
  assert.match(leads, /Reopen Next Action/);
  assert.match(leads, /action === "complete" \|\| action === "reopen"/);
  assert.match(leads, /Create Email Draft/);
  assert.match(leads, /activityType: "email_drafted"/);
  assert.match(leads, /No email was sent/);
  assert.match(leads, /websiteUrlFromRecipient/);
  assert.match(leads, /That is a website address, not an email/);
  assert.match(leadsHtml, /A website address cannot receive email/);
  assert.match(leadsHtml, /id="email-draft-website"[^>]+target="_blank"/);
  assert.match(leads, /lead\.websiteUrl \|\| lead\.publicContactFormUrl/);
  assert.match(leadsHtml, /id="open-email-app"[^>]+disabled/);
  assert.doesNotMatch(leads, /sendEmail|emailjs|\/api\/send/);
  assert.match(leadsHtml, /Find plumbers in this area/);
  assert.match(leadsHtml, /Find marine services in this area/);
  assert.match(leadsHtml, /Find auto services in this area/);
  assert.match(leads, /discovery-quick-actions \[data-discovery-focus\]/);
});

test("owner record API rejects unauthenticated reads", async () => {
  const response = await getOwnerRecords({
    request: new Request("https://example.test/owner/api/records?view=clients"),
    env: {},
  });
  assert.equal(response.status, 503);
});

test("owner record API validates its requested view", async () => {
  const response = await getOwnerRecords({
    request: new Request("https://example.test/owner/api/records?view=unknown"),
    env: {
      ENVIRONMENT: "development",
      DEV_BYPASS_AUTH: "true",
      DEV_OWNER_EMAIL: "owner@example.test",
      __TEST_SQL: async () => [],
    },
  });
  assert.equal(response.status, 422);
});
