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
import { sendOutlookMail } from "../_lib/email.js";
import { syncLeadFromIntake } from "../_lib/leads.js";

const digest = async (value) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
const makeToken = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  .test(String(value || ""));
const validToken = (value) => /^[0-9a-f]{64,128}$/i.test(String(value || ""));

const readIntakeValues = (data) => {
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
    budget: cleanText(data.budget, "Budget", { max: 100 }),
    decisionProcess: cleanText(data.decisionProcess, "Decision process", { max: 3_000 }),
  };
  if (!emailPattern.test(values.email)) {
    throw Object.assign(new Error("Please provide a valid email."), { status: 422 });
  }
  return values;
};

const publicIntake = (row) => ({
  id: row.id,
  customerNumber: row.customer_number,
  fullName: row.full_name,
  email: row.email,
  organization: row.organization,
  role: row.role,
  problem: row.problem,
  outcomes: row.outcomes,
  users: row.users,
  currentWorkflow: row.current_workflow,
  integrations: row.integrations || "",
  features: row.features,
  constraints: row.constraints || "",
  context: row.context || "",
  timeline: row.timeline,
  budget: row.budget || "",
  decisionProcess: row.decision_process || "",
});

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("submission");
    const token = url.searchParams.get("token");
    if (!validId(id) || !validToken(token)) {
      throw Object.assign(new Error("This revision link is incomplete or invalid."), { status: 400 });
    }
    const tokenHash = await digest(token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      select id, customer_number, full_name, email, organization, role, problem,
        outcomes, users, current_workflow, integrations, features, constraints,
        context, timeline, budget, decision_process
      from intake_submissions
      where id = ${id} and revision_token_hash = ${tokenHash}
        and revision_token_expires_at > now()
      limit 1
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This revision link is invalid or has expired."), { status: 404 });
    }
    return secureJson({ intake: publicIntake(rows[0]) });
  } catch (error) {
    return handleError(error);
  }
}

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
    const values = readIntakeValues(data);

    const sql = neon(env.DATABASE_URL);
    const prior = await sql`
      select id, customer_number from intake_submissions
      where idempotency_key = ${idempotencyKey}
      limit 1
    `;
    if (prior.length) {
      return secureJson({ ok: true, id: prior[0].id, customerNumber: prior[0].customer_number, duplicate: true });
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
    try {
      await syncLeadFromIntake(sql, { id, customerNumber, organization: values.organization });
    } catch (leadError) {
      // Keep the existing public intake confirmation reliable if the optional
      // owner workspace migration is not yet applied; the error is visible in
      // server logs for follow-up.
      console.error("Sales workspace lead sync failed.", leadError);
    }
    const revisionUrl = `${env.PUBLIC_SITE_URL}/intake?submission=${id}&token=${revisionToken}`;

    if (env.INTAKE_OWNER_EMAIL) {
      await sendOutlookMail(env, {
        to: env.INTAKE_OWNER_EMAIL,
        subject: `New project intake: ${customerNumber} · ${values.organization}`,
        html: `<p><strong>${escapeHtml(values.fullName)}</strong> from <strong>${escapeHtml(values.organization)}</strong> submitted project intake <strong>${escapeHtml(customerNumber)}</strong>.</p><p>${escapeHtml(values.problem)}</p><p>Review it in the private intake queue.</p>`,
      });
    }
    const emailDelivered = await sendOutlookMail(env, {
      to: values.email,
      subject: `${customerNumber} · Your PBA project intake`,
      html: `<p>Hello ${escapeHtml(values.fullName)},</p><p>Thank you for sharing your project with Palmetto Business Automation.</p><p>Your customer number is <strong>${escapeHtml(customerNumber)}</strong>. It will stay with your quote, scope, approval, and payment.</p><p><a href="${escapeHtml(revisionUrl)}">Review or update your intake</a></p><p>This secure link expires in 30 days.</p>`,
    });

    return secureJson({ ok: true, id, customerNumber, revisionUrl, emailDelivered }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    assertSameOrigin(request, env.PUBLIC_SITE_URL);
    const data = await readJson(request, 32_000);
    if (!validId(data.submission) || !validToken(data.token)) {
      throw Object.assign(new Error("This revision link is incomplete or invalid."), { status: 400 });
    }
    if (data.website) return secureJson({ ok: true });
    await verifyTurnstile(request, env, data.turnstileToken);
    const values = readIntakeValues(data);
    const tokenHash = await digest(data.token);
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      update intake_submissions
      set full_name = ${values.fullName}, email = ${values.email},
          organization = ${values.organization}, role = ${values.role},
          problem = ${values.problem}, outcomes = ${values.outcomes}, users = ${values.users},
          current_workflow = ${values.currentWorkflow}, integrations = ${values.integrations || null},
          features = ${values.features}, constraints = ${values.constraints || null},
          context = ${values.context || null}, timeline = ${values.timeline},
          budget = ${values.budget || null}, decision_process = ${values.decisionProcess || null},
          updated_at = now()
      where id = ${data.submission} and revision_token_hash = ${tokenHash}
        and revision_token_expires_at > now()
        and status in ('new', 'under_review', 'needs_clarification', 'qualified')
      returning customer_number
    `;
    if (!rows.length) {
      throw Object.assign(new Error("This intake can no longer be revised with this link."), { status: 409 });
    }
    if (env.INTAKE_OWNER_EMAIL) {
      await sendOutlookMail(env, {
        to: env.INTAKE_OWNER_EMAIL,
        subject: `Project intake updated: ${rows[0].customer_number} · ${values.organization}`,
        html: `<p><strong>${escapeHtml(values.fullName)}</strong> updated project intake <strong>${escapeHtml(rows[0].customer_number)}</strong>.</p><p>${escapeHtml(values.problem)}</p><p>Review the latest details in the private intake queue.</p>`,
      });
    }
    return secureJson({ ok: true, id: data.submission, customerNumber: rows[0].customer_number, updated: true });
  } catch (error) {
    return handleError(error);
  }
}
