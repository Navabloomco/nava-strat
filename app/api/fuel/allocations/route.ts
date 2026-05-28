import { NextResponse } from "next/server";
import {
  canEditFuel,
  canViewFinance,
  canViewFuel,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import {
  estimateAllocatedCost,
  isFuelAllocationSchemaMissing,
  normalizeFuelAllocationBasis,
  normalizeFuelAllocationStatus,
  summarizeFuelIssue,
  validateFuelAllocationRequest,
} from "../../../../lib/intelligence/fuelAllocation";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SAFE_FUEL_LOG_FIELDS =
  "id, company_id, truck_text, liters, price_per_liter, total_cost, vendor, journey_id, allocation_status, fuel_source, created_at";
const SAFE_ALLOCATION_FIELDS =
  "id, company_id, fuel_log_id, journey_id, asset_id, truck_text, allocated_liters, allocated_cost, allocation_status, allocation_basis, notes, created_by, created_at";

function stripFuelLogMoney(row: any) {
  if (!row) return row;
  const { price_per_liter, total_cost, ...safe } = row;
  return safe;
}

function stripAllocationMoney(row: any) {
  if (!row) return row;
  const { allocated_cost, ...safe } = row;
  return safe;
}

function stripFuelIssueSummaryMoney(summary: any) {
  if (!summary) return summary;
  const {
    issue_cost,
    allocated_cost,
    carried_forward_cost,
    reversed_cost,
    consumed_cost,
    remaining_cost,
    ...safe
  } = summary;
  return safe;
}

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

function allocationSetupRequiredResponse() {
  return NextResponse.json(
    {
      success: false,
      setup_required: true,
      error: "Fuel allocation table is not available yet. Apply the fuel_allocations migration first.",
    },
    { status: 424 }
  );
}

function cleanUuid(value: any) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericInput(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadFuelLog(companyId: string, fuelLogId: string) {
  const { data, error } = await supabaseAdmin
    .from("fuel_logs")
    .select(SAFE_FUEL_LOG_FIELDS)
    .eq("company_id", companyId)
    .eq("id", fuelLogId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function loadAllocations(companyId: string, fuelLogId: string) {
  const { data, error } = await supabaseAdmin
    .from("fuel_allocations")
    .select(SAFE_ALLOCATION_FIELDS)
    .eq("company_id", companyId)
    .eq("fuel_log_id", fuelLogId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewFuel(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Fuel access required" },
        { status: 403 }
      );
    }

    const fuelLogId = cleanUuid(searchParams.get("fuelLogId"));
    if (!fuelLogId) {
      return NextResponse.json(
        { success: false, error: "fuelLogId is required" },
        { status: 400 }
      );
    }

    const includeFinance = canViewFinance(resolved.roles);
    const fuelLog = await loadFuelLog(resolved.company.id, fuelLogId);
    if (!fuelLog) {
      return NextResponse.json(
        { success: false, error: "Fuel issue not found" },
        { status: 404 }
      );
    }

    const allocations = await loadAllocations(resolved.company.id, fuelLogId);

    return NextResponse.json({
      success: true,
      company: resolved.company,
      capabilities: {
        can_view_finance: includeFinance,
      },
      fuel_log: includeFinance ? fuelLog : stripFuelLogMoney(fuelLog),
      allocations: includeFinance ? allocations : allocations.map(stripAllocationMoney),
      summary: includeFinance
        ? summarizeFuelIssue(fuelLog, allocations)
        : stripFuelIssueSummaryMoney(summarizeFuelIssue(fuelLog, allocations)),
    });
  } catch (err: any) {
    console.error("Fuel allocations GET error:", err);
    if (isFuelAllocationSchemaMissing(err)) return allocationSetupRequiredResponse();
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load fuel allocations" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;
    if (!canEditFuel(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Fuel edit access required" },
        { status: 403 }
      );
    }

    const fuelLogId = cleanUuid(body.fuel_log_id || body.fuelLogId);
    if (!fuelLogId) {
      return NextResponse.json(
        { success: false, error: "fuel_log_id is required" },
        { status: 400 }
      );
    }

    const includeFinance = canViewFinance(resolved.roles);
    const fuelLog = await loadFuelLog(resolved.company.id, fuelLogId);
    if (!fuelLog) {
      return NextResponse.json(
        { success: false, error: "Fuel issue not found" },
        { status: 404 }
      );
    }

    const journeyId = cleanUuid(body.journey_id || body.journeyId);
    if (journeyId) {
      const { data: journey, error: journeyError } = await supabaseAdmin
        .from("journeys")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .eq("id", journeyId)
        .maybeSingle();

      if (journeyError) throw journeyError;
      if (!journey) {
        return NextResponse.json(
          { success: false, error: "Trip not found for this company" },
          { status: 404 }
        );
      }
    }

    const assetId = cleanUuid(body.asset_id || body.assetId);
    if (assetId) {
      const { data: asset, error: assetError } = await supabaseAdmin
        .from("fleet_assets")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("id", assetId)
        .maybeSingle();

      if (assetError) throw assetError;
      if (!asset) {
        return NextResponse.json(
          { success: false, error: "Asset not found for this company" },
          { status: 404 }
        );
      }
    }

    const status = normalizeFuelAllocationStatus(body.allocation_status);
    const basis = normalizeFuelAllocationBasis(body.allocation_basis);
    const allocatedLiters = numericInput(body.allocated_liters);
    if (allocatedLiters === null) {
      return NextResponse.json(
        { success: false, error: "allocated_liters is required" },
        { status: 400 }
      );
    }
    const providedCost = includeFinance ? numericInput(body.allocated_cost) : null;
    const allocatedCost = estimateAllocatedCost(fuelLog, allocatedLiters, providedCost);

    const existingAllocations = await loadAllocations(resolved.company.id, fuelLogId);
    const validation = validateFuelAllocationRequest({
      fuelIssue: fuelLog,
      existingAllocations,
      nextAllocation: {
        fuel_log_id: fuelLogId,
        journey_id: journeyId,
        asset_id: assetId,
        allocated_liters: allocatedLiters,
        allocated_cost: allocatedCost,
        allocation_status: status,
        allocation_basis: basis,
      },
    });

    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join(" ") },
        { status: 400 }
      );
    }

    const { data: allocation, error: insertError } = await supabaseAdmin
      .from("fuel_allocations")
      .insert({
        company_id: resolved.company.id,
        fuel_log_id: fuelLogId,
        journey_id: journeyId,
        asset_id: assetId,
        truck_text:
          typeof body.truck_text === "string" && body.truck_text.trim()
            ? body.truck_text.trim().toUpperCase()
            : fuelLog.truck_text || null,
        allocated_liters: allocatedLiters,
        allocated_cost: allocatedCost,
        allocation_status: status,
        allocation_basis: basis,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        created_by: resolved.userId,
      })
      .select(SAFE_ALLOCATION_FIELDS)
      .single();

    if (insertError) throw insertError;

    const updatedAllocations = [...existingAllocations, allocation];
    return NextResponse.json({
      success: true,
      company: resolved.company,
      capabilities: {
        can_view_finance: includeFinance,
      },
      allocation: includeFinance ? allocation : stripAllocationMoney(allocation),
      summary: includeFinance
        ? summarizeFuelIssue(fuelLog, updatedAllocations)
        : stripFuelIssueSummaryMoney(summarizeFuelIssue(fuelLog, updatedAllocations)),
      warnings:
        !includeFinance && body.allocated_cost
          ? [
              "Fuel allocation cost was ignored because cost fields are restricted to finance and management roles.",
            ]
          : [],
    });
  } catch (err: any) {
    console.error("Fuel allocations POST error:", err);
    if (isFuelAllocationSchemaMissing(err)) return allocationSetupRequiredResponse();
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save fuel allocation" },
      { status: 500 }
    );
  }
}
