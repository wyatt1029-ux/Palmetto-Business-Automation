import { neon } from "@neondatabase/serverless";
import {
  assertSameOrigin,
  cleanText,
  escapeHtml,
  handleError,
  readJson,
  secureJson,
  verifyTurnstile,
} from "../_lib/security.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const makeToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const safeSubject = (value) => String(value).replace(/[\r\n]+/g, " ").slice(0, 180);

const sendMail = async (env, to, subject, content) => {
  if (!env.OUTLOOK_ACCESS_TOKEN) return false;
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OUTLOOK_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: safeSubject(subject),
        body: { contentType: "HTML", content },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
  });
  return response.ok;
};

export async function onRequestPost({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const data = await readJson(request, 32_000);
    if (data.website) return secureJson({ ok: true });
    await verifyTurnstile(request, env, data.turnstileToken);

    const idempotencyKey = cleanText(data.idempotencyKey, "Submission identifier", { required: true, max: 80 });
    if (!/^[a-f0-9-]{20,80}$/i.test(idempotencyKey)) {
      throw Object.assign(new Error("Submission identifier is invalid."), { status: 422 });
    }
    if (data.consent !== "on" && data.consent !== true) {
      throw Object.assign(new Error("Consent is required."), { status: 422 });
    }

    const values = {
      fullName: cleanText(data.fullName, "Full name", { required: true, max: 160 }),
      email: cleanText(data.email, "Email", { required: true, max: 254 }).toLowerCase(),
      organization: cleanText(data.organization, "Organization", { required: true, max: 200 }),
      role: cleanText(data.role, "Role", { required: true, max: 200 }),
      problem: cleanText(data.problem, "Business problem", { required: true, max: 4_000 }),
      outcomes: cleanText(data.outcomes, "Desired outcomes", { required: true, max: 4_000 }),
      users: cleanText(data.users, "Users", { required: true, max: 3_000 }),
      currentWorkflow: cleanText(data.currentWorkflow, "Current workflow", { required: true, max: 5_000 }),
      integrations: cleanText(data.integrations, "Integrations", { max: 2_000 }),
      features: cleanText(data.features, "Requested features", { required: true, max: 5_000 }),
      constraints: cleanText(data.constraints, "Constraints", { max: 3_000 }),
      context: cleanText(data.context, "Supporting context", { max: 5_000 }),
      timeline: cleanText(data.timeline, "Timeline", { required: true, max: 100 }),
      budget: cleanText(data.budget, "Budget", { required: true, max: 100 }),
      decisionProcess: cleanText(data.decisionProcess, "Decision process", { max: 3_000 }),
    };
    if (!emailPattern.test(values.email)) {
      throw Object.assign(new Error("Please provide a valid email."), { status: 422 });
    }

    const sql = neon(env.DATABASE_URL);
    const prior = await sql`
      select id, customer_number from intake_submissions
      where idempotency_key = ${idempotencyKey}
      limit 1
    `;
    if (prior.length) {
      return secureJson({ ok: true, id: prior[0].id, customerNumber: prior[0].customer_number });
    }

    const revisionToken = makeToken();
    const tokenHash = await digest(revisionToken);
    const rows = await sql`
      insert into intake_submissions
        (full_name, email, organization, role, problem, outcomes, users, current_workflow,
         integrations, features, constraints, context, timeline, budget, decision_process,
         idempotency_key, revision_token_hash, revision_token_expires_at)
      values
        (${values.fullName}, ${values.email}, ${values.organization}, ${values.role},
         ${values.problem}, ${values.outcomes}, ${values.users}, ${values.currentWorkflow},
         ${values.integrations || null}, ${values.features}, ${values.constraints || null},
         ${values.context || null}, ${values.timeline}, ${values.budget},
         ${values.decisionProcess || null}, ${idempotencyKey}, ${tokenHash},
         now() + interval '30 days')
      returning id, customer_number
    `;
    const id = rows[0].id;
    const customerNumber = rows[0].customer_number;
    const revisionUrl = `${env.PUBLIC_SITE_URL}/intake.html?submission=${id}&token=${revisionToken}`;

    if (env.INTAKE_OWNER_EMAIL) {
      await sendMail(
        env,
        env.INTAKE_OWNER_EMAIL,
        `New project intake: ${customerNumber} · ${values.organization}`,
        `<p><strong>${escapeHtml(values.fullName)}</strong> from <strong>${escapeHtml(values.organization)}</strong> submitted project intake <strong>${escapeHtml(customerNumber)}</strong>.</p><p>${escapeHtml(values.problem)}</p><p>Review it in the private intake queue.</p>`,
      );
    }
    await sendMail(
      env,
      values.email,
      `${customerNumber} · Your PBA project intake`,
      `<p>Hello ${escapeHtml(values.fullName)},</p><p>Thank you for sharing your project with Palmetto Business Automation.</p><p>Your customer number is <strong>${escapeHtml(customerNumber)}</strong>. It will stay with your quote, scope, approval, and payment.</p><p><a href="${escapeHtml(revisionUrl)}">Review or update your intake</a></p><p>This secure link expires in 30 days.</p>`,
    );

    return secureJson({ ok: true, id, customerNumber }, 201);
  } catch (error) {
    return handleError(error);
  }
}
