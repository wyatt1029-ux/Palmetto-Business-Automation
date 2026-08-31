import { normalizeBusinessName, normalizeDomain } from "./leads.js";

export const DISCOVERY_FOCUSES = ["both", "new_business", "website_opportunity"];
export const DISCOVERY_RESULT_LIMITS = [5, 10, 20];

const excludedHosts = [
  "facebook.com", "instagram.com", "linkedin.com", "yelp.com", "yellowpages.com",
  "google.com", "googleusercontent.com", "bing.com", "x.com", "twitter.com",
  "mapquest.com", "bbb.org", "tripadvisor.com", "nextdoor.com", "angi.com",
  "homeadvisor.com", "thumbtack.com", "houzz.com", "buildzoom.com", "porch.com",
  "expertise.com", "manta.com", "chamberofcommerce.com", "merchantcircle.com",
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
  const typeText = businessTypes.length ? businessTypes.map((type) => `"${type}"`).join(" OR ") : "\"service business\" OR contractor OR \"local business\"";
  const exclusions = "-site:yelp.com -site:facebook.com -site:instagram.com -site:linkedin.com -site:yellowpages.com -site:angi.com -site:homeadvisor.com -site:thumbtack.com -site:houzz.com -site:buildzoom.com";
  const queries = [];
  if (focus !== "website_opportunity") {
    queries.push(`(\"now open\" OR \"grand opening\" OR \"new business\" OR \"opening soon\") \"${location}\" (${typeText}) ${exclusions}`);
  }
  if (focus !== "new_business") {
    queries.push(`(${typeText}) \"${location}\" (contact OR services OR \"request a quote\") -directory -magazine ${exclusions}`);
    queries.push(`(${typeText}) \"${location}\" (booking OR appointment OR estimate) -directory -magazine ${exclusions}`);
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

const attributeValue = (tag, name) => decodeEntities(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || "").trim();

const metaValue = (source, names) => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attributeValue(tag, "property") || attributeValue(tag, "name")).toLowerCase();
    const value = attributeValue(tag, "content");
    if (wanted.has(key) && value) return text(value, 200);
  }
  return "";
};

const flattenJsonLd = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  return [value, ...flattenJsonLd(value["@graph"])];
};

const businessSchemaTypes = new Set([
  "organization", "localbusiness", "professionalservice", "homeandconstructionbusiness",
  "contractor", "store", "restaurant", "healthandbeautybusiness", "automotivebusiness",
  "legalservice", "financialservice", "medicalbusiness", "lodgingbusiness", "sportsactivitylocation",
]);

const schemaValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(schemaValues);
  if (value && typeof value === "object") return [value.name, value.addressLocality, value.addressRegion, value.postalCode].flatMap(schemaValues);
  return value == null ? [] : [String(value)];
};

const structuredLocationDetails = (source) => {
  const details = { cities: [], regions: [], postalCodes: [], serviceAreas: [], hasLocalAddress: false };
  for (const script of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of flattenJsonLd(JSON.parse(script[1]))) {
        const addresses = Array.isArray(item.address) ? item.address : [item.address];
        for (const address of addresses.filter(Boolean)) {
          if (typeof address !== "object") continue;
          if (address.addressLocality) details.cities.push(...schemaValues(address.addressLocality));
          if (address.addressRegion) details.regions.push(...schemaValues(address.addressRegion));
          if (address.postalCode) details.postalCodes.push(...schemaValues(address.postalCode));
          if (address.addressLocality || address.addressRegion || address.postalCode) details.hasLocalAddress = true;
        }
        details.serviceAreas.push(...schemaValues(item.areaServed || item.serviceArea));
      }
    } catch {
      // Invalid unrelated structured data is ignored.
    }
  }
  for (const key of ["cities", "regions", "postalCodes", "serviceAreas"]) {
    details[key] = [...new Set(details[key].map((value) => text(value, 120)).filter(Boolean))];
  }
  return details;
};

const structuredBusinessIdentity = (source) => {
  const candidates = [];
  for (const script of source.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of flattenJsonLd(JSON.parse(script[1]))) {
        const types = (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]])
          .map((type) => String(type || "").split(/[\/#]/).pop().toLowerCase());
        const name = text(item.name, 200);
        if (!name || !types.some((type) => businessSchemaTypes.has(type))) continue;
        const local = types.some((type) => type !== "organization");
        candidates.push({ name, source: local ? "structured business data" : "organization data", rank: local ? 2 : 1 });
      }
    } catch {
      // A malformed unrelated JSON-LD block should not prevent page review.
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0] || null;
};

const pageTitleLooksLikeListicle = (title) => /\b(?:top|best)\s+\d+\b|\b\d+\s+(?:best|top)\b|\b(?:directory|list of|guide to)\b/i.test(title);
const genericPageTitle = (title) => /^(?:request (?:a )?quote|contact(?: us)?|home|services?|welcome|our work|about us)$/i.test(title.trim());
const publisherIdentity = (value) => /\b(?:directory|magazine|news|reviews?|listings?|best of|top \d+|find (?:a|the)|charleston(?:'s|s) finest)\b/i.test(value || "");

const typeAliases = new Map([
  ["plumber", ["plumber", "plumbing"]],
  ["plumbing contractor", ["plumber", "plumbing"]],
  ["marine service", ["marine", "boat repair", "boat service", "outboard", "yacht service"]],
  ["boat repair", ["boat repair", "marine service", "outboard repair"]],
  ["auto service", ["auto service", "auto repair", "automotive", "mechanic"]],
  ["auto repair", ["auto repair", "automotive", "mechanic"]],
]);

const containsPhrase = (haystack, needle) => {
  const cleanNeedle = String(needle || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleanNeedle) return false;
  const cleanHaystack = String(haystack || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return ` ${cleanHaystack} `.includes(` ${cleanNeedle} `);
};

export const pageMatchesBusinessTypes = (analysis, businessTypes = []) => {
  if (!businessTypes.length) return true;
  return businessTypes.some((type) => {
    const normalized = String(type).toLowerCase().trim();
    const aliases = typeAliases.get(normalized) || [normalized];
    return aliases.some((alias) => containsPhrase(analysis.searchableText, alias));
  });
};

export const pageMatchesLocation = (analysis, requestedLocation) => {
  const requested = String(requestedLocation || "").toLowerCase().trim();
  const details = analysis.locationDetails || { cities: [], regions: [], postalCodes: [], serviceAreas: [] };
  const allStructured = [...details.cities, ...details.regions, ...details.postalCodes, ...details.serviceAreas].join(" ");
  const areaCode = requested.match(/\b(\d{3})\s*(?:area\s*code)?\b/);
  if (areaCode && /area\s*code/.test(requested)) {
    const phone = String(analysis.publicPhone || "").replace(/\D/g, "").replace(/^1/, "");
    const matched = phone.startsWith(areaCode[1]) || containsPhrase(analysis.searchableText, areaCode[1]);
    return { matched, evidence: matched ? `${areaCode[1]} public phone or service-area reference` : null };
  }
  const zip = requested.match(/\b\d{5}\b/)?.[0];
  if (zip) {
    const matched = details.postalCodes.includes(zip) || containsPhrase(analysis.searchableText, zip);
    return { matched, evidence: matched ? `${zip} address or service-area reference` : null };
  }
  if (/^(?:south carolina|sc)$/.test(requested)) {
    const matched = details.regions.some((region) => /^(?:sc|south carolina)$/i.test(region))
      || containsPhrase(analysis.searchableText, "south carolina") || containsPhrase(analysis.searchableText, "sc");
    return { matched, evidence: matched ? "South Carolina address or service-area reference" : null };
  }
  const primary = requested.split(",")[0].replace(/\b(?:county|region)\b/g, "").trim();
  const matched = containsPhrase(allStructured, primary) || containsPhrase(analysis.searchableText, primary);
  return { matched, evidence: matched ? `${primary} address or service-area reference` : null };
};

export function analyzeBusinessPage(html = "", pageUrl = "") {
  const source = String(html).slice(0, 600_000);
  const lower = source.toLowerCase();
  const searchableText = stripTags(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "));
  const locationDetails = structuredLocationDetails(source);
  const page = safePublicUrl(pageUrl);
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(source);
  const hasForm = /<form\b/i.test(source);
  const hasPhone = /href\s*=\s*["']tel:/i.test(source);
  const hasEmail = /href\s*=\s*["']mailto:/i.test(source);
  const hasContactLink = /href\s*=\s*["'][^"']*(contact|quote|estimate|request|inquir)[^"']*["']/i.test(source);
  const hasBooking = /href\s*=\s*["'][^"']*(book|schedule|appointment|calendly)[^"']*["']/i.test(source);
  const hasPayment = /href\s*=\s*["'][^"']*(pay|checkout|stripe|paypal|squareup)[^"']*["']/i.test(source);
  const usesHttps = page?.protocol === "https:";
  const hasMixedContent = usesHttps && /<(?:script|img|link|iframe|audio|video|source)\b[^>]+(?:src|href)\s*=\s*["']http:\/\//i.test(source);
  const hasLegacyMarkup = /<(?:frameset|frame|font|center|marquee|applet)(?:\s|\/?>)|classid\s*=\s*["'][^"']*(?:clsid|shockwave)|<!--\[if\s+(?:lt|lte|gt|gte)?\s*IE\b/i.test(source);
  const layoutTags = source.match(/<(?:body|main|div|table)\b[^>]*>/gi) || [];
  const hasFixedWidthLayout = layoutTags.some((tag) => (
    /\bwidth\s*=\s*["']?(?:[6-9]\d{2}|1[0-4]\d{2})(?:px)?(?:["'\s>])/i.test(tag)
    || /(?:["';\s])width\s*:\s*(?:[6-9]\d{2}|1[0-4]\d{2})px\b/i.test(tag)
  ));
  const commerceContext = /\b(deposit|invoice|payment|checkout|order online|pay online)\b/i.test(lower);
  const fitReasons = [];
  const servicesInterest = [];
  if (!hasViewport) {
    fitReasons.push("Mobile viewport setup was not found");
    servicesInterest.push("website");
  }
  if (!usesHttps) {
    fitReasons.push("Website is still served over HTTP");
    servicesInterest.push("website");
  }
  if (hasMixedContent) {
    fitReasons.push("Secure page includes insecure asset links");
    servicesInterest.push("website");
  }
  if (hasLegacyMarkup) {
    fitReasons.push("Legacy page technology was detected");
    servicesInterest.push("website");
  }
  if (hasFixedWidthLayout) {
    fitReasons.push("Fixed-width page structure may limit smaller-screen usability");
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
  const identity = structuredBusinessIdentity(source)
    || (() => {
      const name = metaValue(source, ["og:site_name", "application-name"]);
      return name ? { name, source: "site identity", rank: 0 } : null;
    })();
  const phone = decodeEntities(source.match(/href\s*=\s*["']tel:([^"'#?]+)/i)?.[1] || "").trim() || null;
  const email = decodeEntities(source.match(/href\s*=\s*["']mailto:([^"'?]+)/i)?.[1] || "").trim() || null;
  const contactHref = source.match(/href\s*=\s*["']([^"']*(?:contact|quote|estimate|request|inquir)[^"']*)["']/i)?.[1];
  let contactFormUrl = null;
  if (contactHref && safePublicUrl(pageUrl)) {
    try { contactFormUrl = new URL(contactHref, pageUrl).href; } catch { contactFormUrl = null; }
  }
  return {
    title,
    businessName: identity?.name || null,
    businessIdentitySource: identity?.source || null,
    pageTitleLooksLikeListicle: pageTitleLooksLikeListicle(title),
    genericPageTitle: genericPageTitle(title),
    publisherIdentity: publisherIdentity(`${identity?.name || ""} ${title}`),
    searchableText,
    locationDetails,
    primaryCity: locationDetails.cities[0] || null,
    fitReasons: [...new Set(fitReasons)].slice(0, 10),
    servicesInterest: [...new Set(servicesInterest)].slice(0, 6),
    publicPhone: text(phone, 80) || null,
    publicEmail: text(email, 254) || null,
    publicContactFormUrl: safePublicUrl(contactFormUrl)?.href || null,
    launchSignals: launchSignalsFor(stripTags(source)),
    marineContext: marinePattern.test(stripTags(source)),
    checks: {
      hasViewport,
      hasForm,
      hasPhone,
      hasEmail,
      hasContactLink,
      hasBooking,
      hasPayment,
      usesHttps,
      hasSecureAssets: !hasMixedContent,
      hasModernMarkup: !hasLegacyMarkup,
      hasFlexibleLayout: !hasFixedWidthLayout,
    },
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
    if (analysis.pageTitleLooksLikeListicle || analysis.publisherIdentity) return null;
    if (analysis.genericPageTitle && !analysis.businessName) return null;
    if (!pageMatchesBusinessTypes(analysis, criteria.businessTypes)) return null;
    const locationMatch = pageMatchesLocation(analysis, criteria.location);
    if (!locationMatch.matched) return null;
    const domain = normalizeDomain(inspected.url);
    const businessName = analysis.businessName
      || (analysis.genericPageTitle ? domain : cleanBusinessName(analysis.title || domain.split(".")[0]));
    const fitReasons = [...analysis.fitReasons];
    const servicesInterest = [...analysis.servicesInterest];
    if (!fitReasons.length && analysis.launchSignals.length) {
      fitReasons.push("New-business launch signal was found; review its website and customer intake path");
      servicesInterest.push("website");
    }
    if (!fitReasons.length) return null;
    const marine = analysis.marineContext || marinePattern.test(businessName);
    return {
      id: crypto.randomUUID(),
      businessName,
      websiteUrl: new URL(inspected.url).origin,
      normalizedDomain: domain,
      city: analysis.primaryCity || criteria.location,
      serviceArea: criteria.location,
      industry: criteria.businessTypes.join(", ") || null,
      sourceUrls: [inspected.url],
      fitLevel: fitReasons.length >= 3 ? "high" : fitReasons.length ? "medium" : "low",
      fitReasons,
      servicesInterest: [...new Set(servicesInterest)],
      launchSignals: analysis.launchSignals,
      dateConfidence: "unknown",
      publicPhone: analysis.publicPhone,
      publicEmail: analysis.publicEmail,
      publicContactFormUrl: analysis.publicContactFormUrl,
      locationEvidence: locationMatch.evidence,
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
