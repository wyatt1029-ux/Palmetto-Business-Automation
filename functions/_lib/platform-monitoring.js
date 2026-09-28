const PERIODS = new Set(["7d", "30d", "90d"]);
const DEFAULT_SITES = [{
  id: "pba-site",
  name: "PBA Website",
  url: "https://palmettobusinessautomation.com",
  posthogProjectId: "523092",
  sentryProjectSlug: "palmetto-business-automation-site",
}];

const safePublicUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Monitored sites must use HTTPS.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    throw new Error("Private network URLs cannot be monitored.");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
};

export function readSiteRegistry(env) {
  let sites = DEFAULT_SITES;
  if (env.PLATFORM_SITES_JSON) {
    try { sites = JSON.parse(env.PLATFORM_SITES_JSON); } catch { throw new Error("PLATFORM_SITES_JSON is not valid JSON."); }
  }
  if (!Array.isArray(sites) || !sites.length || sites.length > 20) throw new Error("Configure between 1 and 20 monitored sites.");
  const ids = new Set();
  return sites.map((site) => {
    const id = String(site.id || "").trim();
    const name = String(site.name || "").trim();
    if (!/^[a-z0-9-]{2,50}$/.test(id) || ids.has(id) || !name || name.length > 80) throw new Error("Each monitored site needs a unique safe id and name.");
    ids.add(id);
    return {
      id, name, url: safePublicUrl(site.url),
      posthogProjectId: String(site.posthogProjectId || "").trim(),
      sentryProjectSlug: String(site.sentryProjectSlug || "").trim(),
    };
  });
}

const literal = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;

async function posthogMetrics(site, env, period, fetcher) {
  if (!env.POSTHOG_PERSONAL_API_KEY || !site.posthogProjectId) return { configured: false };
  const days = Number(period.slice(0, -1));
  const host = new URL(site.url).hostname;
  const query = `SELECT uniq(distinct_id), countIf(event = '$pageview'), uniqIf(properties.$session_id, event = '$pageview'), countIf(event IN ('lead_submitted','booking_clicked','phone_clicked','contact_form_submitted','payment_completed')) FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND properties.$host = ${literal(host)}`;
  const response = await fetcher(`${(env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "")}/api/projects/${encodeURIComponent(site.posthogProjectId)}/query/`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!response.ok) throw new Error(`PostHog returned ${response.status}.`);
  const body = await response.json();
  const row = body.results?.[0] || [];
  return { configured: true, visitors: Number(row[0] || 0), pageviews: Number(row[1] || 0), sessions: Number(row[2] || 0), conversions: Number(row[3] || 0) };
}

async function sentryMetrics(site, env, period, fetcher) {
  if (!env.SENTRY_AUTH_TOKEN || !env.SENTRY_ORG_SLUG || !site.sentryProjectSlug) return { configured: false };
  const host = (env.SENTRY_HOST || "https://sentry.io").replace(/\/$/, "");
  const headers = { authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}` };
  const projectResponse = await fetcher(`${host}/api/0/projects/${encodeURIComponent(env.SENTRY_ORG_SLUG)}/${encodeURIComponent(site.sentryProjectSlug)}/`, { headers });
  if (!projectResponse.ok) throw new Error(`Sentry returned ${projectResponse.status}.`);
  const project = await projectResponse.json();
  const issuesResponse = await fetcher(`${host}/api/0/organizations/${encodeURIComponent(env.SENTRY_ORG_SLUG)}/issues/?project=${encodeURIComponent(project.id)}&statsPeriod=${period}&query=is%3Aunresolved&limit=100`, { headers });
  if (!issuesResponse.ok) throw new Error(`Sentry issues returned ${issuesResponse.status}.`);
  const issues = await issuesResponse.json();
  return { configured: true, unresolvedIssues: Array.isArray(issues) ? issues.length : 0 };
}

async function uptime(site, fetcher) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(site.url, { method: "HEAD", redirect: "follow", signal: controller.signal, headers: { "user-agent": "PBA-Owner-Monitor/1.0" } });
    return { status: response.ok ? "up" : "degraded", statusCode: response.status, responseMs: Date.now() - started };
  } catch { return { status: "down", statusCode: null, responseMs: Date.now() - started }; }
  finally { clearTimeout(timeout); }
}

const settled = (result, fallback) => result.status === "fulfilled" ? result.value : { ...fallback, error: result.reason?.message || "Provider unavailable." };

export async function getPortfolioMonitoring(env, requestedPeriod = "7d", fetcher = fetch) {
  const period = PERIODS.has(requestedPeriod) ? requestedPeriod : "7d";
  const sites = readSiteRegistry(env);
  const monitored = await Promise.all(sites.map(async (site) => {
    const [availability, analytics, errors] = await Promise.allSettled([
      uptime(site, fetcher), posthogMetrics(site, env, period, fetcher), sentryMetrics(site, env, period, fetcher),
    ]);
    return {
      ...site,
      uptime: settled(availability, { status: "unknown", statusCode: null, responseMs: null }),
      analytics: settled(analytics, { configured: Boolean(env.POSTHOG_PERSONAL_API_KEY) }),
      errors: settled(errors, { configured: Boolean(env.SENTRY_AUTH_TOKEN) }),
    };
  }));
  const totals = monitored.reduce((all, site) => ({
    visitors: all.visitors + Number(site.analytics.visitors || 0),
    sessions: all.sessions + Number(site.analytics.sessions || 0),
    pageviews: all.pageviews + Number(site.analytics.pageviews || 0),
    conversions: all.conversions + Number(site.analytics.conversions || 0),
    unresolvedIssues: all.unresolvedIssues + Number(site.errors.unresolvedIssues || 0),
    sitesUp: all.sitesUp + Number(site.uptime.status === "up"),
  }), { visitors: 0, sessions: 0, pageviews: 0, conversions: 0, unresolvedIssues: 0, sitesUp: 0 });
  return { period, totals, sites: monitored };
}
