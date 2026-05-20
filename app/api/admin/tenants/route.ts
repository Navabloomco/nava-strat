import {
  buildPricingPreview,
  buildReadinessStatus,
  fetchCompanies,
  noStoreJson,
  readinessLabel,
  requirePlatformOwner,
  safeCompany,
  summarizeAssets,
} from "./tenantBilling";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const [
      companiesResult,
      membersResult,
      assetsResult,
      providersResult,
      telemetryResult,
    ] = await Promise.all([
      fetchCompanies(),
      supabaseAdmin
        .from("company_users")
        .select("company_id, role, is_active")
        .eq("is_active", true),
      supabaseAdmin
        .from("fleet_assets")
        .select(
          "company_id, status, billing_status, intelligence_enabled, billing_enabled_at"
        ),
      supabaseAdmin
        .from("tracking_providers")
        .select("company_id, id, is_active, last_sync_at"),
      supabaseAdmin
        .from("telemetry_logs")
        .select("company_id, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(2000),
    ]);

    if (companiesResult.error) throw companiesResult.error;
    if (membersResult.error) throw membersResult.error;
    if (assetsResult.error) throw assetsResult.error;
    if (providersResult.error) throw providersResult.error;
    if (telemetryResult.error) throw telemetryResult.error;

    const membersByCompany = groupByCompany(membersResult.data || []);
    const assetsByCompany = groupByCompany(assetsResult.data || []);
    const providersByCompany = groupByCompany(providersResult.data || []);
    const lastTelemetryByCompany = new Map<string, string>();

    for (const row of telemetryResult.data || []) {
      if (!row.company_id || !row.recorded_at) continue;
      if (!lastTelemetryByCompany.has(row.company_id)) {
        lastTelemetryByCompany.set(row.company_id, row.recorded_at);
      }
    }

    const tenants = (companiesResult.data || []).map((company: any) => {
      const companyAssets = assetsByCompany.get(company.id) || [];
      const companyProviders = providersByCompany.get(company.id) || [];
      const assetSummary = summarizeAssets(companyAssets);
      const pricing = buildPricingPreview(
        company,
        assetSummary.strict_billable_asset_count
      );
      const readinessStatus = buildReadinessStatus({
        providerCount: companyProviders.length,
        importedAssetCount: assetSummary.imported_asset_count,
        strictBillableAssetCount: assetSummary.strict_billable_asset_count,
        pricingSet: pricing.pricing_set,
      });

      return {
        company: safeCompany(company),
        active_member_count: (membersByCompany.get(company.id) || []).length,
        imported_asset_count: assetSummary.imported_asset_count,
        strict_billable_asset_count: assetSummary.strict_billable_asset_count,
        estimated_monthly_revenue: pricing.estimated_monthly_revenue,
        pricing,
        provider_count: companyProviders.length,
        active_provider_count: companyProviders.filter((provider) =>
          Boolean(provider.is_active)
        ).length,
        last_telemetry_at: lastTelemetryByCompany.get(company.id) || null,
        setup_readiness: {
          status: readinessStatus,
          label: readinessLabel(readinessStatus),
        },
      };
    });

    const totals = tenants.reduce(
      (summary, tenant) => ({
        tenant_count: summary.tenant_count + 1,
        imported_asset_count:
          summary.imported_asset_count + tenant.imported_asset_count,
        strict_billable_asset_count:
          summary.strict_billable_asset_count +
          tenant.strict_billable_asset_count,
        estimated_monthly_revenue:
          summary.estimated_monthly_revenue +
          Number(tenant.estimated_monthly_revenue || 0),
        estimated_monthly_revenue_by_currency: addCurrencyTotal(
          summary.estimated_monthly_revenue_by_currency,
          tenant.pricing.billing_currency,
          tenant.estimated_monthly_revenue
        ),
        tenants_missing_pricing:
          summary.tenants_missing_pricing + (tenant.pricing.pricing_set ? 0 : 1),
      }),
      {
        tenant_count: 0,
        imported_asset_count: 0,
        strict_billable_asset_count: 0,
        estimated_monthly_revenue: 0,
        estimated_monthly_revenue_by_currency: {},
        tenants_missing_pricing: 0,
      }
    );

    return noStoreJson({
      success: true,
      tenants,
      totals,
      billing_rule: {
        strict_billable_asset:
          "status=active AND billing_status=enabled AND intelligence_enabled=true AND billing_enabled_at is not null",
      },
    });
  } catch (err: any) {
    console.error("Admin tenants GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load tenants" },
      { status: 500 }
    );
  }
}

function groupByCompany(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.company_id) continue;
    groups.set(row.company_id, [...(groups.get(row.company_id) || []), row]);
  }
  return groups;
}

function addCurrencyTotal(
  totals: Record<string, number>,
  currency: string,
  value: number | null
) {
  if (value === null || value === undefined) return totals;

  return {
    ...totals,
    [currency || "KES"]: Number(totals[currency || "KES"] || 0) + Number(value || 0),
  };
}
