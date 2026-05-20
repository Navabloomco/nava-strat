// app/api/dashboard/overview/route.ts
import { NextResponse } from "next/server";
import { getFleetHealth } from "../../../../lib/intelligence/fleetHealthService";
import { getCurrentTrucksInCountry } from "../../../../lib/intelligence/fleetLocationService";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { supabase } from "../../../../lib/supabase";
import {
  getRoleCapabilities,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";

export const dynamic = "force-dynamic";

const SAFE_MEMORY_FIELDS =
  "id, memory_type, severity, title, summary, recommendation, last_seen_at";

async function getAssetReviewSummary(companyId: string) {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, status, billing_status, intelligence_enabled")
    .eq("company_id", companyId);

  if (error) throw error;

  const assets = data || [];
  const enabledAssets = assets.filter(
    (asset) => asset.status === "active" && asset.intelligence_enabled === true
  );

  return {
    imported_assets: assets.length,
    enabled_assets: enabledAssets.length,
    unreviewed_assets: assets.filter(
      (asset) => asset.billing_status === "unreviewed"
    ).length,
    disabled_or_excluded_assets: assets.filter((asset) =>
      ["disabled", "excluded"].includes(String(asset.billing_status || ""))
    ).length,
  };
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedCompanyId = searchParams.get("companyId");

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("company_users")
      .select("company_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) throw membershipError;

    const activeMemberships = (memberships || []).map((membership) => ({
      ...membership,
      role: normalizeRole(membership.role),
    }));
    const isPlatformOwner = activeMemberships.some(
      (membership) => membership.role === "platform_owner"
    );

    let company;

    if (isPlatformOwner) {
      if (requestedCompanyId) {
        const { data: requestedCompany, error: companyError } =
          await supabaseAdmin
            .from("companies")
            .select("id, name, slug")
            .eq("id", requestedCompanyId)
            .maybeSingle();

        if (companyError) throw companyError;
        if (!requestedCompany) {
          return NextResponse.json(
            { success: false, error: "Company not found" },
            { status: 404 }
          );
        }

        company = requestedCompany;
      } else {
        const { data: defaultCompany, error: companyError } =
          await supabaseAdmin
            .from("companies")
            .select("id, name, slug")
            .order("name", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (companyError) throw companyError;
        if (!defaultCompany) {
          return NextResponse.json(
            { success: false, error: "Company not found" },
            { status: 404 }
          );
        }

        company = defaultCompany;
      }
    } else {
      const companyId = activeMemberships
        .map((membership) => membership.company_id)
        .filter(Boolean)[0];

      if (!companyId) {
        return NextResponse.json(
          { success: false, error: "User not associated with any company" },
          { status: 403 }
        );
      }

      const { data: assignedCompany, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .eq("id", companyId)
        .maybeSingle();

      if (companyError) throw companyError;
      if (!assignedCompany) {
        return NextResponse.json(
          { success: false, error: "Company not found" },
          { status: 404 }
        );
      }

      company = assignedCompany;
    }

    const companyRoles = rolesForCompany(activeMemberships, company.id, isPlatformOwner);
    const capabilities = getRoleCapabilities(companyRoles);
    const [fleetHealth, assetReviewSummary] = await Promise.all([
      getFleetHealth(company.id),
      capabilities.canReviewAssets
        ? getAssetReviewSummary(company.id)
        : Promise.resolve(null),
    ]);

    if (!capabilities.canViewFuel) {
      delete (fleetHealth as any).fuel_telemetry_summary;
    }

    // Active memories
    const { data: memories, error: memoryError } = await supabaseAdmin
      .from("nava_eye_memory")
      .select(SAFE_MEMORY_FIELDS)
      .eq("company_id", company.id)
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(10);
    if (memoryError) throw memoryError;

    const ugandaTrucks = await getCurrentTrucksInCountry(company.id, "Uganda");

    return NextResponse.json({
      success: true,
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
      },
      fleet_health: fleetHealth,
      capabilities,
      ...(assetReviewSummary ? { asset_review_summary: assetReviewSummary } : {}),
      active_memories: memories || [],
      trucks_in_uganda: ugandaTrucks,
    });
  } catch (err: any) {
    console.error("Dashboard overview error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Dashboard overview failed" },
      { status: 500 }
    );
  }
}
