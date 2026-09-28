import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { onRequestGet as getOwnerRecords } from "../functions/owner/api/records.js";
import { onRequestGet as getOwnerConsole } from "../functions/owner/api/console.js";

const source = (path) => new URL(`../${path}`, import.meta.url);

test("every owner header destination resolves to a real page", async () => {
  const routes = new Map([
    ["/owner/", "owner/index.html"],
    ["/owner/leads/", "owner/leads/index.html"],
    ["/sow-builder", "sow-builder.html"],
    ["/owner/clients-projects/", "owner/clients-projects/index.html"],
    ["/owner/payments/", "owner/payments/index.html"],
  ]);
  const pages = await Promise.all([...routes.values()].map((path) => readFile(source(path), "utf8")));
  for (const html of pages.filter((page) => page.includes('class="owner-nav"'))) {
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
  assert.match(leadsHtml, /Find Charleston service businesses/);
  assert.match(leadsHtml, /Find South Carolina service businesses/);
  assert.match(leadsHtml, /Find new local prospects in this area/);
  assert.match(leadsHtml, /data-discovery-focus="new_business"/);
  assert.match(leadsHtml, /value="both" selected/);
  assert.match(leadsHtml, /Search results are temporary suggestions—not saved leads/);
  assert.match(leadsHtml, /data-discovery-types="plumber, electrician, appliance repair, handyman, tree service, landscaping, towing, contractor"/);
  assert.match(leadsHtml, /Find plumbers in this area/);
  assert.match(leadsHtml, /Find marine services in this area/);
  assert.match(leadsHtml, /Find auto services in this area/);
  assert.match(leadsHtml, /Activity strength is a public-web estimate/);
  assert.match(leads, /Public activity signal/);
  assert.match(leads, /hasStructuredIntake/);
  assert.match(leads, /hasStatusOrPortal/);
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

test("platform owner console is private and uses only owner-authorized data", async () => {
  const [html, client, api] = await Promise.all([
    readFile(source("owner/index.html"), "utf8"),
    readFile(source("owner/console.js"), "utf8"),
    readFile(source("functions/owner/api/console.js"), "utf8"),
  ]);
  assert.match(html, /Platform Owner Console/);
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /href="https:\/\/books\.palmettobusinessautomation\.com"/);
  assert.match(client, /\/owner\/api\/console/);
  assert.match(client, /\["localhost",\s*"127\.0\.0\.1"\]/);
  assert.match(client, /get\("demo"\)\s*===\s*"1"/);
  assert.match(api, /requireOwner/);
  assert.doesNotMatch(html, /DATABASE_URL|STRIPE_SECRET_KEY|BRAVE_SEARCH_API_KEY/);
});

test("platform owner console API rejects unauthenticated reads", async () => {
  const response = await getOwnerConsole({
    request: new Request("https://example.test/owner/api/console"),
    env: {},
  });
  assert.equal(response.status, 503);
});

test("platform owner console returns real database counts and safe configuration state", async () => {
  const sql = async (strings) => {
    const query = strings.join("?");
    if (query.includes("from leads")) return [{ active_leads: "7", needs_action: "4", overdue_actions: "1", new_leads: "3", conflict_reviews: "2" }];
    if (query.includes("from intake_submissions")) return [{ total_intakes: "5", new_intakes: "2" }];
    if (query.includes("sow_decisions")) return [{ sow_decisions: "1", approved_sows: "2" }];
    if (query.includes("payment_attention")) return [{ payment_attention: "1", active_care: "3", paid_projects: "4" }];
    if (query.includes("from lead_activities")) return [{ activity_type: "research_added", note: "Added.", created_at: "2026-09-27T12:00:00Z", lead_id: "lead-1", business_name: "Demo Business" }];
    return [];
  };
  const response = await getOwnerConsole({
    request: new Request("https://example.test/owner/api/console"),
    env: {
      ENVIRONMENT: "development",
      DEV_BYPASS_AUTH: "true",
      DEV_OWNER_EMAIL: "owner@example.test",
      BRAVE_SEARCH_API_KEY: "present",
      STRIPE_SECRET_KEY: "present",
      STRIPE_WEBHOOK_SECRET: "present",
      __TEST_FETCH: async () => new Response("", { status: 200 }),
      __TEST_SQL: sql,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.needsAction, 4);
  assert.equal(body.summary.activeCare, 3);
  assert.equal(body.configuration.leadDiscovery, true);
  assert.equal(body.configuration.payments, true);
  assert.equal(body.recentActivity[0].businessName, "Demo Business");
  assert.equal(JSON.stringify(body).includes("present"), false);
});
