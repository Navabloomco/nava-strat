import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  canEditFinance,
  canViewFinance,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import {
  evaluateRevenueRuleMatch,
  isRevenueRuleSchemaMissing,
  toRevenueNumber,
} from "../../../../lib/finance/revenueRules";

export const dynamic = "force-dynamic";

const REVENUE_JOURNEY_FIELDS =
  "id, internal_trip_id, client_name, truck, driver, from_location, to_location, status, start_time, end_time, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status, revenue_notes, created_at";
const REVENUE_ENTRY_FIELDS =
  "id, company_id, journey_id, rate_rule_id, revenue_source, billing_quantity, billing_unit, rate_amount, currency, fx_rate_to_kes, revenue_original, revenue_kes, override_reason, applied_by, applied_at, notes";
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

function billingUnitFromRateType(rateType: string) {
  return rateType.startsWith("per_") ? rateType.replace("per_", "") : rateType;
}

function rateTypeFromBillingUnit(unit: string | null | undefined) {
  const normalized = String(unit || "tonne").trim().toLowerCase();
  return normalized === "custom" ? "custom" : `per_${normalized}`;
}

function calculateRevenue(fields: {
  rateType: string;
  rateAmount: number;
  rateCurrency: string;
  fxRate: number;
  loadedQuantity?: number | null;
  offloadedQuantity?: number | null;
  billingQuantity?: number | null;
}) {
  const billingQuantity =
    fields.rateType === "per_truck" || fields.rateType === "per_trip"
      ? 1
      : Number(fields.billingQuantity || fields.offloadedQuantity || 0);
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
      .select(REVENUE_JOURNEY_FIELDS)
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const journeyRows = journeys || [];
    const journeyIds = journeyRows.map((journey) => journey.id).filter(Boolean);
    const latestEntriesByJourney = new Map<string, any>();
    const warnings: string[] = [];

    if (journeyIds.length) {
      const { data: revenueEntries, error: entryError } = await supabaseAdmin
        .from("journey_revenue_entries")
        .select(REVENUE_ENTRY_FIELDS)
        .eq("company_id", resolved.company.id)
        .in("journey_id", journeyIds)
        .order("applied_at", { ascending: false })
        .limit(5000);

      if (entryError) {
        if (isRevenueRuleSchemaMissing(entryError)) {
          warnings.push(
            "Auditable revenue entries are not available until the journey_revenue_entries migration is applied."
          );
        } else {
          throw entryError;
        }
      } else {
        for (const entry of revenueEntries || []) {
          if (entry.journey_id && !latestEntriesByJourney.has(entry.journey_id)) {
            latestEntriesByJourney.set(entry.journey_id, entry);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      capabilities: {
        can_view_finance: true,
        can_edit_finance: canEditFinance(resolved.roles),
      },
      warnings,
      journeys: journeyRows.map((journey) => ({
        ...journey,
        latest_revenue_entry: latestEntriesByJourney.get(journey.id) || null,
      })),
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

    if (body.action === "apply_configured_rate" || body.apply_configured_rate) {
      if (journeyIds.length !== 1) {
        return NextResponse.json(
          { success: false, error: "Apply configured rate to one Trip at a time." },
          { status: 400 }
        );
      }

      const { data: journey, error: journeyError } = await supabaseAdmin
        .from("journeys")
        .select(
          "id, company_id, internal_trip_id, client_name, from_location, to_location, start_time, end_time, created_at, loaded_quantity, offloaded_quantity, billing_quantity"
        )
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .eq("id", journeyIds[0])
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
        manualQuantity: toRevenueNumber(body.manual_quantity),
        fxRateToKes: toRevenueNumber(body.fx_rate_to_kes ?? body.fx_rate),
        date: body.date || null,
      });

      if (match.status !== "unique_match" || !match.calculation || match.matches.length !== 1) {
        return NextResponse.json(
          {
            success: false,
            error: `Configured rate cannot be applied yet: ${match.status}`,
            match_status: match.status,
            missing: match.missing,
          },
          { status: 400 }
        );
      }

      const rateRule = match.matches[0];
      const calculation = match.calculation;
      const updatePayload: Record<string, any> = {
        rate_type: rateTypeFromBillingUnit(calculation.billing_unit),
        rate_amount: calculation.rate_amount,
        rate_currency: calculation.currency,
        fx_rate: calculation.fx_rate_to_kes,
        billing_quantity: calculation.billing_quantity,
        billing_unit: calculation.billing_unit,
        revenue_original: calculation.revenue_original,
        revenue_kes: calculation.revenue_kes,
        revenue_status: "configured_rate",
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
        .select(REVENUE_JOURNEY_FIELDS)
        .single();

      if (updateError) throw updateError;

      const warnings: string[] = [];
      const { data: entry, error: entryError } = await supabaseAdmin
        .from("journey_revenue_entries")
        .insert({
          company_id: resolved.company.id,
          journey_id: journey.id,
          rate_rule_id: rateRule.id || null,
          revenue_source: "configured_rate",
          billing_quantity: calculation.billing_quantity,
          billing_unit: calculation.billing_unit,
          rate_amount: calculation.rate_amount,
          currency: calculation.currency,
          fx_rate_to_kes: calculation.fx_rate_to_kes,
          revenue_original: calculation.revenue_original,
          revenue_kes: calculation.revenue_kes,
          applied_by: resolved.userId,
          notes:
            typeof body.revenue_notes === "string" && body.revenue_notes.trim()
              ? body.revenue_notes.trim()
              : null,
        })
        .select(REVENUE_ENTRY_FIELDS)
        .single();

      if (entryError) {
        if (isRevenueRuleSchemaMissing(entryError)) {
          warnings.push(
            "Revenue was saved on the Trip snapshot, but auditable revenue entries are not available until the journey_revenue_entries migration is applied."
          );
        } else {
          throw entryError;
        }
      }

      return NextResponse.json({
        success: true,
        company: resolved.company,
        journey: {
          ...updated,
          latest_revenue_entry: entry || null,
        },
        match_status: match.status,
        applied_rate_rule: rateRule,
        calculation,
        warnings,
      });
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
      .select("id, loaded_quantity, offloaded_quantity, billing_quantity")
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
    const revenueEntryWarnings = [];

    for (const journey of journeys) {
      const loadedQuantity =
        body.loaded_quantity === undefined
          ? journey.loaded_quantity
          : Number(body.loaded_quantity || 0);
      const offloadedQuantity =
        body.offloaded_quantity === undefined
          ? journey.offloaded_quantity
          : Number(body.offloaded_quantity || 0);
      const billingQuantity =
        body.billing_quantity === undefined
          ? journey.billing_quantity
          : Number(body.billing_quantity || 0);
      const revenue = calculateRevenue({
        rateType,
        rateAmount,
        rateCurrency,
        fxRate,
        loadedQuantity,
        offloadedQuantity,
        billingQuantity,
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
        .select(REVENUE_JOURNEY_FIELDS)
        .single();

      if (updateError) throw updateError;
      updatedJourneys.push(updated);

      const revenueSource = body.override_reason ? "overridden" : "manual_finance_entry";
      const { error: entryError } = await supabaseAdmin
        .from("journey_revenue_entries")
        .insert({
          company_id: resolved.company.id,
          journey_id: journey.id,
          rate_rule_id: null,
          revenue_source: revenueSource,
          billing_quantity: revenue.billing_quantity,
          billing_unit: revenue.billing_unit,
          rate_amount: rateAmount,
          currency: rateCurrency,
          fx_rate_to_kes: fxRate,
          revenue_original: revenue.revenue_original,
          revenue_kes: revenue.revenue_kes,
          override_reason:
            typeof body.override_reason === "string" && body.override_reason.trim()
              ? body.override_reason.trim()
              : null,
          applied_by: resolved.userId,
          notes:
            typeof body.revenue_notes === "string" && body.revenue_notes.trim()
              ? body.revenue_notes.trim()
              : null,
        });

      if (entryError) {
        if (isRevenueRuleSchemaMissing(entryError)) {
          revenueEntryWarnings.push(
            "Revenue was saved on the Trip snapshot, but auditable revenue entries are not available until the journey_revenue_entries migration is applied."
          );
        } else {
          throw entryError;
        }
      }
    }

    return NextResponse.json({
      success: true,
      company: resolved.company,
      journeys: updatedJourneys,
      warnings: Array.from(new Set(revenueEntryWarnings)),
    });
  } catch (err: any) {
    console.error("Revenue PATCH error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to update revenue" },
      { status: 500 }
    );
  }
}
