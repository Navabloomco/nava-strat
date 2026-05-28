import { NextResponse } from "next/server";
import {
  canEditFinance,
  canEditExpenses,
  canEditFuel,
  canEditJourneys,
  canEditTripExpenses,
  canViewExpenses,
  canViewFinance,
  canViewFuel,
  canViewJourneys,
  canViewTripExpenses,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import { normalizeVehicleKey } from "../../../../lib/intelligence/entityResolver";
import {
  isFuelAllocationSchemaMissing,
  summarizeFuelIssue,
} from "../../../../lib/intelligence/fuelAllocation";
import {
  buildTripIntelligenceSummary,
  resolveTripIntelligenceTimeframe,
} from "../../../../lib/intelligence/tripIntelligence";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { parseProviderTimestamp } from "../../../../lib/timeFormatting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPERATIONAL_JOURNEY_FIELDS =
  "id, company_id, internal_trip_id, asset_id, driver_id, client_name, truck, driver, from_location, to_location, route, expected_fuel_liters, status, start_time, end_time, created_at";
const FINANCE_JOURNEY_FIELDS = `${OPERATIONAL_JOURNEY_FIELDS}, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status, revenue_notes`;
const SAFE_DRIVER_FIELDS =
  "id, full_name, phone, employee_code, status, created_at";
const SAFE_EXPENSE_FIELDS =
  "id, journey_id, truck, expense_type, amount, vendor, payment_method, reference_number, trip_reference, notes, created_at";
const SAFE_FUEL_LOG_FIELDS =
  "id, truck_text, liters, price_per_liter, total_cost, vendor, notes, journey_id, allocation_status, fuel_source, created_at";
const SAFE_ALLOCATION_FIELDS =
  "id, company_id, fuel_log_id, journey_id, asset_id, truck_text, allocated_liters, allocated_cost, allocation_status, allocation_basis, notes, created_by, created_at";

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

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
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
        error: noStoreJson(
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
      error: noStoreJson(
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
      error: noStoreJson(
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

function normalizeOptionalText(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : null;
}

function normalizeDriverText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text.toUpperCase();
  }
  return null;
}

function normalizeUuid(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text || null;
}

function normalizeNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimestamp(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  if (!text) return null;
  const date = parseProviderTimestamp(text);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function loadJourney(
  companyId: string,
  journeyId: string,
  includeFinance: boolean
): Promise<any | null> {
  const { data, error } = await supabaseAdmin
    .from("journeys")
    .select(includeFinance ? FINANCE_JOURNEY_FIELDS : OPERATIONAL_JOURNEY_FIELDS)
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .eq("id", journeyId)
    .maybeSingle();

  if (error) throw error;
  return (data as any) || null;
}

async function loadDrivers(companyId: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("drivers")
    .select(SAFE_DRIVER_FIELDS)
    .eq("company_id", companyId)
    .order("full_name", { ascending: true });

  if (error) throw error;
  return (data as any[]) || [];
}

async function loadExpenses(companyId: string, journeyId: string): Promise<any[]> {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select(SAFE_EXPENSE_FIELDS)
    .eq("company_id", companyId)
    .eq("journey_id", journeyId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as any[]) || [];
}

async function loadFuelBundle(companyId: string, journey: any) {
  try {
    const truckKey = normalizeVehicleKey(journey.truck || "");
    const [allocationResult, fuelResult] = await Promise.all([
      supabaseAdmin
        .from("fuel_allocations")
        .select(SAFE_ALLOCATION_FIELDS)
        .eq("company_id", companyId)
        .eq("journey_id", journey.id)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("fuel_logs")
        .select(SAFE_FUEL_LOG_FIELDS)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (allocationResult.error) throw allocationResult.error;
    if (fuelResult.error) throw fuelResult.error;

    const tripAllocations = allocationResult.data || [];
    const allFuelLogs = fuelResult.data || [];
    const fuelLogIds = new Set(
      [
        ...tripAllocations.map((allocation: any) => allocation.fuel_log_id),
        ...allFuelLogs
          .filter((fuel: any) => fuel.journey_id === journey.id)
          .map((fuel: any) => fuel.id),
        ...allFuelLogs
          .filter((fuel: any) => normalizeVehicleKey(fuel.truck_text || "") === truckKey)
          .slice(0, 25)
          .map((fuel: any) => fuel.id),
      ].filter(Boolean)
    );
    const relevantFuelLogs = allFuelLogs.filter((fuel: any) => fuelLogIds.has(fuel.id));

    const allAllocationsForIssues =
      relevantFuelLogs.length > 0
        ? await loadAllocationsForFuelLogs(companyId, relevantFuelLogs.map((fuel: any) => fuel.id))
        : [];
    const allocationsByFuelLog = groupBy(allAllocationsForIssues, "fuel_log_id");
    const issueSummaries: Record<string, any> = {};
    for (const fuelLog of relevantFuelLogs) {
      issueSummaries[fuelLog.id] = summarizeFuelIssue(
        fuelLog,
        allocationsByFuelLog.get(fuelLog.id) || []
      );
    }

    return {
      setup_required: false,
      trip_allocations: tripAllocations,
      legacy_fuel_logs: allFuelLogs.filter((fuel: any) => fuel.journey_id === journey.id),
      available_fuel_logs: relevantFuelLogs,
      fuel_issue_summaries: issueSummaries,
      note:
        "Fuel allocations are allocation evidence only. They do not prove actual burn, fuel theft, or tank balance.",
    };
  } catch (err: any) {
    if (isFuelAllocationSchemaMissing(err)) {
      return {
        setup_required: true,
        trip_allocations: [],
        legacy_fuel_logs: [],
        available_fuel_logs: [],
        fuel_issue_summaries: {},
        note: "Fuel allocation table is not available yet. Apply the migration before allocation workflows.",
      };
    }
    throw err;
  }
}

async function loadAllocationsForFuelLogs(companyId: string, fuelLogIds: string[]) {
  const { data, error } = await supabaseAdmin
    .from("fuel_allocations")
    .select(SAFE_ALLOCATION_FIELDS)
    .eq("company_id", companyId)
    .in("fuel_log_id", fuelLogIds)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

function groupBy(rows: any[], field: string) {
  const map = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row[field] || "");
    if (!key) continue;
    const current = map.get(key) || [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

function resolveDetailRange(journey: any, company: any): "today" | "yesterday" | "7d" {
  const value = journey.start_time || journey.created_at;
  const timestamp = parseProviderTimestamp(value);
  const ms = timestamp?.getTime();
  if (!ms || !Number.isFinite(ms)) return "7d";

  const today = resolveTripIntelligenceTimeframe({ range: "today", company });
  const yesterday = resolveTripIntelligenceTimeframe({ range: "yesterday", company });
  if (ms >= Date.parse(today.start_utc) && ms < Date.parse(today.end_utc)) return "today";
  if (ms >= Date.parse(yesterday.start_utc) && ms < Date.parse(yesterday.end_utc)) {
    return "yesterday";
  }
  return "7d";
}

async function loadTripIntelligence(companyId: string, company: any, journey: any, roles: string[]) {
  const range = resolveDetailRange(journey, company);
  const summary = await buildTripIntelligenceSummary({
    companyId,
    company,
    range,
    roles,
    includeFinance: canViewFinance(roles),
  });
  const trip =
    (summary.trips || []).find(
      (candidate: any) => candidate.trip_identity?.journey_id === journey.id
    ) || null;

  return {
    range,
    trip,
    summary: summary.summary,
    missing_data_summary: summary.missing_data_summary,
    role_visibility: summary.role_visibility,
    empty_state: summary.empty_state,
  };
}

function buildCapabilities(roles: string[]) {
  return {
    can_view_journey: canViewJourneys(roles),
    can_edit_journey: canEditJourneys(roles),
    can_view_finance: canViewFinance(roles),
    can_edit_finance: canEditFinance(roles),
    can_view_fuel: canViewFuel(roles),
    can_edit_fuel: canEditFuel(roles),
    can_view_expenses: canViewExpenses(roles),
    can_edit_expenses: canEditExpenses(roles),
    can_view_trip_expenses: canViewTripExpenses(roles),
    can_edit_trip_expenses: canEditTripExpenses(roles),
  };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    if (!canViewJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Journey access required" },
        { status: 403 }
      );
    }

    const journey = await loadJourney(
      resolved.company.id,
      params.id,
      canViewFinance(resolved.roles)
    );
    if (!journey) {
      return noStoreJson({ success: false, error: "Trip not found" }, { status: 404 });
    }

    const [drivers, expenses, fuel, intelligence] = await Promise.all([
      canEditJourneys(resolved.roles) ? loadDrivers(resolved.company.id) : Promise.resolve([]),
      canViewTripExpenses(resolved.roles)
        ? loadExpenses(resolved.company.id, journey.id)
        : Promise.resolve([]),
      canViewFuel(resolved.roles)
        ? loadFuelBundle(resolved.company.id, journey)
        : Promise.resolve(null),
      loadTripIntelligence(resolved.company.id, resolved.company, journey, resolved.roles),
    ]);

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      capabilities: buildCapabilities(resolved.roles),
      journey,
      drivers,
      expenses,
      fuel,
      trip_intelligence: intelligence,
      guardrails: {
        no_raw_coordinates: true,
        no_fuel_burn_or_theft_claims: true,
        profit_requires_linked_revenue_and_costs: true,
      },
    });
  } catch (err: any) {
    console.error("Journey detail GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load trip detail" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    if (!canEditJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Journey edit access required" },
        { status: 403 }
      );
    }

    const existing = await loadJourney(resolved.company.id, params.id, true);
    if (!existing) {
      return noStoreJson({ success: false, error: "Trip not found" }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    for (const field of ["client_name", "truck", "driver", "from_location", "to_location", "route"]) {
      if (body[field] !== undefined) {
        updates[field] = normalizeOptionalText(body[field]);
      }
    }
    if (body.manual_driver_text !== undefined) {
      const manualDriverText = normalizeDriverText(body.manual_driver_text);
      if (body.driver === undefined || !updates.driver) {
        updates.driver = manualDriverText;
      }
    }
    if (body.status !== undefined) {
      updates.status = String(body.status || "active").trim().toLowerCase() || "active";
    }
    if (body.expected_fuel_liters !== undefined) {
      updates.expected_fuel_liters = normalizeNumber(body.expected_fuel_liters) ?? null;
    }
    if (body.start_time !== undefined) updates.start_time = normalizeTimestamp(body.start_time);
    if (body.end_time !== undefined) updates.end_time = normalizeTimestamp(body.end_time);

    const driverId = normalizeUuid(body.driver_id);
    if (driverId !== undefined) {
      updates.driver_id = driverId;
      if (driverId) {
        const { data: driver, error: driverError } = await supabaseAdmin
          .from("drivers")
          .select("id, full_name, status")
          .eq("company_id", resolved.company.id)
          .eq("id", driverId)
          .maybeSingle();

        if (driverError) throw driverError;
        if (!driver) {
          return noStoreJson(
            { success: false, error: "Selected driver was not found for this company" },
            { status: 400 }
          );
        }
        if (body.driver === undefined) {
          updates.driver = String(driver.full_name || "").trim().toUpperCase() || null;
        }
      }
    }

    const nextFrom = updates.from_location ?? existing.from_location;
    const nextTo = updates.to_location ?? existing.to_location;
    if (body.route === undefined && (body.from_location !== undefined || body.to_location !== undefined)) {
      updates.route =
        nextFrom || nextTo
          ? `${String(nextFrom || "").trim().toUpperCase()} → ${String(nextTo || "")
              .trim()
              .toUpperCase()}`
          : null;
    }

    if (Object.keys(updates).length === 0) {
      return noStoreJson(
        { success: false, error: "No valid trip updates provided" },
        { status: 400 }
      );
    }

    const { data: journey, error: updateError } = await supabaseAdmin
      .from("journeys")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .eq("id", params.id)
      .select(canViewFinance(resolved.roles) ? FINANCE_JOURNEY_FIELDS : OPERATIONAL_JOURNEY_FIELDS)
      .single();

    if (updateError) throw updateError;

    return noStoreJson({
      success: true,
      company: resolved.company,
      journey,
    });
  } catch (err: any) {
    console.error("Journey detail PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update trip" },
      { status: 500 }
    );
  }
}
