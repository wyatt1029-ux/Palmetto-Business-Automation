import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessName, normalizeDomain, serializeLead, syncLeadFromIntake, validateLeadInput } from "../functions/_lib/leads.js";
import { analyzeBusinessPage, buildDiscoveryQueries, discoverBusinesses, safePublicUrl, validateDiscoveryInput } from "../functions/_lib/discovery.js";
import { requireOwner } from "../functions/_lib/security.js";
import { readFile } from "node:fs/promises";
import { __test as leadApi, onRequestGet as getLeads, onRequestPost as postLead, onRequestPut as putLead } from "../functions/api/leads.js";
import { onRequestPost as runDiscovery } from "../functions/owner/api/discovery.js";

const leadRow = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  business_name: "QA Demo",
  normalized_business_name: "qa demo",
  website_url: "https://example.test",
  normalized_domain: "example.test",
  city: "Charleston",
  service_area: "Charleston",
  industry: "Professional services",
  source: "researched",
  source_urls: [],
  public_phone: null,
  public_email: null,
  public_contact_form_url: null,
  public_social_links: [],
  stage: "new",
  fit_level: "high",
  fit_reasons: ["No clear intake flow"],
  services_interest: ["workflow"],
  formation_date: null,
  opened_date: null,
  date_confidence: "unknown",
  discovered_date: "2026-08-27",
  launch_signals: [],
  next_action: "Review",
  next_action_due: "2026-08-28",
  next_action_owner: "owner@example.test",
  next_action_completed: false,
  last_activity_date: null,
  last_verified_date: "2026-08-27",
  contact_status: "not_contacted",
  do_not_contact: false,
  do_not_contact_reason: null,
  internal_notes: null,
  archived: false,
  tidal_conflict_review_required: false,
  tidal_conflict_review_status: "not_needed",
  tidal_conflict_notes: null,
  intake_submission_id: null,
  created_at: "2026-08-27T12:00:00Z",
  updated_at: "2026-08-27T12:00:00Z",
  ...overrides,
});

const ownerEnv = (sql) => ({
  ENVIRONMENT: "development",
  DEV_BYPASS_AUTH: "true",
  DEV_OWNER_EMAIL: "owner@example.test",
  PUBLIC_SITE_URL: "https://example.test",
  __TEST_SQL: sql,
});

test("lead normalization supports obvious duplicate detection", () => {
  assert.equal(normalizeBusinessName("Harbor & Home, LLC"), "harbor and home llc");
  assert.equal(normalizeDomain("https://www.Example.com/about"), "example.com");
});

test("lead discovery accepts cities, ZIP codes, regions, and telephone area codes", () => {
  for (const location of ["Charleston, SC", "29577", "Grand Strand", "843 area code"]) {
    const input = validateDiscoveryInput({ location, focus: "both", maxResults: 10, businessTypes: ["contractor"] });
    assert.equal(input.location, location);
    assert.equal(buildDiscoveryQueries(input).every((query) => query.includes(location)), true);
  }
  assert.throws(() => validateDiscoveryInput({ location: "", maxResults: 10 }), /Search area is required/);
  assert.throws(() => validateDiscoveryInput({ location: "Charleston", maxResults: 100 }), /Result limit is invalid/);
});

test("lead discovery blocks unsafe crawl targets", () => {
  assert.equal(safePublicUrl("http://127.0.0.1/admin"), null);
  assert.equal(safePublicUrl("http://192.168.1.10/"), null);
  assert.equal(safePublicUrl("https://user:secret@example.com/"), null);
  assert.equal(safePublicUrl("https://example.com/contact")?.hostname, "example.com");
});

test("website review reports visible evidence without unexplained scoring", () => {
  const analysis = analyzeBusinessPage(`<!doctype html><html><head><title>Harbor Home Services | Charleston</title></head><body><a href="tel:+18435550199">Call</a><p>Request an estimate and pay your invoice.</p></body></html>`, "https://harbor.example/");
  assert.equal(analysis.title, "Harbor Home Services | Charleston");
  assert.equal(analysis.publicPhone, "+18435550199");
  assert.ok(analysis.fitReasons.includes("Website appears to rely on phone contact"));
  assert.ok(analysis.fitReasons.includes("No online booking link found"));
  assert.ok(analysis.fitReasons.includes("Payment information appears separate from an online payment flow"));
  assert.equal(analysis.checks.hasForm, false);
});

test("owner-triggered discovery searches public results and returns reviewable candidates", async () => {
  const searched = [];
  const result = await discoverBusinesses({ location: "843 area code", businessTypes: ["home services"], focus: "both", maxResults: 5 }, {
    __TEST_SEARCH: async (query) => {
      searched.push(query);
      return [{ title: "Harbor Home Services | Charleston", url: "https://harbor.example/", description: "Now open home services company in the 843 area code." }];
    },
    __TEST_FETCH: async () => new Response(`<!doctype html><html><head><title>Harbor Home Services | Charleston</title></head><body><p>Now open in Charleston.</p><a href="tel:+18435550199">Call us</a></body></html>`, { headers: { "content-type": "text/html" } }),
  });
  assert.equal(searched.length, 3);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].businessName, "Harbor Home Services");
  assert.equal(result.candidates[0].city, "843 area code");
  assert.ok(result.candidates[0].launchSignals.includes("Now open announcement"));
  assert.ok(result.candidates[0].fitReasons.includes("Website appears to rely on phone contact"));
  assert.deepEqual(result.candidates[0].sourceUrls, ["https://harbor.example/"]);
  assert.equal("sourceSnippet" in result.candidates[0], false);
  assert.match(result.coverage, /not an exhaustive market list/);
});

test("lead discovery does not persist search-result content or unverified websites", async () => {
  const result = await discoverBusinesses({ location: "Charleston", focus: "new_business", maxResults: 5 }, {
    __TEST_SEARCH: async () => [{ title: "Search Result Name", url: "https://unreachable.example/", description: "Grand opening search snippet" }],
    __TEST_FETCH: async () => new Response("Unavailable", { status: 503, headers: { "content-type": "text/plain" } }),
  });
  assert.deepEqual(result.candidates, []);
});

test("discovery API is owner-only and requires configured search data", async () => {
  const unauthorized = await runDiscovery({
    request: new Request("https://example.test/owner/api/discovery", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ location: "Charleston", maxResults: 5 }) }),
    env: { ENVIRONMENT: "production", PUBLIC_SITE_URL: "https://example.test" },
  });
  assert.equal(unauthorized.status, 503);

  const unconfigured = await runDiscovery({
    request: new Request("https://example.test/owner/api/discovery", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ location: "Charleston", maxResults: 5 }) }),
    env: ownerEnv(async () => []),
  });
  assert.equal(unconfigured.status, 503);
  assert.match((await unconfigured.json()).error, /BRAVE_SEARCH_API_KEY/);
});

test("lead input rejects invalid stage and unsafe website URL", () => {
  assert.throws(() => validateLeadInput({ businessName: "Example", stage: "ready_to_email" }), /stage is invalid/);
  assert.throws(() => validateLeadInput({ businessName: "Example", websiteUrl: "javascript:alert(1)" }), /Website URL is invalid/);
});

test("lead input preserves editable workflow fields and validates public research data", () => {
  const lead = validateLeadInput({
    businessName: "QA Demo",
    stage: "qualified",
    fitLevel: "high",
    source: "researched",
    contactStatus: "attempted",
    nextActionDue: "2026-08-31",
    formationDate: "2026-08-01",
    dateConfidence: "confirmed",
    publicEmail: "public@example.test",
    publicContactFormUrl: "https://example.test/contact",
    sourceUrls: ["https://example.test/source"],
    nextActionCompleted: false,
  });
  assert.equal(lead.stage, "qualified");
  assert.equal(lead.nextActionDue, "2026-08-31");
  assert.equal(lead.dateConfidence, "confirmed");
  assert.equal(lead.nextActionCompleted, false);
  assert.throws(() => validateLeadInput({ businessName: "QA Demo", formationDate: "2026-02-31" }), /Formation date is invalid/);
  assert.throws(() => validateLeadInput({ businessName: "QA Demo", publicEmail: "not-an-email" }), /Public email is invalid/);
  assert.throws(() => validateLeadInput({ businessName: "QA Demo", sourceUrls: ["javascript:alert(1)"] }), /Source URL is invalid/);
});

test("lead serialization converts Neon date values for HTML date controls", () => {
  const lead = serializeLead(leadRow({
    formation_date: new Date("2026-07-01T00:00:00.000Z"),
    opened_date: "2026-07-15T00:00:00.000Z",
    discovered_date: new Date("2026-08-01T00:00:00.000Z"),
    next_action_due: "2026-08-28T00:00:00.000Z",
    last_verified_date: new Date("2026-08-27T00:00:00.000Z"),
  }));

  assert.equal(lead.formationDate, "2026-07-01");
  assert.equal(lead.openedDate, "2026-07-15");
  assert.equal(lead.discoveredDate, "2026-08-01");
  assert.equal(lead.nextActionDue, "2026-08-28");
  assert.equal(lead.lastVerifiedDate, "2026-08-27");
});

test("owner authorization protects every lead read", async () => {
  await assert.rejects(
    () => requireOwner(new Request("https://example.test/api/leads"), { ENVIRONMENT: "production" }),
    /Owner access is not configured/,
  );
});

test("website inquiry lead sync matches or creates a private lead and activity", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?"); calls.push({ query, values });
    if (query.includes("select id from leads")) return [];
    if (query.includes("insert into leads")) return [{ id: "lead-1" }];
    return [];
  };
  const leadId = await syncLeadFromIntake(sql, { id: "intake-1", customerNumber: "PBA-2026-001001", organization: "Harbor & Home" });
  assert.equal(leadId, "lead-1");
  assert.equal(calls.filter((call) => call.query.includes("lead_activities")).length, 1);
  assert.match(calls.at(-1).values.join(" "), /Website inquiry received/);
  assert.match(calls[0].query, /archived = false/);
  assert.doesNotMatch(calls[0].query, /normalized_domain is null/);
});

test("do-not-contact and conflict review values are explicit and validated", () => {
  const lead = validateLeadInput({ businessName: "Marine Demo", doNotContact: true, tidalConflictReviewRequired: true, tidalConflictReviewStatus: "pending" });
  assert.equal(lead.doNotContact, true);
  assert.equal(lead.tidalConflictReviewRequired, true);
  assert.equal(lead.tidalConflictReviewStatus, "pending");
});

test("owner workspace is excluded from discovery and marked private", async () => {
  const [robots, headers, build] = await Promise.all([
    readFile(new URL("../robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../_headers", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-public.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(robots, /Disallow: \/owner/);
  assert.match(headers, /\/owner\/\*/);
  assert.match(headers, /X-Robots-Tag: noindex/);
  assert.doesNotMatch(build, /owner\/leads\/index\.html.*sitemap/);
});

test("owner workspace keeps its browser API inside the Access-protected route", async () => {
  const [client, protectedRoute, discoveryRoute, html] = await Promise.all([
    readFile(new URL("../owner/leads/leads.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/owner/api/leads.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/owner/api/discovery.js", import.meta.url), "utf8"),
    readFile(new URL("../owner/leads/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const LEADS_API = "\/owner\/api\/leads"/);
  assert.match(client, /const DISCOVERY_API = "\/owner\/api\/discovery"/);
  assert.doesNotMatch(client, /api\([`"]\/api\/leads/);
  assert.match(client, /setField\(form, "id", lead\?\.id \|\| ""\)/);
  assert.match(protectedRoute, /from "\.\.\/\.\.\/api\/leads\.js"/);
  assert.match(discoveryRoute, /requireOwner/);
  assert.match(discoveryRoute, /discoverBusinesses/);
  assert.match(html, /id="cancel-lead" type="button"/);
  assert.match(html, /id="close-lead" type="button"/);
  assert.match(html, /name="tidalConflictReviewStatus"/);
  assert.match(html, /name="archived"/);
  assert.match(html, /id="discovery-form"/);
  assert.match(html, /Search Public Web/);
});

test("lead list views, filters, and date sorting are deterministic", () => {
  const leads = [
    { id: "a", businessName: "Later", archived: false, stage: "new", fitLevel: "high", contactStatus: "not_contacted", tidalConflictReviewStatus: "pending", nextAction: "Call", nextActionDue: "2026-09-02", nextActionCompleted: false, servicesInterest: ["workflow"] },
    { id: "b", businessName: "Sooner", archived: false, stage: "qualified", fitLevel: "medium", contactStatus: "replied", tidalConflictReviewStatus: "cleared", nextAction: "Review", nextActionDue: "2026-08-29", nextActionCompleted: false, servicesInterest: ["website"] },
    { id: "c", businessName: "Archived", archived: true, stage: "archived", fitLevel: "low", contactStatus: "do_not_contact", tidalConflictReviewStatus: "not_needed", nextActionCompleted: true, servicesInterest: [] },
  ];
  assert.deepEqual(leadApi.applyView(leads, "queue", new URLSearchParams()).map((lead) => lead.id), ["a", "b"]);
  assert.deepEqual(leadApi.applyView(leads, "all", new URLSearchParams("archived=only")).map((lead) => lead.id), ["c"]);
  assert.equal(leadApi.rowMatch(leads[0], new URLSearchParams("conflict=pending&services=work")), true);
  assert.deepEqual(leadApi.sortLeads(leads.slice(0, 2), "due").map((lead) => lead.id), ["b", "a"]);
});

test("New Business Radar supports owner-selected locations instead of a hard-coded territory", () => {
  const today = new Date().toISOString().slice(0, 10);
  const leads = [
    { id: "outside-original-area", businessName: "Area Search Demo", city: "Savannah", serviceArea: "912 area code", archived: false, stage: "new", fitLevel: "medium", contactStatus: "not_contacted", tidalConflictReviewStatus: "not_needed", discoveredDate: today, servicesInterest: [] },
  ];
  assert.deepEqual(leadApi.applyView(leads, "radar", new URLSearchParams()).map((lead) => lead.id), ["outside-original-area"]);
});

test("lead API returns private queue counts and pipeline totals", async () => {
  const sql = async () => [leadRow()];
  const response = await getLeads({ request: new Request("https://example.test/owner/api/leads?view=queue"), env: ownerEnv(sql) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.leads.length, 1);
  assert.equal(body.counts.needsAction, 1);
  assert.equal(body.pipelineCounts.new, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("lead API creates validated records and preserves workflow fields", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("select id, business_name")) return [];
    if (query.includes("insert into leads")) return [leadRow({ stage: "qualified", next_action_due: "2026-08-31" })];
    return [];
  };
  const response = await postLead({
    request: new Request("https://example.test/owner/api/leads", {
      method: "POST",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ businessName: "QA Demo", websiteUrl: "https://example.test", stage: "qualified", fitLevel: "high", source: "researched", nextAction: "Review", nextActionDue: "2026-08-31" }),
    }),
    env: ownerEnv(sql),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).lead.stage, "qualified");
  assert.equal(calls.filter((call) => call.query.includes("lead_activities")).length, 1);
  assert.ok(calls.some((call) => call.values.includes("2026-08-31")));
});

test("lead API records explicit stage and do-not-contact changes", async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("select * from leads where id")) return [leadRow()];
    if (query.includes("select id, business_name")) return [];
    if (query.includes("update leads set")) return [leadRow({ stage: "qualified" })];
    return [];
  };
  const response = await putLead({
    request: new Request("https://example.test/owner/api/leads", {
      method: "PUT",
      headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ id: leadRow().id, stage: "qualified" }),
    }),
    env: ownerEnv(sql),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).lead.stage, "qualified");
  assert.ok(calls.some((call) => call.query.includes("lead_activities") && call.values.includes("Stage changed to qualified.")));
});

test("duplicate-review migration keeps lookup performance without blocking reviewed records", async () => {
  const [migration, api] = await Promise.all([
    readFile(new URL("../migrations/0005_lead_duplicate_review.sql", import.meta.url), "utf8"),
    readFile(new URL("../functions/api/leads.js", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /drop index if exists leads_name_domain_unique_idx/i);
  assert.match(migration, /create index if not exists leads_name_domain_lookup_idx/i);
  assert.doesNotMatch(migration, /create unique index/i);
  assert.match(api, /normalized_domain = \$\{domain\}::text/);
  assert.doesNotMatch(api, /\$\{domain\} is not null/);
});
