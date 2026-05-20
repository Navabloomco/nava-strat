import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  buildInvoicePreview,
  buildPricingPreview,
  fetchCompanies,
  fetchCompany,
  isMissingBillingInvoicesTable,
  safeCompany,
  safeOperatingContext,
  summarizeAssets,
} from "../tenants/tenantBilling";

type CheckStatus = "pass" | "warning" | "fail";

type ReadinessCheck = {
  category: string;
  status: CheckStatus;
  label: string;
  explanation: string;
  suggested_next_action: string;
  route?: string | null;
  route_note?: string | null;
};

type OptionalRowsResult = {
  rows: any[];
  available: boolean;
  setup_message?: string;
};

const RECENT_SYNC_HOURS = 48;

export async function buildPilotReadinessList() {
  const companiesResult = await fetchCompanies();
  if (companiesResult.error) throw companiesResult.error;

  const companies = companiesResult.data || [];
  const companyIds = companies.map((company: any) => company.id).filter(Boolean);
  const shared = await fetchSharedReadinessData(companyIds);
  const tenants = companies.map((company: any) => buildCompanyReadiness(company, shared));
  const totals = summarizeReadinessList(tenants);

  return {
    tenants,
    totals,
    readiness_definition: {
      ready: "No failed checks and no warnings.",
      needs_attention: "No failed checks, but at least one warning needs review.",
      blocked: "At least one failed check blocks pilot/go-live readiness.",
    },
  };
}

export async function buildPilotReadinessDetail(companyId: string) {
  const companyResult = await fetchCompany(companyId);
  if (companyResult.error) throw companyResult.error;

  if (!companyResult.data) return null;

  const shared = await fetchSharedReadinessData([companyId]);
  return buildCompanyReadiness(companyResult.data, shared);
}

async function fetchSharedReadinessData(companyIds: string[]) {
  if (companyIds.length === 0) {
    return {
      membersByCompany: new Map(),
      providersByCompany: new Map(),
      assetsByCompany: new Map(),
      latestTelemetryByCompany: new Map(),
      drivers: emptyOptionalGroup(),
      geofences: emptyOptionalGroup(),
      journeys: emptyOptionalGroup(),
      templates: emptyOptionalGroup(),
      aiSettings: emptyOptionalGroup(),
      memory: emptyOptionalGroup(),
      invoices: emptyOptionalGroup(),
    };
  }

  const [
    membersResult,
    providersResult,
    assetsResult,
    telemetryResult,
    driversResult,
    geofencesResult,
    journeysResult,
    templatesResult,
    aiSettingsResult,
    memoryResult,
    invoicesResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("company_users")
      .select("company_id, role, is_active")
      .in("company_id", companyIds)
      .eq("is_active", true),
    supabaseAdmin
      .from("tracking_providers")
      .select(
        "company_id, id, provider_name, provider_slug, is_active, last_sync_at, last_test_status, last_test_at"
      )
      .in("company_id", companyIds),
    supabaseAdmin
      .from("fleet_assets")
      .select(
        "company_id, id, status, billing_status, intelligence_enabled, billing_enabled_at"
      )
      .in("company_id", companyIds),
    supabaseAdmin
      .from("telemetry_logs")
      .select("company_id, recorded_at")
      .in("company_id", companyIds)
      .order("recorded_at", { ascending: false })
      .limit(5000),
    fetchOptionalCompanyRows("drivers", companyIds),
    fetchOptionalCompanyRows("geofences", companyIds),
    fetchOptionalCompanyRows("journeys", companyIds),
    fetchOptionalCompanyRows("journey_templates", companyIds),
    fetchOptionalCompanyRows("company_ai_settings", companyIds),
    fetchOptionalCompanyRows("nava_eye_memory", companyIds),
    fetchOptionalCompanyRows("billing_invoices", companyIds),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (providersResult.error) throw providersResult.error;
  if (assetsResult.error) throw assetsResult.error;
  if (telemetryResult.error) throw telemetryResult.error;

  return {
    membersByCompany: groupByCompany(membersResult.data || []),
    providersByCompany: groupByCompany(providersResult.data || []),
    assetsByCompany: groupByCompany(assetsResult.data || []),
    latestTelemetryByCompany: latestTelemetryByCompany(telemetryResult.data || []),
    drivers: groupOptionalRows(driversResult),
    geofences: groupOptionalRows(geofencesResult),
    journeys: groupOptionalRows(journeysResult),
    templates: groupOptionalRows(templatesResult),
    aiSettings: groupOptionalRows(aiSettingsResult),
    memory: groupOptionalRows(memoryResult),
    invoices: groupOptionalRows(invoicesResult, "Billing invoice records are not configured yet."),
  };
}

function emptyOptionalGroup() {
  return {
    available: true,
    setup_message: null,
    byCompany: new Map<string, any[]>(),
  };
}

async function fetchOptionalCompanyRows(
  table: string,
  companyIds: string[]
): Promise<OptionalRowsResult> {
  if (companyIds.length === 0) {
    return { rows: [], available: true };
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .select("company_id")
    .in("company_id", companyIds);

  if (error) {
    return {
      rows: [],
      available: false,
      setup_message: readableSchemaMessage(table, error),
    };
  }

  return { rows: data || [], available: true };
}

function readableSchemaMessage(table: string, error: any) {
  if (table === "billing_invoices" && isMissingBillingInvoicesTable(error)) {
    return "The billing_invoices table or required columns are not available yet.";
  }

  const message = String(error?.message || error?.details || "Schema unavailable");
  return `${table} is unavailable: ${message}`;
}

function groupOptionalRows(result: OptionalRowsResult, fallbackMessage?: string) {
  return {
    available: result.available,
    setup_message: result.setup_message || fallbackMessage || null,
    byCompany: groupByCompany(result.rows),
  };
}

function groupByCompany(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.company_id) continue;
    groups.set(row.company_id, [...(groups.get(row.company_id) || []), row]);
  }
  return groups;
}

function latestTelemetryByCompany(rows: any[]) {
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!row.company_id || !row.recorded_at) continue;
    if (!latest.has(row.company_id)) {
      latest.set(row.company_id, row.recorded_at);
    }
  }
  return latest;
}

function buildCompanyReadiness(company: any, shared: any) {
  const companyId = company.id;
  const members = shared.membersByCompany.get(companyId) || [];
  const providers = shared.providersByCompany.get(companyId) || [];
  const assets = shared.assetsByCompany.get(companyId) || [];
  const assetSummary = summarizeAssets(assets);
  const pricing = buildPricingPreview(company, assetSummary.strict_billable_asset_count);
  const invoicePreview = buildInvoicePreview({
    company,
    importedAssetCount: assetSummary.imported_asset_count,
    strictBillableAssetCount: assetSummary.strict_billable_asset_count,
  });
  const roleCounts = countMembersByRole(members);
  const safeProviders = providers.map((provider: any) => ({
    id: provider.id,
    provider_name: provider.provider_name || null,
    provider_slug: provider.provider_slug || null,
    is_active: Boolean(provider.is_active),
    last_sync_at: provider.last_sync_at || null,
    last_status: provider.last_test_status || null,
    last_test_at: provider.last_test_at || null,
  }));
  const checks = buildChecks({
    company,
    roleCounts,
    providers: safeProviders,
    assetSummary,
    pricing,
    invoicePreview,
    latestTelemetryAt: shared.latestTelemetryByCompany.get(companyId) || null,
    drivers: countOptionalRows(shared.drivers, companyId),
    geofences: countOptionalRows(shared.geofences, companyId),
    journeys: countOptionalRows(shared.journeys, companyId),
    templates: countOptionalRows(shared.templates, companyId),
    aiSettings: countOptionalRows(shared.aiSettings, companyId),
    memory: countOptionalRows(shared.memory, companyId),
    invoices: countOptionalRows(shared.invoices, companyId),
  });
  const counts = summarizeChecks(checks);
  const overall = overallReadiness(counts);
  const actions = buildActionPanel(checks);

  return {
    company: safeCompany(company),
    operating_context: safeOperatingContext(company),
    overall_readiness: overall,
    check_counts: counts,
    checks,
    actions,
    members: {
      active_member_count: members.length,
      by_role: roleCounts,
    },
    providers: safeProviders,
    asset_billing_summary: assetSummary,
    pricing,
    invoice_preview: {
      possible: pricing.pricing_set && assetSummary.strict_billable_asset_count > 0,
      setup_required: !shared.invoices.available,
      setup_message: shared.invoices.setup_message || null,
      recent_invoice_records_count: countOptionalRows(shared.invoices, companyId).count,
      estimated_monthly_total: invoicePreview.estimated_monthly_total,
      billing_currency: invoicePreview.billing_currency,
      readiness_warnings: invoicePreview.readiness_warnings,
    },
    operations: {
      driver_count: countOptionalRows(shared.drivers, companyId).count,
      geofence_count: countOptionalRows(shared.geofences, companyId).count,
      journey_count: countOptionalRows(shared.journeys, companyId).count,
      saved_route_count: countOptionalRows(shared.templates, companyId).count,
    },
    nava_eye: {
      ai_settings_count: countOptionalRows(shared.aiSettings, companyId).count,
      memory_count: countOptionalRows(shared.memory, companyId).count,
    },
    telemetry: {
      latest_recorded_at: shared.latestTelemetryByCompany.get(companyId) || null,
    },
    links: {
      tenant_billing: `/admin/tenants/${encodeURIComponent(companyId)}`,
      invoice_preview: `/admin/tenants/${encodeURIComponent(
        companyId
      )}/invoice-preview`,
      asset_review: `/admin/assets?companyId=${encodeURIComponent(companyId)}`,
      provider_vault: `/admin/providers?companyId=${encodeURIComponent(companyId)}`,
      company_settings: `/admin/company?companyId=${encodeURIComponent(companyId)}`,
    },
  };
}

function countOptionalRows(group: any, companyId: string) {
  return {
    available: Boolean(group.available),
    setup_message: group.setup_message || null,
    count: (group.byCompany.get(companyId) || []).length,
  };
}

function buildChecks(input: {
  company: any;
  roleCounts: Record<string, number>;
  providers: any[];
  assetSummary: any;
  pricing: any;
  invoicePreview: any;
  latestTelemetryAt: string | null;
  drivers: ReturnType<typeof countOptionalRows>;
  geofences: ReturnType<typeof countOptionalRows>;
  journeys: ReturnType<typeof countOptionalRows>;
  templates: ReturnType<typeof countOptionalRows>;
  aiSettings: ReturnType<typeof countOptionalRows>;
  memory: ReturnType<typeof countOptionalRows>;
  invoices: ReturnType<typeof countOptionalRows>;
}): ReadinessCheck[] {
  const companyId = input.company.id;
  const activeProviders = input.providers.filter((provider) => provider.is_active);
  const latestSync = latestDate(input.providers.map((provider) => provider.last_sync_at));
  const recentSync = latestSync
    ? Date.now() - new Date(latestSync).getTime() <=
      RECENT_SYNC_HOURS * 60 * 60 * 1000
    : false;
  const operatingFields = [
    input.company.business_type,
    nonEmptyList(input.company.primary_asset_types),
    input.company.main_billing_unit,
    nonEmptyList(input.company.operating_regions),
    input.company.primary_use_case,
  ];
  const operatingFieldCount = operatingFields.filter(Boolean).length;
  const adminCount =
    Number(input.roleCounts.platform_owner || 0) +
    Number(input.roleCounts.owner || 0) +
    Number(input.roleCounts.admin || 0);
  const journeyOrRouteCount = input.journeys.count + input.templates.count;

  return [
    check(
      "Company setup",
      "Company record exists",
      "pass",
      "The company can be loaded by the platform readiness check.",
      "Keep company context current.",
      `/admin/tenants/${companyId}`
    ),
    check(
      "Company setup",
      "Company name and slug",
      input.company.name && input.company.slug ? "pass" : "fail",
      input.company.name && input.company.slug
        ? "Name and slug are present."
        : "Company name or slug is missing.",
      "Update company settings before pilot.",
      `/admin/company?companyId=${companyId}`
    ),
    check(
      "Company setup",
      "Operating context",
      operatingFieldCount >= 4 ? "pass" : operatingFieldCount > 0 ? "warning" : "fail",
      operatingFieldCount >= 4
        ? "Operating context is mostly complete."
        : operatingFieldCount > 0
          ? "Some operating context is present, but pilot answers and asset suggestions will be better after completion."
          : "Operating context is missing.",
      "Complete business type, asset types, billing unit, regions, and primary use case.",
      `/admin/company?companyId=${companyId}`
    ),
    check(
      "Company setup",
      "Billing currency",
      input.company.billing_currency ? "pass" : "warning",
      input.company.billing_currency
        ? `Billing currency is set to ${input.company.billing_currency}.`
        : "Billing currency is not set.",
      "Set billing currency in company settings.",
      `/admin/company?companyId=${companyId}`
    ),
    check(
      "Company setup",
      "Asset unit price",
      input.pricing.pricing_set ? "pass" : "fail",
      input.pricing.pricing_set
        ? "Per-asset price is configured."
        : "Per-asset price is missing or zero.",
      "Set asset_unit_price before pilot billing.",
      `/admin/company?companyId=${companyId}`
    ),
    check(
      "Provider setup",
      "Active tracking provider",
      activeProviders.length > 0 ? "pass" : "fail",
      activeProviders.length > 0
        ? `${activeProviders.length} active provider(s) are configured.`
        : "No active tracking provider is configured.",
      "Configure and activate a tracking provider.",
      `/admin/providers?companyId=${companyId}`
    ),
    check(
      "Provider setup",
      "Provider test or sync status",
      input.providers.some((provider) => provider.last_status || provider.last_sync_at)
        ? "pass"
        : activeProviders.length > 0
          ? "warning"
          : "fail",
      input.providers.some((provider) => provider.last_status || provider.last_sync_at)
        ? "At least one provider has test or sync history."
        : "Provider test/sync status has not been recorded yet.",
      "Run provider test and sync diagnostics.",
      `/admin/providers?companyId=${companyId}`
    ),
    check(
      "Provider setup",
      "Recent provider sync",
      recentSync ? "pass" : activeProviders.length > 0 ? "warning" : "fail",
      latestSync
        ? `Latest provider sync was ${new Date(latestSync).toLocaleString()}.`
        : "No provider sync timestamp is available.",
      "Run provider sync and verify telemetry freshness.",
      `/admin/providers?companyId=${companyId}`
    ),
    check(
      "Asset review",
      "Imported assets",
      input.assetSummary.imported_asset_count > 0 ? "pass" : "fail",
      `${input.assetSummary.imported_asset_count} imported asset(s) found.`,
      "Connect provider sync so imported assets appear for review.",
      `/admin/assets?companyId=${companyId}`
    ),
    check(
      "Asset review",
      "Enabled intelligence assets",
      input.assetSummary.enabled_intelligence_count > 0 ? "pass" : "fail",
      `${input.assetSummary.enabled_intelligence_count} enabled intelligence asset(s).`,
      "Review imported assets and enable intelligence vehicles.",
      `/admin/assets?companyId=${companyId}`
    ),
    check(
      "Asset review",
      "Strict billable assets",
      input.assetSummary.strict_billable_asset_count > 0 ? "pass" : "fail",
      `${input.assetSummary.strict_billable_asset_count} strict billable asset(s).`,
      "Enable reviewed intelligence assets with billing timestamps.",
      `/admin/assets?companyId=${companyId}`
    ),
    check(
      "Asset review",
      "Unreviewed imported assets",
      input.assetSummary.unreviewed_asset_count === 0 ? "pass" : "warning",
      input.assetSummary.unreviewed_asset_count === 0
        ? "No unreviewed imported assets remain."
        : `${input.assetSummary.unreviewed_asset_count} imported asset(s) still need review.`,
      "Review, enable, disable, or exclude remaining imported assets.",
      `/admin/assets?companyId=${companyId}`
    ),
    check(
      "Asset review",
      "Imported but not enabled",
      input.assetSummary.imported_asset_count > 0 &&
        input.assetSummary.enabled_intelligence_count === 0
        ? "warning"
        : "pass",
      input.assetSummary.imported_asset_count > 0 &&
        input.assetSummary.enabled_intelligence_count === 0
        ? "Imported assets exist, but none are enabled for live intelligence."
        : "Imported assets are not stuck outside intelligence review.",
      "Open Asset Review and enable the pilot vehicles.",
      `/admin/assets?companyId=${companyId}`
    ),
    check(
      "Billing readiness",
      "Billing invoice schema",
      input.invoices.available ? "pass" : "fail",
      input.invoices.available
        ? "billing_invoices is reachable for invoice record checks."
        : input.invoices.setup_message || "billing_invoices is not configured.",
      "Apply the additive billing_invoices SQL migration.",
      "/admin/health"
    ),
    check(
      "Billing readiness",
      "Invoice preview possible",
      input.pricing.pricing_set && input.assetSummary.strict_billable_asset_count > 0
        ? "pass"
        : "fail",
      input.pricing.pricing_set && input.assetSummary.strict_billable_asset_count > 0
        ? "Invoice preview can calculate a tenant estimate."
        : "Invoice preview needs both pricing and strict billable assets.",
      "Set pricing and enable strict billable assets.",
      `/admin/tenants/${companyId}/invoice-preview`
    ),
    check(
      "Billing readiness",
      "Recent invoice records",
      !input.invoices.available ? "warning" : input.invoices.count > 0 ? "pass" : "warning",
      !input.invoices.available
        ? "Invoice records cannot be checked until billing_invoices exists."
        : input.invoices.count > 0
          ? `${input.invoices.count} invoice record(s) exist.`
          : "No invoice records exist yet. This is acceptable before the first billing cycle.",
      "Create the first draft from invoice preview when ready.",
      `/admin/tenants/${companyId}/invoice-preview`
    ),
    check(
      "Role/security readiness",
      "Admin membership",
      adminCount > 0 ? "pass" : "fail",
      adminCount > 0
        ? `${adminCount} owner/admin/platform owner membership(s) found.`
        : "No owner, admin, or platform owner membership was found for this company.",
      "Add at least one owner/admin membership before pilot support.",
      "/admin"
    ),
    check(
      "Role/security readiness",
      "Role counts",
      Object.keys(input.roleCounts).length > 0 ? "pass" : "fail",
      Object.keys(input.roleCounts).length > 0
        ? "Active memberships can be counted by role without exposing user emails."
        : "No active memberships were found.",
      "Confirm company_users memberships are active.",
      "/admin"
    ),
    check(
      "Operations readiness",
      "Enabled asset for operations",
      input.assetSummary.enabled_intelligence_count > 0 ? "pass" : "warning",
      input.assetSummary.enabled_intelligence_count > 0
        ? "Operations can use at least one enabled asset."
        : "Operations will be thin until at least one asset is enabled.",
      "Enable pilot vehicles in Asset Review.",
      `/admin/assets?companyId=${companyId}`
    ),
    optionalCountCheck(
      "Operations readiness",
      "Driver directory",
      input.drivers,
      "driver",
      "Add drivers so alerts and journeys can use consistent driver names.",
      "/ops/drivers"
    ),
    optionalCountCheck(
      "Operations readiness",
      "Geofences",
      input.geofences,
      "geofence",
      "Create key places such as yards, depots, customer sites, and risk zones.",
      "/geofences"
    ),
    check(
      "Operations readiness",
      "Journeys or saved routes",
      journeyOrRouteCount > 0 ? "pass" : "warning",
      journeyOrRouteCount > 0
        ? `${journeyOrRouteCount} journey/saved route record(s) found.`
        : "No journeys or saved routes exist yet.",
      "Create a journey or saved route before live pilot operations.",
      "/ops/journey"
    ),
    check(
      "Nava Eye readiness",
      "Enabled intelligence context",
      input.assetSummary.enabled_intelligence_count > 0 ? "pass" : "fail",
      input.assetSummary.enabled_intelligence_count > 0
        ? "Nava Eye has enabled assets it can safely reason about."
        : "Nava Eye cannot investigate disabled or unreviewed assets.",
      "Enable reviewed assets before testing Nava Eye.",
      `/admin/assets?companyId=${companyId}`
    ),
    optionalCountCheck(
      "Nava Eye readiness",
      "Company AI settings",
      input.aiSettings,
      "AI settings record",
      "Configure company AI settings if Nava Eye should use provider-backed answers.",
      "/nava-eye"
    ),
    optionalCountCheck(
      "Nava Eye readiness",
      "Nava Eye memory",
      input.memory,
      "memory record",
      "Memory is optional, but recurring facts improve follow-up answers.",
      "/nava-eye"
    ),
  ];
}

function check(
  category: string,
  label: string,
  status: CheckStatus,
  explanation: string,
  suggestedNextAction: string,
  route?: string | null,
  routeNote?: string | null
): ReadinessCheck {
  return {
    category,
    status,
    label,
    explanation,
    suggested_next_action: suggestedNextAction,
    route: route || null,
    route_note: routeNote || null,
  };
}

function buildActionPanel(checks: ReadinessCheck[]) {
  return checks
    .filter((item) => item.status !== "pass")
    .map((item) => ({
      label: actionLabel(item),
      reason: item.explanation,
      category: item.category,
      severity: item.status === "fail" ? "fail" : "warning",
      route: item.route || null,
      route_note: item.route_note || fallbackRouteNote(item),
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function actionLabel(check: ReadinessCheck) {
  if (check.category === "Role/security readiness") return check.suggested_next_action;
  return check.suggested_next_action || check.label;
}

function fallbackRouteNote(check: ReadinessCheck) {
  if (check.category === "Asset review" && check.route?.startsWith("/admin/assets")) {
    return "Opens Asset Review in this tenant context for platform owners.";
  }

  if (check.category === "Provider setup" && check.route?.startsWith("/admin/providers")) {
    return "Opens Provider Vault in this tenant context for platform owners.";
  }

  if (check.category === "Company setup" && check.route?.startsWith("/admin/company")) {
    return "Opens Company Settings in this tenant context for platform owners.";
  }

  if (check.category === "Role/security readiness") {
    return "No direct mutation exists here yet. Use the normal company membership/admin process.";
  }

  return null;
}

function severityRank(severity: string) {
  return severity === "fail" ? 0 : 1;
}

function optionalCountCheck(
  category: string,
  label: string,
  value: ReturnType<typeof countOptionalRows>,
  noun: string,
  suggestedNextAction: string,
  route?: string | null
) {
  if (!value.available) {
    return check(
      category,
      label,
      "warning",
      value.setup_message || `${label} cannot be checked yet.`,
      "Apply or verify the optional table before relying on this check.",
      route
    );
  }

  return check(
    category,
    label,
    value.count > 0 ? "pass" : "warning",
    value.count > 0
      ? `${value.count} ${noun}${value.count === 1 ? "" : "s"} found.`
      : `No ${noun}s found yet.`,
    suggestedNextAction,
    route
  );
}

function countMembersByRole(members: any[]) {
  return members.reduce((counts: Record<string, number>, member) => {
    const role = String(member.role || "unknown").trim().toLowerCase() || "unknown";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

function summarizeChecks(checks: ReadinessCheck[]) {
  return checks.reduce(
    (counts, item) => ({
      pass: counts.pass + (item.status === "pass" ? 1 : 0),
      warning: counts.warning + (item.status === "warning" ? 1 : 0),
      fail: counts.fail + (item.status === "fail" ? 1 : 0),
    }),
    { pass: 0, warning: 0, fail: 0 }
  );
}

function overallReadiness(counts: { pass: number; warning: number; fail: number }) {
  if (counts.fail > 0) {
    return {
      status: "blocked",
      label: "Blocked",
      explanation: "One or more failed checks block pilot/go-live readiness.",
    };
  }

  if (counts.warning > 0) {
    return {
      status: "needs_attention",
      label: "Needs attention",
      explanation: "No blockers, but warnings should be reviewed before pilot.",
    };
  }

  return {
    status: "ready",
    label: "Ready",
    explanation: "All pilot readiness checks are passing.",
  };
}

function summarizeReadinessList(tenants: any[]) {
  return tenants.reduce(
    (summary, tenant) => ({
      tenant_count: summary.tenant_count + 1,
      ready: summary.ready + (tenant.overall_readiness.status === "ready" ? 1 : 0),
      needs_attention:
        summary.needs_attention +
        (tenant.overall_readiness.status === "needs_attention" ? 1 : 0),
      blocked:
        summary.blocked +
        (tenant.overall_readiness.status === "blocked" ? 1 : 0),
      pass: summary.pass + tenant.check_counts.pass,
      warning: summary.warning + tenant.check_counts.warning,
      fail: summary.fail + tenant.check_counts.fail,
    }),
    {
      tenant_count: 0,
      ready: 0,
      needs_attention: 0,
      blocked: 0,
      pass: 0,
      warning: 0,
      fail: 0,
    }
  );
}

function latestDate(values: Array<string | null | undefined>) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates)).toISOString();
}

function nonEmptyList(value: any) {
  return Array.isArray(value) && value.length > 0;
}
