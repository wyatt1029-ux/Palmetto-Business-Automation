import { normalizeBusinessName, normalizeDomain } from "./leads.js";

export const DISCOVERY_FOCUSES = ["both", "new_business", "website_opportunity"];
export const DISCOVERY_RESULT_LIMITS = [5, 10, 20];

const excludedHosts = [
  "facebook.com", "instagram.com", "linkedin.com", "yelp.com", "yellowpages.com",
  "google.com", "googleusercontent.com", "bing.com", "x.com", "twitter.com",
  "mapquest.com", "bbb.org", "tripadvisor.com", "nextdoor.com",
];
const marinePattern = /\b(marine|boat|boating|yacht|outboard|watercraft|dock|marina)\b/i;
const launchPatterns = [
  [/\bnow open\b/i, "Now open announcement"],
  [/\bgrand opening\b/i, "Grand opening announcement"],
  [/\bnew(?:ly)? opened\b/i, "Newly opened business"],
  [/\bnew business\b/i, "New business announcement"],
  [/\bopening soon\b/i, "Opening soon announcement"],
  [/\blaunch(?:ed|ing)?\b/i, "Business launch announcement"],
];

const text = (value, max) => String(value ?? "").replaceAll("\u0000", "").trim().slice(0, max);
const asTypes = (value) => (Array.isArray(value) ? value : String(value || "").split(","))
  .map((item) => text(item, 80))
  .filter(Boolean)
  .slice(0, 8);

export function validateDiscoveryInput(data = {}) {
  const location = text(data.location, 120);
  if (!location) throw Object.assign(new Error("Search area is required."), { status: 422 });
  const focus = text(data.focus || "both", 30);
  if (!DISCOVERY_FOCUSES.includes(focus)) throw Object.assign(new Error("Search focus is invalid."), { status: 422 });
  const maxResults = Number(data.maxResults || 10);
  if (!DISCOVERY_RESULT_LIMITS.includes(maxResults)) throw Object.assign(new Error("Result limit is invalid."), { status: 422 });
  const businessTypes = asTypes(data.businessTypes);
  return { location, focus, maxResults, businessTypes };
}

export function buildDiscoveryQueries({ location, focus, businessTypes }) {
  const typeText = businessTypes.length ? businessTypes.join(" OR ") : "service business OR contractor OR local business";
  const exclusions = "-site:yelp.com -site:facebook.com -site:instagram.com -site:linkedin.com -site:yellowpages.com";
  const queries = [];
  if (focus !== "website_opportunity") {
    queries.push(`(\"now open\" OR \"grand opening\" OR \"new business\" OR \"opening soon\") \"${location}\" (${typeText}) ${exclusions}`);
  }
  if (focus !== "new_business") {
    queries.push(`(${typeText}) \"${location}\" (contact OR services OR \"request a quote\") ${exclusions}`);
    queries.push(`(${typeText}) \"${location}\" (booking OR appointment OR estimate) ${exclusions}`);
  }
  return queries;
}

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export function safePublicUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if ((url.port && url.protocol === "https:" && url.port !== "443") || (url.port && url.protocol === "http:" && url.port !== "80")) return null;
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (isPrivateIpv4(host) || host === "::1" || /^f[cd][0-9a-f]*:/i.test(host) || /^fe8[0-9a-f]:/i.test(host)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export const isLikelyBusinessSite = (value) => {
  const url = safePublicUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return !excludedHosts.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
};

const decodeEntities = (value) => String(value || "")
  .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const stripTags = (value) => decodeEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

export function analyzeBusinessPage(html = "", pageUrl = "") {
  const source = String(html).slice(0, 600_000);
  const lower = source.toLowerCase();
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(source);
  const hasForm = /<form\b/i.test(source);
  const hasPhone = /href\s*=\s*["']tel:/i.test(source);
  const hasEmail = /href\s*=\s*["']mailto:/i.test(source);
  const hasContactLink = /href\s*=\s*["'][^"']*(contact|quote|estimate|request|inquir)[^"']*["']/i.test(source);
  const hasBooking = /href\s*=\s*["'][^"']*(book|schedule|appointment|calendly)[^"']*["']/i.test(source);
  const hasPayment = /href\s*=\s*["'][^"']*(pay|checkout|stripe|paypal|squareup)[^"']*["']/i.test(source);
  const commerceContext = /\b(deposit|invoice|payment|checkout|order online|pay online)\b/i.test(lower);
  const fitReasons = [];
  const servicesInterest = [];
  if (!hasViewport) {
    fitReasons.push("Mobile viewport setup was not found");
    servicesInterest.push("website");
  }
  if (!hasForm) {
    fitReasons.push(hasPhone ? "Website appears to rely on phone contact" : "No service-request or intake form found");
    servicesInterest.push("lead workflow");
  }
  if (!hasContactLink && !hasForm && !hasPhone && !hasEmail) {
    fitReasons.push("No clear contact or service-request path found");
    servicesInterest.push("landing page");
  }
  if (!hasBooking) {
    fitReasons.push("No online booking link found");
    servicesInterest.push("workflow");
  }
  if (commerceContext && !hasPayment) {
    fitReasons.push("Payment information appears separate from an online payment flow");
    servicesInterest.push("payment workflow");
  }
  const title = stripTags(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const phone = decodeEntities(source.match(/href\s*=\s*["']tel:([^"'#?]+)/i)?.[1] || "").trim() || null;
  const email = decodeEntities(source.match(/href\s*=\s*["']mailto:([^"'?]+)/i)?.[1] || "").trim() || null;
  const contactHref = source.match(/href\s*=\s*["']([^"']*(?:contact|quote|estimate|request|inquir)[^"']*)["']/i)?.[1];
  let contactFormUrl = null;
  if (contactHref && safePublicUrl(pageUrl)) {
    try { contactFormUrl = new URL(contactHref, pageUrl).href; } catch { contactFormUrl = null; }
  }
  return {
    title,
    fitReasons: [...new Set(fitReasons)].slice(0, 6),
    servicesInterest: [...new Set(servicesInterest)].slice(0, 6),
    publicPhone: text(phone, 80) || null,
    publicEmail: text(email, 254) || null,
    publicContactFormUrl: safePublicUrl(contactFormUrl)?.href || null,
    launchSignals: launchSignalsFor(stripTags(source)),
    marineContext: marinePattern.test(stripTags(source)),
    checks: { hasViewport, hasForm, hasPhone, hasEmail, hasContactLink, hasBooking, hasPayment },
  };
}

const cleanBusinessName = (value) => {
  const name = stripTags(value).split(/\s+[|–—]\s+|\s+-\s+/)[0].replace(/\s+(home|official site)$/i, "").trim();
  return text(name || "Business found in public search", 200);
};

const launchSignalsFor = (value) => launchPatterns.filter(([pattern]) => pattern.test(value)).map(([, label]) => label);

const inspectedSite = async (url, fetchImpl) => {
  const safe = safePublicUrl(url);
  if (!safe || !isLikelyBusinessSite(safe.href)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl(safe.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "PBA-Owner-Research/1.0 (+https://palmettobusinessautomation.com/)" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 1_000_000) return null;
    const finalUrl = safePublicUrl(response.url || safe.href);
    const html = (await response.text()).slice(0, 600_000);
    return { url: finalUrl?.href || safe.href, analysis: analyzeBusinessPage(html, finalUrl?.href || safe.href) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const searchBrave = async (query, count, env, fetchImpl) => {
  if (typeof env.__TEST_SEARCH === "function") return env.__TEST_SEARCH(query, count);
  if (!env.BRAVE_SEARCH_API_KEY) throw Object.assign(new Error("Web search is not configured. Add the BRAVE_SEARCH_API_KEY secret to Cloudflare Pages."), { status: 503 });
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(count, 20)));
  url.searchParams.set("safesearch", "moderate");
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "x-subscription-token": env.BRAVE_SEARCH_API_KEY },
  });
  if (!response.ok) {
    console.error("[lead-discovery] search provider error", { status: response.status });
    throw Object.assign(new Error("The search provider could not complete this request."), { status: 502 });
  }
  const body = await response.json();
  return Array.isArray(body?.web?.results) ? body.web.results : [];
};

export async function discoverBusinesses(input, env = {}) {
  const criteria = validateDiscoveryInput(input);
  const queries = buildDiscoveryQueries(criteria);
  const fetchImpl = env.__TEST_FETCH || fetch;
  const perQuery = Math.min(20, Math.max(5, Math.ceil(criteria.maxResults / queries.length) + 3));
  const resultGroups = await Promise.all(queries.map((query) => searchBrave(query, perQuery, env, fetchImpl)));
  const seen = new Set();
  const searchResults = resultGroups.flat().filter((result) => {
    const url = safePublicUrl(result?.url);
    if (!url || !isLikelyBusinessSite(url.href)) return false;
    const key = `${normalizeDomain(url.href)}:${normalizeBusinessName(result.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, criteria.maxResults);

  const candidates = (await Promise.all(searchResults.map(async (result) => {
    const inspected = await inspectedSite(result.url, fetchImpl);
    // Brave results are discovery pointers only. Persistable candidate fields below
    // come from the independently fetched business website, not the search result.
    if (!inspected) return null;
    const analysis = inspected.analysis;
    const businessName = cleanBusinessName(analysis.title || normalizeDomain(inspected.url).split(".")[0]);
    const fitReasons = analysis.fitReasons.length ? analysis.fitReasons : ["No obvious website or workflow gap was found in the automated check"];
    const marine = analysis.marineContext || marinePattern.test(businessName);
    return {
      id: crypto.randomUUID(),
      businessName,
      websiteUrl: new URL(inspected.url).origin,
      normalizedDomain: normalizeDomain(inspected.url),
      city: criteria.location,
      serviceArea: criteria.location,
      industry: criteria.businessTypes.join(", ") || null,
      sourceUrls: [inspected.url],
      fitLevel: fitReasons.length >= 3 ? "high" : fitReasons.length ? "medium" : "low",
      fitReasons,
      servicesInterest: analysis.servicesInterest,
      launchSignals: analysis.launchSignals,
      dateConfidence: "unknown",
      publicPhone: analysis.publicPhone,
      publicEmail: analysis.publicEmail,
      publicContactFormUrl: analysis.publicContactFormUrl,
      lastVerifiedDate: new Date().toISOString().slice(0, 10),
      tidalConflictReviewRequired: marine,
      tidalConflictReviewStatus: marine ? "pending" : "not_needed",
      checks: analysis.checks,
    };
  }))).filter((candidate) => candidate?.businessName && candidate.normalizedDomain);

  return {
    provider: "Brave Search API",
    criteria,
    queries,
    candidates,
    coverage: `Used ${searchResults.length} search match${searchResults.length === 1 ? "" : "es"} transiently and independently checked ${candidates.length} public business website${candidates.length === 1 ? "" : "s"}. Results are bounded and are not an exhaustive market list.`,
  };
}

export const __test = { cleanBusinessName, isPrivateIpv4, launchSignalsFor };
