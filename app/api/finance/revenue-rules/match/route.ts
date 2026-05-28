import { NextResponse } from "next/server";
import {
  canEditFinance,
  canViewFinance,
  normalizeRole,
  rolesForCompany,
} from "../../../../../lib/api/roleAccess";
import {
  evaluateRevenueRuleMatch,
  isRevenueRuleSchemaMissing,
  toRevenueNumber,
} from "../../../../../lib/finance/revenueRules";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const JOURNEY_MATCH_FIELDS =
  "id, company_id, internal_trip_id, client_name, from_location, to_location, start_time, end_time, created_at, loaded_quantity, offloaded_quantity, billing_quantity";
const RATE_RULE_FIELDS =
  "id, company_id, client_name, route_from, route_to, unit_type, billing_quantity_source, rate_amount, currency, fx_policy, fx_rate_to_kes, effective_from, effective_to, status, notes, created_at, updated_at";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      userId: string;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
      userId?: never;
    };

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = normalizedRequestedCompanyId
      ? await companyQuery.eq("id", normalizedRequestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: NextResponse.json(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return {
      company: company as ResolvedCompany,
      isPlatformOwner,
      roles: rolesForCompany(activeMemberships, company.id, true),
      userId: user.id,
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    company: company as ResolvedCompany,
    isPlatformOwner,
    roles: rolesForCompany(activeMemberships, company.id),
    userId: user.id,
  };
}

function revenueRulesSetupRequiredResponse() {
  return NextResponse.json(
    {
      success: false,
      setup_required: true,
      error:
        "Revenue rules are not available yet. Apply the client_rate_rules and journey_revenue_entries migrations first.",
    },
    { status: 424 }
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewFinance(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Finance access required" },
        { status: 403 }
      );
    }

    const journeyId = searchParams.get("journeyId")?.trim();
    if (!journeyId) {
      return NextResponse.json(
        { success: false, error: "journeyId is required" },
        { status: 400 }
      );
    }

    const { data: journey, error: journeyError } = await supabaseAdmin
      .from("journeys")
      .select(JOURNEY_MATCH_FIELDS)
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .eq("id", journeyId)
      .maybeSingle();

    if (journeyError) throw journeyError;
    if (!journey) {
      return NextResponse.json(
        { success: false, error: "Trip not found" },
        { status: 404 }
      );
    }

    const { data: rules, error: rulesError } = await supabaseAdmin
      .from("client_rate_rules")
      .select(RATE_RULE_FIELDS)
      .eq("company_id", resolved.company.id)
      .eq("status", "active")
      .limit(500);

    if (rulesError) throw rulesError;

    const match = evaluateRevenueRuleMatch({
      journey,
      rules: rules || [],
      manualQuantity: toRevenueNumber(searchParams.get("manualQuantity")),
      fxRateToKes: toRevenueNumber(searchParams.get("fxRateToKes")),
      date: searchParams.get("date"),
    });

    return NextResponse.json({
      success: true,
      company: resolved.company,
      capabilities: {
        can_view_finance: true,
        can_edit_finance: canEditFinance(resolved.roles),
      },
      journey,
      match_status: match.status,
      missing: match.missing,
      matching_rate_rules: match.matches,
      calculation: match.calculation,
      guardrails: {
        finance_only: true,
        external_fx_used: false,
        journey_revenue_snapshot_not_updated: true,
      },
    });
  } catch (err: any) {
    console.error("Revenue rule match GET error:", err);
    if (isRevenueRuleSchemaMissing(err)) return revenueRulesSetupRequiredResponse();
    return NextResponse.json(
      { success: false, error: err.message || "Failed to match revenue rule" },
      { status: 500 }
    );
  }
}
