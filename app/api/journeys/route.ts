import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { supabase } from "../../../lib/supabase";
import {
  canEditJourneys,
  canViewFinance,
  canViewJourneys,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";

const OPERATIONAL_JOURNEY_FIELDS =
  "id, internal_trip_id, client_name, truck, driver, from_location, to_location, expected_fuel_liters, status, created_at, updated_at";
const FINANCE_JOURNEY_FIELDS = `${OPERATIONAL_JOURNEY_FIELDS}, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status`;

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Unauthorized" };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: "Unauthorized" };
  }

  return { user, error: null };
}

async function resolveCompany(userId: string, requestedCompanyId?: string | null) {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    let companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    if (normalizedRequestedCompanyId) {
      companyQuery = companyQuery.eq("id", normalizedRequestedCompanyId);
    } else {
      companyQuery = companyQuery.order("name", { ascending: true }).limit(1);
    }

    const { data: company, error: companyError } =
      await companyQuery.maybeSingle();

    if (companyError) throw companyError;
    return {
      company,
      isPlatformOwner,
      roles: company ? rolesForCompany(activeMemberships, company.id, true) : [],
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
    return { company: null, isPlatformOwner, roles: [] };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  return {
    company,
    isPlatformOwner,
    roles: company ? rolesForCompany(activeMemberships, company.id) : [],
  };
}

export async function GET(req: Request) {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedCompanyId = searchParams.get("companyId");
    const resolved = await resolveCompany(user.id, requestedCompanyId);
    const { company } = resolved;

    if (!company) {
      return NextResponse.json(
        { success: false, error: "Company not found or access denied" },
        { status: 403 }
      );
    }
    if (!canViewJourneys(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Journey access required" },
        { status: 403 }
      );
    }

    const journeySelect = canViewFinance(resolved.roles)
      ? FINANCE_JOURNEY_FIELDS
      : OPERATIONAL_JOURNEY_FIELDS;

    const { data: journeys, error: journeysError } = await supabaseAdmin
      .from("journeys")
      .select(journeySelect)
      .eq("company_id", company.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (journeysError) throw journeysError;

    return NextResponse.json({
      success: true,
      company,
      journeys: journeys || [],
    });
  } catch (err: any) {
    console.error("Journeys GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load journeys" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const resolved = await resolveCompany(user.id, body.companyId || null);
    const { company } = resolved;

    if (!company) {
      return NextResponse.json(
        { success: false, error: "Company not found or access denied" },
        { status: 403 }
      );
    }
    if (!canEditJourneys(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Journey edit access required" },
        { status: 403 }
      );
    }

    const cleanTruck =
      typeof body.truck === "string" ? body.truck.trim().toUpperCase() : "";
    const status =
      typeof body.status === "string" && body.status.trim()
        ? body.status.trim()
        : "active";

    if (!cleanTruck || !body.client_name || !body.from_location || !body.to_location) {
      return NextResponse.json(
        { success: false, error: "Client, truck, from, and to are required" },
        { status: 400 }
      );
    }

    if (status === "active") {
      const { data: existing, error: checkError } = await supabaseAdmin
        .from("journeys")
        .select("id, client_name, from_location, to_location")
        .eq("company_id", company.id)
        .eq("truck", cleanTruck)
        .eq("status", "active")
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        const journey = existing[0];
        return NextResponse.json(
          {
            success: false,
            error: `${cleanTruck} already has an active journey: ${
              journey.client_name || "NO CLIENT"
            } — ${journey.from_location || "—"} → ${
              journey.to_location || "—"
            }. Complete or cancel it first.`,
          },
          { status: 409 }
        );
      }
    }

    const { data: journey, error: insertError } = await supabaseAdmin
      .from("journeys")
      .insert({
        company_id: company.id,
        internal_trip_id: body.internal_trip_id || null,
        client_name:
          typeof body.client_name === "string"
            ? body.client_name.trim().toUpperCase()
            : body.client_name,
        truck: cleanTruck,
        driver:
          typeof body.driver === "string"
            ? body.driver.trim().toUpperCase()
            : body.driver || null,
        from_location:
          typeof body.from_location === "string"
            ? body.from_location.trim().toUpperCase()
            : body.from_location,
        to_location:
          typeof body.to_location === "string"
            ? body.to_location.trim().toUpperCase()
            : body.to_location,
        expected_fuel_liters: body.expected_fuel_liters ?? null,
        status,
      })
      .select(OPERATIONAL_JOURNEY_FIELDS)
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      success: true,
      company,
      journey,
    });
  } catch (err: any) {
    console.error("Journeys POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to create journey" },
      { status: 500 }
    );
  }
}
