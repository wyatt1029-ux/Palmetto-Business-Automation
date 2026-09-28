import test from "node:test";
import assert from "node:assert/strict";
import { getPortfolioMonitoring, readSiteRegistry } from "../functions/_lib/platform-monitoring.js";

test("monitoring registry rejects private network URLs and duplicate ids", () => {
  assert.throws(() => readSiteRegistry({ PLATFORM_SITES_JSON: JSON.stringify([{ id: "site", name: "Site", url: "http://127.0.0.1" }]) }), /HTTPS/);
  assert.throws(() => readSiteRegistry({ PLATFORM_SITES_JSON: JSON.stringify([{ id: "site", name: "One", url: "https://one.test" }, { id: "site", name: "Two", url: "https://two.test" }]) }), /unique/);
});

test("provider failures are isolated and secrets never appear in output", async () => {
  const env = { POSTHOG_PERSONAL_API_KEY: "posthog-secret", SENTRY_AUTH_TOKEN: "sentry-secret", SENTRY_ORG_SLUG: "pba" };
  const fetcher = async (url) => {
    if (url.includes("posthog")) return new Response("no", { status: 503 });
    if (url.includes("sentry")) return new Response(JSON.stringify({ id: "1" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("", { status: 200 });
  };
  const result = await getPortfolioMonitoring(env, "30d", fetcher);
  assert.equal(result.sites[0].uptime.status, "up");
  assert.match(result.sites[0].analytics.error, /503/);
  assert.equal(JSON.stringify(result).includes("posthog-secret"), false);
  assert.equal(JSON.stringify(result).includes("sentry-secret"), false);
});

test("monitoring aggregates only numeric totals", async () => {
  const env = { POSTHOG_PERSONAL_API_KEY: "x", SENTRY_AUTH_TOKEN: "y", SENTRY_ORG_SLUG: "pba" };
  const fetcher = async (url) => {
    if (url.includes("posthog")) return Response.json({ results: [[12, 50, 18, 3]] });
    if (url.includes("/projects/")) return Response.json({ id: "7" });
    if (url.includes("/issues/")) return Response.json([{ id: "a" }, { id: "b" }]);
    return new Response("", { status: 200 });
  };
  const result = await getPortfolioMonitoring(env, "7d", fetcher);
  assert.deepEqual(result.totals, { visitors: 12, sessions: 18, pageviews: 50, conversions: 3, unresolvedIssues: 2, sitesUp: 1 });
});
