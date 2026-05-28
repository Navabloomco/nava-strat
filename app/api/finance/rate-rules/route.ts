import { NextResponse } from "next/server";
import {
  canEditFinance,
  canViewFinance,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import {
  isRevenueRuleSchemaMissing,
  normalizeClientRateRuleInput,
  validateClientRateRuleInput,
} from "../../../../lib/finance/revenueRules";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const RATE_RULE_FIELDS =
  "id, company_id, client_name, route_from, route_to, unit_type, billing_quantity_source, rate_amount, currency, fx_policy, fx_rate_to_kes, effective_from, effective_to, status, notes, created_by, created_at, updated_at";

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

function rateRulesSetupRequiredResponse() {
  return NextResponse.json(
    {
      success: false,
      setup_required: true,
      error:
        "Client rate rules are not available yet. Apply the client_rate_rules migration first.",
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

    let query = supabaseAdmin
      .from("client_rate_rules")
      .select(RATE_RULE_FIELDS)
      .eq("company_id", resolved.company.id)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false });

    const status = searchParams.get("status");
    if (status) query = query.eq("status", status.trim().toLowerCase());

    const clientName = searchParams.get("clientName");
    if (clientName?.trim()) query = query.ilike("client_name", `%${clientName.trim()}%`);

    const { data, error } = await query.limit(500);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      capabilities: {
        can_view_finance: true,
        can_edit_finance: canEditFinance(resolved.roles),
      },
      rate_rules: data || [],
    });
  } catch (err: any) {
    console.error("Rate rules GET error:", err);
    if (isRevenueRuleSchemaMissing(err)) return rateRulesSetupRequiredResponse();
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load rate rules" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;
    if (!canEditFinance(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Finance edit access required" },
        { status: 403 }
      );
    }

    const normalized = normalizeClientRateRuleInput(body);
    const errors = validateClientRateRuleInput(normalized);
    if (errors.length) {
      return NextResponse.json(
        { success: false, error: errors.join(" "), validation_errors: errors },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("client_rate_rules")
      .insert({
        company_id: resolved.company.id,
        ...normalized,
        created_by: resolved.userId,
      })
      .select(RATE_RULE_FIELDS)
      .single();

    if (error) throw error;

    return NextResponse.json(
      {
        success: true,
        company: resolved.company,
        rate_rule: data,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Rate rules POST error:", err);
    if (isRevenueRuleSchemaMissing(err)) return rateRulesSetupRequiredResponse();
    return NextResponse.json(
      { success: false, error: err.message || "Failed to create rate rule" },
      { status: 500 }
    );
  }
}
