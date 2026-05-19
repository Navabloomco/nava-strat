import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  canEditFinance,
  canViewFinance,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";

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
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
    };

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

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
  };
}

function billingUnitFromRateType(rateType: string) {
  return rateType.startsWith("per_") ? rateType.replace("per_", "") : rateType;
}

function calculateRevenue(fields: {
  rateType: string;
  rateAmount: number;
  rateCurrency: string;
  fxRate: number;
  loadedQuantity?: number | null;
  offloadedQuantity?: number | null;
}) {
  const billingQuantity =
    fields.rateType === "per_truck" ? 1 : Number(fields.offloadedQuantity || 0);
  const revenueOriginal = Number(fields.rateAmount || 0) * billingQuantity;
  const revenueKes =
    fields.rateCurrency === "KES" ? revenueOriginal : revenueOriginal * Number(fields.fxRate || 1);

  return {
    billing_quantity: billingQuantity,
    billing_unit: billingUnitFromRateType(fields.rateType),
    revenue_original: revenueOriginal,
    revenue_kes: revenueKes,
    revenue_status: revenueOriginal > 0 ? "calculated" : "pending",
  };
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

    const { data: journeys, error } = await supabaseAdmin
      .from("journeys")
      .select("*")
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      journeys: journeys || [],
    });
  } catch (err: any) {
    console.error("Revenue GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load revenue data" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
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

    const journeyIds = Array.isArray(body.journeyIds)
      ? body.journeyIds.filter(Boolean)
      : body.journeyId
        ? [body.journeyId]
        : [];

    if (journeyIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one journey is required" },
        { status: 400 }
      );
    }

    const rateType = body.rate_type || "per_tonne";
    const rateAmount = Number(body.rate_amount || 0);
    const rateCurrency = body.rate_currency || "KES";
    const fxRate = rateCurrency === "KES" ? 1 : Number(body.fx_rate || 1);

    if (!rateAmount) {
      return NextResponse.json(
        { success: false, error: "Rate amount is required" },
        { status: 400 }
      );
    }

    const { data: journeys, error: fetchError } = await supabaseAdmin
      .from("journeys")
      .select("id, loaded_quantity, offloaded_quantity")
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .in("id", journeyIds);

    if (fetchError) throw fetchError;

    if (!journeys || journeys.length !== journeyIds.length) {
      return NextResponse.json(
        { success: false, error: "One or more journeys were not found" },
        { status: 404 }
      );
    }

    const updatedJourneys = [];

    for (const journey of journeys) {
      const loadedQuantity =
        body.loaded_quantity === undefined
          ? journey.loaded_quantity
          : Number(body.loaded_quantity || 0);
      const offloadedQuantity =
        body.offloaded_quantity === undefined
          ? journey.offloaded_quantity
          : Number(body.offloaded_quantity || 0);
      const revenue = calculateRevenue({
        rateType,
        rateAmount,
        rateCurrency,
        fxRate,
        loadedQuantity,
        offloadedQuantity,
      });

      const updatePayload: Record<string, any> = {
        rate_type: rateType,
        rate_amount: rateAmount,
        rate_currency: rateCurrency,
        fx_rate: fxRate,
        loaded_quantity: loadedQuantity,
        offloaded_quantity: offloadedQuantity,
        ...revenue,
      };

      if (typeof body.revenue_notes === "string") {
        updatePayload.revenue_notes = body.revenue_notes;
      }

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("journeys")
        .update(updatePayload)
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .eq("id", journey.id)
        .select("*")
        .single();

      if (updateError) throw updateError;
      updatedJourneys.push(updated);
    }

    return NextResponse.json({
      success: true,
      company: resolved.company,
      journeys: updatedJourneys,
    });
  } catch (err: any) {
    console.error("Revenue PATCH error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to update revenue" },
      { status: 500 }
    );
  }
}
