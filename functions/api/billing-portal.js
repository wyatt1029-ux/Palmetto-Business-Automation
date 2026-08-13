import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  handleError,
  readJson,
  secureJson,
} from "../_lib/security.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const validId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ""));
const validToken = (value) => /^[0-9a-f]{64,128}$/i.test(String(value || ""));

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const data = await readJson(request, 8_000);
    if (!validId(data.id) || !validToken(data.token)) {
      throw Object.assign(new Error("This billing link is incomplete or invalid."), { status: 400 });
    }
    if (!env.STRIPE_SECRET_KEY) {
      throw Object.assign(new Error("Billing management is not configured."), { status: 503 });
    }
    const tokenHash = await digest(data.token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select stripe_customer_id from sow_versions
      where id = ${data.id} and review_token_hash = ${tokenHash}
        and review_token_expires_at > now() and billing_status = 'active'
    `;
    if (!rows.length || !rows[0].stripe_customer_id) {
      throw Object.assign(new Error("No active automatic payment was found."), { status: 404 });
    }
    const form = new URLSearchParams({
      customer: rows[0].stripe_customer_id,
      return_url: `${env.PUBLIC_SITE_URL}/payment.html?id=${encodeURIComponent(data.id)}&token=${encodeURIComponent(data.token)}`,
    });
    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const result = await response.json();
    if (!response.ok || !result.url) {
      throw Object.assign(new Error("Unable to open Stripe billing management."), { status: 502 });
    }
    return secureJson({ portalUrl: result.url });
  } catch (error) {
    return handleError(error);
  }
}
