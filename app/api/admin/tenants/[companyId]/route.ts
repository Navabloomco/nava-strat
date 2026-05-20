import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  buildPricingPreview,
  buildReadinessStatus,
  fetchCompany,
  noStoreJson,
  readinessLabel,
  requirePlatformOwner,
  safeCompany,
  safeOperatingContext,
  summarizeAssets,
} from "../tenantBilling";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECENT_TELEMETRY_HOURS = 24;

export async function GET(
  req: Request,
  { params }: { params: { companyId: string } }
) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const companyId = params.companyId;
    const companyResult = await fetchCompany(companyId);
    if (companyResult.error) throw companyResult.error;

    const company = companyResult.data;
    if (!company) {
      return noStoreJson(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    const recentSince = new Date(
      Date.now() - RECENT_TELEMETRY_HOURS * 60 * 60 * 1000
    ).toISOString();

    const [
      membersResult,
      providersResult,
      assetsResult,
      recentTelemetryResult,
      latestTelemetryResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("company_users")
        .select("role, is_active")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabaseAdmin
        .from("tracking_providers")
        .select(
          "id, provider_name, provider_slug, is_active, last_sync_at, last_test_status, last_test_at"
        )
        .eq("company_id", companyId)
        .order("provider_name", { ascending: true }),
      supabaseAdmin
        .from("fleet_assets")
        .select(
          "id, status, billing_status, intelligence_enabled, billing_enabled_at"
        )
        .eq("company_id", companyId),
      supabaseAdmin
        .from("telemetry_logs")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .gte("recorded_at", recentSince),
      supabaseAdmin
        .from("telemetry_logs")
        .select("recorded_at")
        .eq("company_id", companyId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (membersResult.error) throw membersResult.error;
    if (providersResult.error) throw providersResult.error;
    if (assetsResult.error) throw assetsResult.error;
    if (recentTelemetryResult.error) throw recentTelemetryResult.error;
    if (latestTelemetryResult.error) throw latestTelemetryResult.error;

    const assetSummary = summarizeAssets(assetsResult.data || []);
    const pricing = buildPricingPreview(
      company,
      assetSummary.strict_billable_asset_count
    );
    const providers = (providersResult.data || []).map((provider: any) => ({
      id: provider.id,
      provider_name: provider.provider_name || null,
      provider_slug: provider.provider_slug || null,
      is_active: Boolean(provider.is_active),
      last_sync_at: provider.last_sync_at || null,
      last_status: provider.last_test_status || null,
      last_test_at: provider.last_test_at || null,
    }));
    const readinessStatus = buildReadinessStatus({
      providerCount: providers.length,
      importedAssetCount: assetSummary.imported_asset_count,
      strictBillableAssetCount: assetSummary.strict_billable_asset_count,
      pricingSet: pricing.pricing_set,
    });

    return noStoreJson({
      success: true,
      company: safeCompany(company),
      operating_context: safeOperatingContext(company),
      members: {
        active_member_count: (membersResult.data || []).length,
        by_role: countMembersByRole(membersResult.data || []),
      },
      providers,
      asset_billing_summary: assetSummary,
      pricing,
      setup_readiness: {
        status: readinessStatus,
        label: readinessLabel(readinessStatus),
      },
      telemetry: {
        recent_window_hours: RECENT_TELEMETRY_HOURS,
        recent_count: recentTelemetryResult.count || 0,
        latest_recorded_at: latestTelemetryResult.data?.recorded_at || null,
      },
      links: {
        asset_review: `/admin/assets?companyId=${encodeURIComponent(companyId)}`,
        provider_vault: `/admin/providers?companyId=${encodeURIComponent(companyId)}`,
        company_settings: `/admin/company?companyId=${encodeURIComponent(companyId)}`,
      },
      billing_rule: {
        strict_billable_asset:
          "status=active AND billing_status=enabled AND intelligence_enabled=true AND billing_enabled_at is not null",
      },
    });
  } catch (err: any) {
    console.error("Admin tenant detail GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load tenant" },
      { status: 500 }
    );
  }
}

function countMembersByRole(members: any[]) {
  return members.reduce((counts: Record<string, number>, member) => {
    const role = String(member.role || "unknown").trim().toLowerCase() || "unknown";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}
