import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  runUniversalFuelRiskEngine,
  getUniversalDriverFuelRisk,
  analyzeTruckFuelRisk,
} from "../../../../lib/intelligence/fuelRiskEngine.universal";
import {
  canViewFuel,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

async function resolveCompany(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      response: jsonResponse(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return {
      response: jsonResponse(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      response: jsonResponse(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) {
    throw membershipError;
  }

  if (!memberships || memberships.length === 0) {
    return {
      response: jsonResponse(
        { success: false, message: "No active company access" },
        { status: 403 }
      ),
    };
  }

  const url = new URL(req.url);
  const requestedCompanyId = url.searchParams.get("companyId");
  const isPlatformOwner = memberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  let companyId =
    normalizedRequestedCompanyId ||
    memberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (isPlatformOwner && !normalizedRequestedCompanyId) {
    const { data: firstCompany, error: firstCompanyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (firstCompanyError) throw firstCompanyError;
    if (firstCompany?.id) companyId = firstCompany.id;
  }

  if (
    !isPlatformOwner &&
    (!companyId || !memberships.some((membership) => membership.company_id === companyId))
  ) {
    return {
      response: jsonResponse(
        { success: false, message: "No active company access" },
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
      response: jsonResponse(
        { success: false, message: "Company not found" },
        { status: 404 }
      ),
    };
  }

  return {
    user,
    company,
    isPlatformOwner,
    roles: rolesForCompany(memberships, company.id, isPlatformOwner),
  };
}

export async function GET(req: Request) {
  try {
    const resolved = await resolveCompany(req);
    if ("response" in resolved) return resolved.response;
    if (!canViewFuel(resolved.roles)) {
      return jsonResponse(
        { success: false, message: "Fuel risk access required" },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const driverName = url.searchParams.get("driver");
    const truckId = url.searchParams.get("truck");
    const lookback = url.searchParams.get("lookback");
    const days = url.searchParams.get("days");
    const companyId = resolved.company.id;

    // Default lookback: 7 days (168 hours)
    let lookbackHours = 168;
    if (lookback === "day") lookbackHours = 24;
    else if (lookback === "week") lookbackHours = 168;
    else if (lookback === "month") lookbackHours = 720;
    else if (lookback && !isNaN(parseInt(lookback, 10))) {
      lookbackHours = parseInt(lookback, 10);
    }

    const daysNum = days
      ? parseInt(days, 10)
      : lookbackHours === 24
        ? 1
        : lookbackHours === 168
          ? 7
          : 30;

    // TRUCK-ONLY ANALYSIS (yard theft, no driver needed)
    if (truckId) {
      const result = await analyzeTruckFuelRisk(truckId, daysNum, companyId);
      return jsonResponse({
        success: true,
        company: resolved.company,
        truck_id: truckId,
        days: daysNum,
        ...result,
      });
    }

    // DRIVER-BASED ANALYSIS (shift windows)
    if (driverName) {
      const summary = await getUniversalDriverFuelRisk(
        driverName,
        daysNum,
        companyId
      );
      return jsonResponse({
        success: true,
        company: resolved.company,
        lookback_hours: lookbackHours,
        ...summary,
      });
    }

    // DEFAULT: analyze all enabled-asset shifts in the lookback period
    const result = await runUniversalFuelRiskEngine(
      undefined,
      lookbackHours,
      companyId
    );

    return jsonResponse({
      success: true,
      company: resolved.company,
      lookback_hours: lookbackHours,
      scores_analyzed: result.scores?.length || 0,
      scores: result.scores,
    });
  } catch (err: any) {
    console.error("Fuel risk API error:", err);
    return jsonResponse(
      {
        success: false,
        message: err.message || "Fuel risk analysis failed",
      },
      { status: 500 }
    );
  }
}
