import { secureJson } from "../_lib/security.js";

// This endpoint intentionally exposes only browser-safe configuration. Never add
// secrets here: Turnstile's site key is public by design; its secret stays in
// Cloudflare Pages as TURNSTILE_SECRET_KEY.
export async function onRequestGet({ env }) {
  return secureJson({
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
  });
}
