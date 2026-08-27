import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessName, normalizeDomain, syncLeadFromIntake, validateLeadInput } from "../functions/_lib/leads.js";
import { requireOwner } from "../functions/_lib/security.js";
import { readFile } from "node:fs/promises";

test("lead normalization supports obvious duplicate detection", () => {
  assert.equal(normalizeBusinessName("Harbor & Home, LLC"), "harbor and home llc");
  assert.equal(normalizeDomain("https://www.Example.com/about"), "example.com");
});

test("lead input rejects invalid stage and unsafe website URL", () => {
  assert.throws(() => validateLeadInput({ businessName: "Example", stage: "ready_to_email" }), /stage is invalid/);
  assert.throws(() => validateLeadInput({ businessName: "Example", websiteUrl: "javascript:alert(1)" }), /Website URL is invalid/);
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
  const [client, protectedRoute] = await Promise.all([
    readFile(new URL("../owner/leads/leads.js", import.meta.url), "utf8"),
    readFile(new URL("../functions/owner/api/leads.js", import.meta.url), "utf8"),
  ]);
  assert.match(client, /const LEADS_API = "\/owner\/api\/leads"/);
  assert.doesNotMatch(client, /api\([`"]\/api\/leads/);
  assert.match(protectedRoute, /from "\.\.\/\.\.\/api\/leads\.js"/);
});
