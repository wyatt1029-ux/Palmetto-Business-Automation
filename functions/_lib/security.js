import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

const jwksByDomain = new Map();

export const secureJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  },
});

export async function readJson(request, maxBytes = 64_000) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw Object.assign(new Error("Request is too large."), { status: 413 });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid request."), { status: 400 });
  }
}

export function cleanText(value, label, { required = false, max = 1_000 } = {}) {
  const clean = String(value || "").replaceAll("\u0000", "").trim();
  if (required && !clean) {
    throw Object.assign(new Error(`${label} is required.`), { status: 422 });
  }
  if (clean.length > max) {
    throw Object.assign(new Error(`${label} is too long.`), { status: 422 });
  }
  return clean;
}

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export function assertSameOrigin(request, publicUrl) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  // Cloudflare Pages preview deployments have their own hostname. A browser
  // request made by the page is still same-origin even when PUBLIC_SITE_URL
  // points at the canonical/alias hostname used in generated links.
  const allowed = new Set([new URL(request.url).origin]);
  if (publicUrl) allowed.add(new URL(publicUrl).origin);
  if (!allowed.has(origin)) {
    throw Object.assign(new Error("Cross-origin request blocked."), { status: 403 });
  }
}

export async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (env.ENVIRONMENT === "development") return;
    throw Object.assign(new Error("Spam protection is not configured."), { status: 503 });
  }
  if (!token) throw Object.assign(new Error("Please complete the security check."), { status: 422 });
  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: request.headers.get("cf-connecting-ip") || "",
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    throw Object.assign(new Error("The security check failed. Please try again."), { status: 422 });
  }
}

const remoteKeys = (teamDomain) => {
  const normalized = teamDomain.replace(/\/$/, "");
  if (!jwksByDomain.has(normalized)) {
    jwksByDomain.set(
      normalized,
      createRemoteJWKSet(new URL(`${normalized}/cdn-cgi/access/certs`)),
    );
  }
  return jwksByDomain.get(normalized);
};

export async function requireOwner(request, env) {
  if (
    env.ENVIRONMENT === "development" &&
    env.DEV_BYPASS_AUTH === "true" &&
    env.DEV_OWNER_EMAIL
  ) {
    return env.DEV_OWNER_EMAIL.toLowerCase();
  }
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN || !env.OWNER_EMAIL) {
    throw Object.assign(new Error("Owner access is not configured."), { status: 503 });
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw Object.assign(new Error("Owner authentication is required."), { status: 401 });
  try {
    const issuer = env.TEAM_DOMAIN.replace(/\/$/, "");
    const { payload } = await jwtVerify(token, remoteKeys(issuer), {
      issuer,
      audience: env.POLICY_AUD,
    });
    const email = String(payload.email || "").toLowerCase();
    const allowed = env.OWNER_EMAIL.split(",").map((value) => value.trim().toLowerCase());
    if (!email || !allowed.includes(email)) {
      throw Object.assign(new Error("This account is not authorized."), { status: 403 });
    }
    return email;
  } catch (error) {
    if (error.status) throw error;
    let claims = {};
    try {
      const payload = decodeJwt(token);
      claims = {
        tokenIssuer: payload.iss,
        tokenAudience: payload.aud,
        tokenExpiresAt: payload.exp,
      };
    } catch {
      claims = { tokenStructure: "invalid" };
    }
    console.error("[owner-auth] JWT verification failed", {
      code: error.code,
      name: error.name,
      message: error.message,
      expectedIssuer: env.TEAM_DOMAIN.replace(/\/$/, ""),
      expectedAudience: env.POLICY_AUD,
      ...claims,
    });
    throw Object.assign(new Error("Owner session is invalid or expired."), { status: 401 });
  }
}

export const handleError = (error) => {
  const status = error.status || 500;
  const message = error.safeExternalError
    ? error.message
    : status >= 500 && status !== 503
    ? "The request could not be completed."
    : error.message || "The request could not be completed.";
  if (status >= 500) console.error(error);
  return secureJson({ error: message }, status);
};
