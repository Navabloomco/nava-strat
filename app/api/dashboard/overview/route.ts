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
import {
  buildPricingPreview,
  fetchCompanies,
  summarizeAssets,
} from "../../admin/tenants/tenantBilling";
import { buildPilotReadinessList } from "../../admin/pilot-readiness/readiness";

export const dynamic = "force-dynamic";

const SAFE_MEMORY_FIELDS =
  "id, memory_type, severity, title, summary, recommendation, last_seen_at";
const PLATFORM_OPERATOR_COMPANY_KEYS = new Set(["navabloomco"]);

function sanitizeDashboardMemories(
  memories: any[],
  capabilities: ReturnType<typeof getRoleCapabilities>
) {
  return (memories || [])
    .filter((memory) => {
      if (
        capabilities.canViewFinance &&
        capabilities.canViewBilling &&
        capabilities.canViewExpenses
      ) {
        return true;
      }

      const text = [
        memory.memory_type,
        memory.title,
        memory.summary,
        memory.recommendation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return !/\b(revenue|profit|margin|rate|invoice|billing|billable|expense|payment)\b/.test(
        text
      );
    })
    .map((memory) => ({
      id: memory.id,
      memory_type: memory.memory_type,
      severity: memory.severity,
      title: memory.title,
      summary: memory.summary,
      recommendation: memory.recommendation || null,
      last_seen_at: memory.last_seen_at || null,
    }));
}

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

function normalizeCompanyKey(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isPlatformOperatorCompany(company: any) {
  const slugKey = normalizeCompanyKey(company?.slug);
  const nameKey = normalizeCompanyKey(company?.name);

  return (
    PLATFORM_OPERATOR_COMPANY_KEYS.has(slugKey) ||
    PLATFORM_OPERATOR_COMPANY_KEYS.has(nameKey)
  );
}

async function getPlatformOperatorSummary(operatorCompanyId: string) {
  const [companiesResult, assetsResult, readinessResult] = await Promise.all([
    fetchCompanies(),
    supabaseAdmin
      .from("fleet_assets")
      .select(
        "company_id, status, billing_status, intelligence_enabled, billing_enabled_at"
      ),
    buildPilotReadinessList().catch((error) => ({
      error: error?.message || "Pilot readiness summary unavailable",
    })),
  ]);

  if (companiesResult.error) throw companiesResult.error;
  if (assetsResult.error) throw assetsResult.error;

  const companies = companiesResult.data || [];
  const operatorCompanyIds = new Set(
    companies
      .filter((company: any) => isPlatformOperatorCompany(company))
      .map((company: any) => company.id)
      .filter(Boolean)
  );
  operatorCompanyIds.add(operatorCompanyId);

  const tenantCompanies = companies.filter(
    (company: any) => !operatorCompanyIds.has(company.id)
  );
  const assetsByCompany = new Map<string, any[]>();

  for (const asset of assetsResult.data || []) {
    if (!asset.company_id || operatorCompanyIds.has(asset.company_id)) continue;
    assetsByCompany.set(asset.company_id, [
      ...(assetsByCompany.get(asset.company_id) || []),
      asset,
    ]);
  }

  const tenantSummaries = tenantCompanies.map((company: any) => {
    const assetSummary = summarizeAssets(assetsByCompany.get(company.id) || []);
    const pricing = buildPricingPreview(
      company,
      assetSummary.strict_billable_asset_count
    );

    return {
      strict_billable_asset_count: assetSummary.strict_billable_asset_count,
      estimated_monthly_revenue: pricing.estimated_monthly_revenue,
      billing_currency: pricing.billing_currency,
      pricing_set: pricing.pricing_set,
    };
  });

  const revenueByCurrency = tenantSummaries.reduce(
    (totals: Record<string, number>, tenant) => {
      if (tenant.estimated_monthly_revenue === null) return totals;
      const currency = tenant.billing_currency || "KES";
      return {
        ...totals,
        [currency]:
          Number(totals[currency] || 0) +
          Number(tenant.estimated_monthly_revenue || 0),
      };
    },
    {}
  );

  const readinessTenants =
    "tenants" in readinessResult
      ? readinessResult.tenants.filter(
          (tenant: any) => !operatorCompanyIds.has(tenant.company?.id)
        )
      : null;
  const readinessTotals = readinessTenants
    ? readinessTenants.reduce(
        (totals: any, tenant: any) => ({
          ready:
            totals.ready +
            (tenant.overall_readiness?.status === "ready" ? 1 : 0),
          needs_attention:
            totals.needs_attention +
            (tenant.overall_readiness?.status === "needs_attention" ? 1 : 0),
          blocked:
            totals.blocked +
            (tenant.overall_readiness?.status === "blocked" ? 1 : 0),
        }),
        { ready: 0, needs_attention: 0, blocked: 0 }
      )
    : null;

  return {
    tenant_count: tenantCompanies.length,
    strict_billable_asset_count: tenantSummaries.reduce(
      (total, tenant) => total + tenant.strict_billable_asset_count,
      0
    ),
    estimated_monthly_revenue_by_currency: revenueByCurrency,
    tenants_missing_pricing: tenantSummaries.filter(
      (tenant) => !tenant.pricing_set
    ).length,
    readiness: readinessTotals
      ? {
          ready: readinessTotals.ready,
          needs_attention: readinessTotals.needs_attention,
          blocked: readinessTotals.blocked,
        }
      : null,
    readiness_unavailable_reason:
      "error" in readinessResult ? readinessResult.error : null,
    operator_company_detection: {
      method: "temporary_slug_or_name_heuristic",
      matched_key: "navabloomco",
    },
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
        const { data: companies, error: companyError } = await supabaseAdmin
          .from("companies")
          .select("id, name, slug")
          .order("name", { ascending: true });

        if (companyError) throw companyError;
        const defaultCompany =
          (companies || []).find((candidate) =>
            isPlatformOperatorCompany(candidate)
          ) || (companies || [])[0];

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
    const isPlatformOperatorDashboard =
      isPlatformOwner && isPlatformOperatorCompany(company);

    if (isPlatformOperatorDashboard) {
      const platformSummary = await getPlatformOperatorSummary(company.id);

      return NextResponse.json({
        success: true,
        dashboard_mode: "platform_operator",
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
        },
        capabilities,
        platform_operator_summary: platformSummary,
      });
    }

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
      dashboard_mode: "fleet",
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
      },
      fleet_health: fleetHealth,
      capabilities,
      ...(assetReviewSummary ? { asset_review_summary: assetReviewSummary } : {}),
      active_memories: sanitizeDashboardMemories(memories || [], capabilities),
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
