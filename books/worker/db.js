import { neon } from "@neondatabase/serverless";

export const database = (env) => {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return neon(env.DATABASE_URL);
};

export const companyId = (env) =>
  env.COMPANY_ID || "00000000-0000-0000-0000-000000000001";

export const writeAudit = async (sql, env, actor, action, entityType, entityId, details = {}) => {
  await sql`
    insert into accounting_audit_events
      (company_id, actor_email, action, entity_type, entity_id, details)
    values
      (${companyId(env)}, ${actor}, ${action}, ${entityType}, ${entityId || null}, ${JSON.stringify(details)}::jsonb)
  `;
};

export const nextDocumentNumber = async (sql, env, sequenceName) => {
  const allowed = new Set(["invoice", "bill", "journal"]);
  if (!allowed.has(sequenceName)) throw new Error("Unsupported document sequence.");
  const rows = await sql`
    update accounting_document_sequences
    set next_value = next_value + 1, updated_at = now()
    where company_id = ${companyId(env)} and sequence_name = ${sequenceName}
    returning prefix, next_value - 1 as value
  `;
  if (!rows.length) throw new Error(`Missing ${sequenceName} document sequence.`);
  return `${rows[0].prefix}${String(rows[0].value).padStart(6, "0")}`;
};
