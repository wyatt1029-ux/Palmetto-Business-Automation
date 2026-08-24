import { neon } from "@neondatabase/serverless";
import { escapeHtml } from "../_lib/security.js";
import { sendOutlookMail } from "../_lib/email.js";

const bytesFromHex = (value) => {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g).map((part) => Number.parseInt(part, 16)));
};

const verify = async (payload, header, secret) => {
  if (!secret) return false;
  const parts = (header || "").split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || !Number.isFinite(Number(timestamp))) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedPayload = new TextEncoder().encode(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    const bytes = bytesFromHex(signature);
    if (bytes && await crypto.subtle.verify("HMAC", key, bytes, signedPayload)) return true;
  }
  return false;
};

const subscriptionId = (object) =>
  object.subscription || object.parent?.subscription_details?.subscription || null;

const notifyOwner = (env, subject, html) => sendOutlookMail(env, {
  to: env.INTAKE_OWNER_EMAIL,
  subject,
  html,
});

export async function onRequestPost({ request, env }) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 1_000_000) return new Response("Payload too large", { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 1_000_000) {
    return new Response("Payload too large", { status: 413 });
  }
  if (!await verify(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  if (!event?.id || !event?.type || !event?.data?.object) {
    return new Response("Invalid event", { status: 400 });
  }

  const object = event.data.object;
  const sql = neon(env.DATABASE_URL);
  const inserted = await sql`
    insert into stripe_webhook_events (event_id, event_type)
    values (${String(event.id).slice(0, 255)}, ${String(event.type).slice(0, 255)})
    on conflict (event_id) do nothing
    returning event_id
  `;
  if (!inserted.length) return new Response("ok");

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const recurring = object.mode === "subscription";
      await sql`
        update payment_sessions
        set status = 'paid', stripe_payment_intent_id = ${object.payment_intent},
            stripe_subscription_id = ${object.subscription},
            paid_at = coalesce(paid_at, now()), updated_at = now()
        where stripe_checkout_session_id = ${object.id}
      `;
      if (object.metadata?.sow_version_id) {
        await sql`
          update sow_versions
          set payment_status = 'paid', billing_status = ${recurring ? "active" : "not_started"},
              stripe_customer_id = ${object.customer},
              stripe_subscription_id = ${object.subscription}, updated_at = now()
          where id = ${object.metadata.sow_version_id}
        `;
        await notifyOwner(
          env,
          `${recurring ? "Monthly autopay activated" : "Payment received"} · ${object.metadata.customer_number || "PBA customer"}`,
          `<p><strong>${escapeHtml(object.metadata.project_title || "PBA professional services")}</strong></p><p>Customer ${escapeHtml(object.metadata.customer_number || "")} ${recurring ? "activated monthly automatic payments" : "completed payment"}.</p>`,
        );
      }
    } else if (event.type === "checkout.session.async_payment_failed") {
      await sql`
        update payment_sessions set status = 'failed', updated_at = now()
        where stripe_checkout_session_id = ${object.id}
      `;
      if (object.metadata?.sow_version_id) {
        await sql`
          update sow_versions set payment_status = 'failed', updated_at = now()
          where id = ${object.metadata.sow_version_id}
        `;
      }
      await notifyOwner(
        env,
        `Payment failed · ${object.metadata?.customer_number || "PBA customer"}`,
        `<p>Payment failed for <strong>${escapeHtml(object.metadata?.project_title || "PBA professional services")}</strong>.</p>`,
      );
    } else if (event.type === "checkout.session.expired") {
      await sql`
        update payment_sessions set status = 'expired', updated_at = now()
        where stripe_checkout_session_id = ${object.id}
      `;
    } else if (event.type === "invoice.paid") {
      const subscription = subscriptionId(object);
      if (object.metadata?.sow_version_id) {
        await sql`
          update sow_versions
          set payment_status = 'paid',
              billing_status = ${subscription ? "active" : "not_started"},
              stripe_customer_id = coalesce(${object.customer || null}, stripe_customer_id),
              stripe_invoice_id = ${object.id},
              stripe_hosted_invoice_url = coalesce(${object.hosted_invoice_url || null}, stripe_hosted_invoice_url),
              stripe_subscription_id = coalesce(${subscription}, stripe_subscription_id),
              updated_at = now()
          where id = ${object.metadata.sow_version_id}
        `;
        await notifyOwner(
          env,
          `${subscription ? "Monthly invoice paid" : "Invoice paid"} · ${object.metadata.customer_number || "PBA customer"}`,
          `<p><strong>${escapeHtml(object.metadata.project_title || "PBA professional services")}</strong></p><p>Customer ${escapeHtml(object.metadata.customer_number || "")} paid invoice ${escapeHtml(object.id)}.</p>`,
        );
      } else if (subscription) {
        await sql`
          update sow_versions
          set payment_status = 'paid', billing_status = 'active',
              stripe_invoice_id = ${object.id},
              stripe_hosted_invoice_url = coalesce(${object.hosted_invoice_url || null}, stripe_hosted_invoice_url),
              updated_at = now()
          where stripe_subscription_id = ${subscription}
        `;
      }
    } else if (event.type === "invoice.payment_failed") {
      const subscription = subscriptionId(object);
      if (object.metadata?.sow_version_id) {
        await sql`
          update sow_versions
          set payment_status = 'failed', billing_status = ${subscription ? "past_due" : "not_started"},
              stripe_invoice_id = ${object.id},
              stripe_hosted_invoice_url = coalesce(${object.hosted_invoice_url || null}, stripe_hosted_invoice_url),
              updated_at = now()
          where id = ${object.metadata.sow_version_id}
        `;
        await notifyOwner(
          env,
          `Invoice payment failed · ${object.metadata.customer_number || "PBA customer"}`,
          `<p>Stripe invoice <strong>${escapeHtml(object.id)}</strong> could not be paid for ${escapeHtml(object.metadata.project_title || "the approved project")}.</p>`,
        );
      } else if (subscription) {
        await sql`
          update sow_versions set payment_status = 'failed', billing_status = 'past_due', updated_at = now()
          where stripe_subscription_id = ${subscription}
        `;
        await notifyOwner(
          env,
          "Monthly automatic payment failed",
          `<p>A recurring Stripe payment failed for subscription <strong>${escapeHtml(subscription)}</strong>. Review it in Stripe.</p>`,
        );
      }
    } else if (event.type === "customer.subscription.updated") {
      const active = ["active", "trialing"].includes(object.status);
      const pastDue = ["past_due", "unpaid"].includes(object.status);
      const billingStatus = active
        ? "active"
        : pastDue
          ? "past_due"
          : ["canceled", "incomplete_expired"].includes(object.status)
            ? "canceled"
            : "not_started";
      await sql`
        update sow_versions set billing_status = ${billingStatus}, updated_at = now()
        where stripe_subscription_id = ${object.id}
      `;
    } else if (event.type === "customer.subscription.deleted") {
      await sql`
        update sow_versions set billing_status = 'canceled', updated_at = now()
        where stripe_subscription_id = ${object.id}
      `;
      await notifyOwner(
        env,
        "Monthly automatic payment canceled",
        `<p>Stripe subscription <strong>${escapeHtml(object.id)}</strong> was canceled.</p>`,
      );
    }
    return new Response("ok");
  } catch (error) {
    console.error(error);
    await sql`delete from stripe_webhook_events where event_id = ${event.id}`;
    return new Response("Temporary processing failure", { status: 500 });
  }
}
