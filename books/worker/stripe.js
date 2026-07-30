const stripeRequest = async (env, path, options = {}) => {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured.");
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(options.headers || {}),
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Stripe request failed.");
  return result;
};

export const stripeForm = (env, path, form, idempotencyKey) =>
  stripeRequest(env, path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: form,
  });

export const stripeGet = (env, path) => stripeRequest(env, path);

const bytesFromHex = (value) => {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g).map((part) => Number.parseInt(part, 16)));
};

export async function verifyStripeWebhook(payload, header, secret) {
  if (!secret) return false;
  const parts = (header || "").split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    const bytes = bytesFromHex(signature);
    if (bytes && await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
  }
  return false;
}
