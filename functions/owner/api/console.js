import { neon } from "@neondatabase/serverless";
import { handleError, requireOwner, secureJson } from "../../_lib/security.js";
import { getPortfolioMonitoring } from "../../_lib/platform-monitoring.js";

const database = (env) => env.__TEST_SQL || neon(env.DATABASE_URL);
const number = (value) => Number(value || 0);

export async function onRequestGet({ request, env }) {
  try {
    const ownerEmail = await requireOwner(request, env);
    const period = new URL(request.url).searchParams.get("period") || "7d";
    const sql = database(env);
    const [leadRows, intakeRows, sowRows, paymentRows, activityRows, portfolio] = await Promise.all([
      sql`
        select
          count(*) filter (where archived = false and stage not in ('lost','not_a_fit','archived')) as active_leads,
          count(*) filter (where archived = false and do_not_contact = false and next_action is not null and next_action <> '' and next_action_completed = false) as needs_action,
          count(*) filter (where archived = false and do_not_contact = false and next_action is not null and next_action <> '' and next_action_completed = false and next_action_due < current_date) as overdue_actions,
          count(*) filter (where archived = false and stage = 'new') as new_leads,
          count(*) filter (where archived = false and tidal_conflict_review_required = true and tidal_conflict_review_status = 'pending') as conflict_reviews
        from leads
      `,
      sql`
        select
          count(*) as total_intakes,
          count(*) filter (where status in ('new','under_review','needs_clarification','qualified')) as new_intakes
        from intake_submissions
      `,
      sql`
        select
          count(*) filter (where status in ('sent','changes_requested')) as sow_decisions,
          count(*) filter (where status = 'approved') as approved_sows
        from sow_versions
        where status <> 'superseded'
      `,
      sql`
        select
          count(*) filter (where status = 'approved' and (payment_status in ('unpaid','failed') or billing_status = 'past_due')) as payment_attention,
          count(*) filter (where billing_status = 'active') as active_care,
          count(*) filter (where payment_status = 'paid') as paid_projects
        from sow_versions
        where status <> 'superseded'
      `,
      sql`
        select a.activity_type, a.note, a.created_at, l.id as lead_id, l.business_name
        from lead_activities a
        join leads l on l.id = a.lead_id
        order by a.created_at desc
        limit 8
      `,
      getPortfolioMonitoring(env, period, env.__TEST_FETCH || fetch),
    ]);

    const leads = leadRows[0] || {};
    const intakes = intakeRows[0] || {};
    const sows = sowRows[0] || {};
    const payments = paymentRows[0] || {};
    return secureJson({
      ownerEmail,
      generatedAt: new Date().toISOString(),
      portfolio,
      summary: {
        activeLeads: number(leads.active_leads),
        needsAction: number(leads.needs_action),
        overdueActions: number(leads.overdue_actions),
        newLeads: number(leads.new_leads),
        conflictReviews: number(leads.conflict_reviews),
        totalIntakes: number(intakes.total_intakes),
        newIntakes: number(intakes.new_intakes),
        sowDecisions: number(sows.sow_decisions),
        approvedSows: number(sows.approved_sows),
        paymentAttention: number(payments.payment_attention),
        activeCare: number(payments.active_care),
        paidProjects: number(payments.paid_projects),
      },
      configuration: {
        ownerAccess: Boolean(env.POLICY_AUD && env.TEAM_DOMAIN && env.OWNER_EMAIL) || env.ENVIRONMENT === "development",
        database: true,
        leadDiscovery: Boolean(env.BRAVE_SEARCH_API_KEY),
        payments: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
        emailNotifications: Boolean(env.OUTLOOK_ACCESS_TOKEN && env.INTAKE_OWNER_EMAIL),
        spamProtection: Boolean(env.TURNSTILE_SECRET_KEY),
        posthog: Boolean(env.POSTHOG_PERSONAL_API_KEY),
        sentry: Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG_SLUG),
      },
      recentActivity: activityRows.map((row) => ({
        activityType: row.activity_type,
        note: row.note,
        createdAt: row.created_at,
        leadId: row.lead_id,
        businessName: row.business_name,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
