import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import {
  canEditFuel,
  canViewFinance,
  canViewFuel,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";

const OPERATIONAL_JOURNEY_FIELDS =
  "id, internal_trip_id, client_name, truck, driver, from_location, to_location, expected_fuel_liters, status, created_at, updated_at";
const FINANCE_JOURNEY_FIELDS = `${OPERATIONAL_JOURNEY_FIELDS}, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status`;
const SAFE_FUEL_LOG_FIELDS =
  "id, truck_text, liters, price_per_liter, total_cost, vendor, notes, journey_id, allocation_status, fuel_source, approved_extra_fuel, approval_reason, request_status, approval_required, created_at";
const SAFE_FUEL_PROVIDER_FIELDS =
  "id, name, current_price_per_liter, is_active, created_at";

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

async function updateFuelProfile(
  companyId: string,
  truckValue: string,
  journeyIdValue: string
) {
  const cleanTruck = truckValue.trim().toUpperCase();

  const { data: journey, error: journeyError } = await supabaseAdmin
    .from("journeys")
    .select("id, client_name, from_location, to_location")
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .eq("id", journeyIdValue)
    .maybeSingle();

  if (journeyError) throw journeyError;
  if (!journey) return;

  const { data: fuelLogs, error: fuelError } = await supabaseAdmin
    .from("fuel_logs")
    .select("liters")
    .eq("company_id", companyId)
    .eq("journey_id", journeyIdValue);

  if (fuelError) throw fuelError;
  if (!fuelLogs) return;

  const totalFuel = fuelLogs.reduce(
    (sum, fuel) => sum + Number(fuel.liters || 0),
    0
  );

  const { data: existing, error: profileError } = await supabaseAdmin
    .from("truck_route_fuel_profiles")
    .select("id, avg_fuel_liters, trip_count")
    .eq("company_id", companyId)
    .eq("truck", cleanTruck)
    .eq("from_location", journey.from_location)
    .eq("to_location", journey.to_location)
    .maybeSingle();

  if (profileError) throw profileError;

  if (!existing) {
    const { error: insertError } = await supabaseAdmin
      .from("truck_route_fuel_profiles")
      .insert({
        company_id: companyId,
        truck: cleanTruck,
        client_name: journey.client_name,
        from_location: journey.from_location,
        to_location: journey.to_location,
        avg_fuel_liters: totalFuel,
        trip_count: 1,
      });

    if (insertError) throw insertError;
    return;
  }

  const newCount = Number(existing.trip_count || 0) + 1;
  const newAverage =
    (Number(existing.avg_fuel_liters || 0) * Number(existing.trip_count || 0) +
      totalFuel) /
    newCount;

  const { error: updateError } = await supabaseAdmin
    .from("truck_route_fuel_profiles")
    .update({
      avg_fuel_liters: newAverage,
      trip_count: newCount,
      last_updated: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", existing.id);

  if (updateError) throw updateError;
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

    const journeySelect = canViewFinance(resolved.roles)
      ? FINANCE_JOURNEY_FIELDS
      : OPERATIONAL_JOURNEY_FIELDS;

    const [fuelResult, journeysResult, providersResult] = await Promise.all([
      supabaseAdmin
        .from("fuel_logs")
        .select(SAFE_FUEL_LOG_FIELDS)
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("journeys")
        .select(journeySelect)
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fuel_providers")
        .select(SAFE_FUEL_PROVIDER_FIELDS)
        .eq("company_id", resolved.company.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
    ]);

    if (fuelResult.error) throw fuelResult.error;
    if (journeysResult.error) throw journeysResult.error;
    if (providersResult.error) throw providersResult.error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      fuel_logs: fuelResult.data || [],
      journeys: journeysResult.data || [],
      fuel_providers: providersResult.data || [],
    });
  } catch (err: any) {
    console.error("Fuel GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load fuel data" },
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

    const cleanTruck =
      typeof body.truck_text === "string"
        ? body.truck_text.trim().toUpperCase()
        : "";
    const litersNum = Number(body.liters || 0);
    const priceNum = body.price_per_liter ? Number(body.price_per_liter) : 0;
    const journeyId = body.journey_id || null;
    const approvedExtraFuel = Boolean(body.approved_extra_fuel);
    const approvalReason =
      typeof body.approval_reason === "string" ? body.approval_reason.trim() : "";

    if (!cleanTruck || !litersNum) {
      return NextResponse.json(
        { success: false, error: "Truck and liters are required" },
        { status: 400 }
      );
    }

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
          { success: false, error: "Journey not found" },
          { status: 404 }
        );
      }

      const { data: existingFuel, error: existingError } = await supabaseAdmin
        .from("fuel_logs")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("journey_id", journeyId);

      if (existingError) throw existingError;

      if (existingFuel && existingFuel.length > 0 && !approvedExtraFuel) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Fuel already exists for this journey. Approval is required to add more fuel.",
          },
          { status: 409 }
        );
      }

      if (approvedExtraFuel && !approvalReason) {
        return NextResponse.json(
          { success: false, error: "Approval reason is required" },
          { status: 400 }
        );
      }
    }

    const { data: fuelLog, error: insertError } = await supabaseAdmin
      .from("fuel_logs")
      .insert({
        company_id: resolved.company.id,
        truck_text: cleanTruck,
        liters: litersNum,
        price_per_liter: priceNum,
        total_cost: litersNum * priceNum,
        vendor:
          typeof body.vendor === "string"
            ? body.vendor.trim().toUpperCase()
            : body.vendor || null,
        notes: body.notes || null,
        journey_id: journeyId,
        allocation_status: journeyId ? "allocated" : "unallocated",
        fuel_source: body.fuel_source || "manual",
        approved_extra_fuel: approvedExtraFuel,
        approval_reason: approvedExtraFuel ? approvalReason : null,
        request_status: "approved",
        approval_required: approvedExtraFuel,
      })
      .select(SAFE_FUEL_LOG_FIELDS)
      .single();

    if (insertError) throw insertError;

    if (journeyId) {
      await updateFuelProfile(resolved.company.id, cleanTruck, journeyId);
    }

    return NextResponse.json({
      success: true,
      company: resolved.company,
      fuel_log: fuelLog,
    });
  } catch (err: any) {
    console.error("Fuel POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save fuel" },
      { status: 500 }
    );
  }
}
