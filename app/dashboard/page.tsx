"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";
import { isPlatformOperatorCompany } from "../../lib/companyType";

interface OverviewData {
  success: boolean;
  error?: string;
  dashboard_mode?: "fleet" | "platform_operator";
  company?: any;
  fleet_health?: any;
  asset_review_summary?: any;
  platform_operator_summary?: PlatformOperatorSummary;
  capabilities?: DashboardRoleCapabilities;
  active_memories?: any[];
  trucks_in_uganda?: any[];
}

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
  company_type?: string | null;
}

interface MembershipOption {
  company_id: string;
  role: string;
  is_active?: boolean;
}

function getExplicitDashboardCompanyId(companies: CompanyOption[]) {
  if (typeof window === "undefined") return "";

  const requestedCompanyId = new URLSearchParams(window.location.search).get(
    "companyId"
  );

  if (
    requestedCompanyId &&
    companies.some((company) => company.id === requestedCompanyId)
  ) {
    return requestedCompanyId;
  }

  return "";
}

function chooseDefaultDashboardCompanyId(
  companies: CompanyOption[],
  platformOwner: boolean
) {
  if (!companies.length) return "";

  const explicitCompanyId = getExplicitDashboardCompanyId(companies);
  if (explicitCompanyId) return explicitCompanyId;

  if (platformOwner) {
    const operatorCompany = companies.find(isPlatformOperatorCompany);
    if (operatorCompany?.id) return operatorCompany.id;
  }

  return companies[0]?.id || "";
}

const platformDashboardLinks = [
  { label: "Admin Hub", href: "/admin" },
  { label: "Tenant Billing", href: "/admin/tenants" },
  { label: "Readiness", href: "/admin/pilot-readiness" },
  { label: "Platform Health", href: "/admin/health" },
  { label: "Provider Requests", href: "/admin/provider-requests" },
  { label: "Provider Vault", href: "/admin/providers" },
];

interface WatchItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  evidence: string[];
  suggested_next_check: string;
  suggested_question?: string;
  href?: string;
}

interface CommandActionItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  count: string;
  implication: string;
  href: string;
  actionLabel: string;
  suggestedQuestion?: string;
}

interface ReviewQueueItem {
  id: string;
  title: string;
  value: string;
  body: string;
  href: string;
  show: boolean;
  restricted?: boolean;
}

type TenantWorkspaceSummary = {
  company: {
    id: string;
    name: string;
    slug: string;
  };
  readiness_status: string;
  strict_billable_asset_count: number;
  provider_count: number;
  active_provider_count: number;
};

type DashboardRoleCapabilities = {
  canViewFinance: boolean;
  canEditFinance: boolean;
  canViewExpenses: boolean;
  canViewBilling: boolean;
  canViewPlatformBilling: boolean;
  canViewOps: boolean;
  canViewFuel: boolean;
  canViewJourneys: boolean;
  canViewSpares: boolean;
  isPlatformOwner: boolean;
  canReviewAssets: boolean;
};

type PlatformOperatorSummary = {
  tenant_count: number;
  strict_billable_asset_count: number;
  estimated_monthly_revenue_by_currency: Record<string, number>;
  tenants_missing_pricing: number;
  readiness: {
    ready: number;
    needs_attention: number;
    blocked: number;
  } | null;
  readiness_unavailable_reason?: string | null;
  tenant_workspaces?: TenantWorkspaceSummary[];
  operator_company_detection?: {
    method: string;
    matched_key: string;
  };
};

const platformActionGroups = [
  {
    title: "Platform Operations",
    body: "Keep the product, providers, and platform foundation healthy.",
    items: [
      {
        label: "Platform Health",
        href: "/admin/health",
        description:
          "Check environment, schema, billing, provider, and go-live readiness.",
      },
      {
        label: "Provider Requests",
        href: "/admin/provider-requests",
        description:
          "Triage assisted onboarding requests and provider setup work.",
      },
      {
        label: "Provider Vault",
        href: "/admin/providers",
        description:
          "Inspect provider connections, tests, and enrichment diagnostics safely.",
      },
    ],
  },
  {
    title: "Tenant Operations",
    body: "Move customer workspaces toward readiness and billing clarity.",
    items: [
      {
        label: "Tenant Billing",
        href: "/admin/tenants",
        description:
          "Review strict billable assets, pricing setup, and tenant billing previews.",
      },
      {
        label: "Readiness",
        href: "/admin/pilot-readiness",
        description:
          "See which tenants are ready, blocked, or need setup attention.",
      },
      {
        label: "Customer Dashboards",
        href: "#customer-workspaces",
        description:
          "Open customer fleet workspaces from the tenant cards below.",
      },
    ],
  },
  {
    title: "Product Intelligence",
    body: "Use Nava Strat itself to inspect operational questions.",
    items: [
      {
        label: "Nava Eye",
        href: "/nava-eye",
        description:
          "Ask cross-domain fleet questions inside your current permission boundary.",
      },
    ],
  },
];

function buildWatchItems(
  overview: OverviewData | null,
  capabilities: DashboardRoleCapabilities,
  adminCompanyId: string
): WatchItem[] {
  const fleetHealth = overview?.fleet_health || {};
  const assetReview = overview?.asset_review_summary || {};
  const items: WatchItem[] = [];
  const idleTrucks = fleetHealth.highest_idle_trucks || [];
  const highIdleDurations = idleTrucks.filter((truck: any) => {
    const hours = parseWatchNumber(truck.idle_hours);
    return hours !== null && hours > 24;
  });
  const extremeIdleDurations = highIdleDurations.filter(
    (truck: any) => {
      const hours = parseWatchNumber(truck.idle_hours);
      return hours !== null && hours > 168;
    }
  );
  const stationaryIdleTrucks = idleTrucks.filter(isFreshStationaryIdleTruck);
  const offlineTruckIds = (fleetHealth.offline_truck_ids || []).filter(Boolean);
  const recentCriticalEvents = fleetHealth.recent_critical_events || [];
  const fuelSummary = fleetHealth.fuel_telemetry_summary || {};
  const importedAssets = Number(assetReview.imported_assets || 0);
  const enabledAssets = Number(assetReview.enabled_assets || 0);
  const unreviewedAssets = Number(assetReview.unreviewed_assets || 0);

  if (capabilities.canViewOps && highIdleDurations.length) {
    const trucks = highIdleDurations.slice(0, 3);
    items.push({
      id: "idle-duration-quality",
      severity: extremeIdleDurations.length ? "critical" : "warning",
      title: "Provider idle-marker duration looks suspicious",
      summary:
        "One or more provider idle-marker spans need review before treating duration fields as operational time. Provider duration fields may be cumulative or repeated.",
      evidence: trucks.map(
        (truck: any) => `${truck.truck_id}: ${formatWatchNumber(truck.idle_hours)} hours observed marker span`
      ),
      suggested_next_check:
        "Investigate whether provider idle-marker events are closing correctly before using any provider duration field as a continuous-duration fact.",
      suggested_question:
        "Check whether the top provider idle-marker trucks have an event-closure or data-quality problem.",
      href: "/nava-eye",
    });
  }

  if (capabilities.canViewOps && stationaryIdleTrucks.length) {
    const trucks = stationaryIdleTrucks.slice(0, 3);
    items.push({
      id: "current-stationary-idle",
      severity: "warning",
      title: "Top provider idle-marker trucks appear stationary",
      summary:
        "These trucks have fresh low-speed telemetry and recent provider idle markers. Nava can interpret that as current stationary/provider-marker evidence, without claiming engine-on idling.",
      evidence: trucks.map(
        (truck: any) =>
          `${truck.truck_id}: speed ${formatWatchNumber(truck.latest_speed)}, ${formatFreshness(
            truck.freshness_minutes
          )}, latest provider marker ${formatRelativeTime(truck.latest_idle_event_at)}`
      ),
      suggested_next_check:
        "Check active trips, geofences, driver assignment, and provider freshness for the same trucks.",
      suggested_question:
        "Are the top provider idle-marker trucks still stopped, and what context explains the stop?",
      href: "/tracking/live",
    });
  }

  if (capabilities.canViewOps && offlineTruckIds.length) {
    items.push({
      id: "stale-offline-assets",
      severity: offlineTruckIds.length >= 3 ? "warning" : "info",
      title: "Some enabled assets are stale or offline",
      summary:
        "Enabled intelligence assets are missing fresh location updates, so live status may be incomplete.",
      evidence: [
        `${fleetHealth.offline_trucks || offlineTruckIds.length} offline or stale enabled asset(s)`,
        `Examples: ${offlineTruckIds.slice(0, 4).join(", ")}`,
      ],
      suggested_next_check:
        "Check provider sync freshness and whether the affected trucks are expected to be reporting now.",
      suggested_question:
        "Which enabled trucks are stale or offline, and what should I check next?",
      href: "/tracking/live",
    });
  }

  if (
    Number(fuelSummary.enabled_assets_checked || 0) > 0 &&
    Number(fuelSummary.enabled_assets_with_usable_fuel || 0) === 0 &&
    Number(fuelSummary.enabled_assets_with_recent_fuel_scores || 0) === 0 &&
    capabilities.canViewFuel
  ) {
    const recentReadings = Number(fuelSummary.recent_readings || 0);
    items.push({
      id: "fuel-telemetry-limited",
      severity: "info",
      title: "Fuel telemetry is limited",
      summary:
        "Nava does not currently see usable recent fuel-level telemetry across enabled assets. Manual fuel logs and provider diagnostics can still support investigation.",
      evidence: [
        `${fuelSummary.enabled_assets_checked} enabled asset(s) checked`,
        recentReadings
          ? `${recentReadings} recent fuel reading(s), but none were usable positive values`
          : "No recent fuel readings found",
        "No recent enabled-asset fuel risk scores found",
      ],
      suggested_next_check:
        "Review provider enrichment diagnostics and compare manual fuel logs until the fuel feed is usable.",
      suggested_question:
        "Which enabled trucks have usable fuel telemetry, and what can Nava use while fuel data is limited?",
      href: capabilities.canReviewAssets
        ? withCompanyContext("/admin/providers", adminCompanyId)
        : "/fuel",
    });
  }

  if (
    capabilities.canReviewAssets &&
    (importedAssets > enabledAssets || unreviewedAssets > 0)
  ) {
    items.push({
      id: "unreviewed-imported-assets",
      severity: enabledAssets === 0 && importedAssets > 0 ? "warning" : "info",
      title: "Imported assets are waiting for review",
      summary:
        "Some imported assets are not enabled for Nava intelligence yet, so Nava Eye and Live Tracking will not use them.",
      evidence: [
        `${importedAssets} imported asset(s)`,
        `${enabledAssets} enabled intelligence asset(s)`,
        `${unreviewedAssets} unreviewed asset(s)`,
      ],
      suggested_next_check:
        "Review imported assets before expecting them in live tracking, alerts, or Nava Eye answers.",
      suggested_question:
        "Which imported assets are waiting for review before Nava Eye can use them?",
      href: withCompanyContext("/admin/assets", adminCompanyId),
    });
  }

  if (capabilities.canViewOps && recentCriticalEvents.length) {
    const events = recentCriticalEvents.slice(0, 3);
    items.push({
      id: "recent-critical-events",
      severity: "critical",
      title: "Recent critical events need context",
      summary:
        "High-severity events are present in the current dashboard data. Nava can help separate operational context from true risk.",
      evidence: events.map(
        (event: any) =>
          `${event.truck_id}: ${formatWatchLabel(event.event_type)} ${formatRelativeTime(event.created_at)}`
      ),
      suggested_next_check:
        "Check whether these events line up with trips, geofences, driver assignment, or shared disruption context.",
      suggested_question:
        "Explain the recent critical events and what context might matter.",
      href: "/ops/dashboard",
    });
  }

  return items
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 5);
}

function isFreshStationaryIdleTruck(truck: any) {
  const speed = parseWatchNumber(truck.latest_speed);
  const freshness = parseWatchNumber(truck.freshness_minutes);
  const idleAgeMinutes = minutesSince(truck.latest_idle_event_at);

  return (
    speed !== null &&
    speed <= 2 &&
    freshness !== null &&
    freshness <= 30 &&
    idleAgeMinutes !== null &&
    idleAgeMinutes <= 120
  );
}

function parseWatchNumber(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesSince(value: any) {
  if (!value) return null;
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  return Number.isFinite(minutes) ? minutes : null;
}

function formatFreshness(value: any) {
  const minutes = parseWatchNumber(value);
  if (minutes === null) return "freshness unknown";
  if (minutes < 1) return "just now";
  return `${minutes} min old`;
}

function formatRelativeTime(value: any) {
  const minutes = minutesSince(value);
  if (minutes === null) return "unknown";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours}h ago`;
}

function formatWatchNumber(value: any) {
  const number = parseWatchNumber(value);
  if (number === null) return "unknown";
  return number.toLocaleString();
}

function formatWatchLabel(value: any) {
  return String(value || "event")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function severityRank(severity: WatchItem["severity"]) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function severityClasses(severity: WatchItem["severity"]) {
  if (severity === "critical") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (severity === "warning") return "border-yellow-500/40 bg-yellow-500/10 text-yellow-200";
  return "border-blue-500/40 bg-blue-500/10 text-blue-200";
}

function actionCardClasses(severity: CommandActionItem["severity"]) {
  if (severity === "critical") {
    return "border-rose-300/35 bg-rose-500/10";
  }
  if (severity === "warning") {
    return "border-amber-300/35 bg-amber-400/10";
  }
  return "border-cyan-300/25 bg-cyan-300/10";
}

function buildCommandActions(
  overview: OverviewData | null,
  capabilities: DashboardRoleCapabilities,
  adminCompanyId: string
): CommandActionItem[] {
  const fleetHealth = overview?.fleet_health || {};
  const assetReview = overview?.asset_review_summary || {};
  const fuelSummary = fleetHealth.fuel_telemetry_summary || {};
  const actions: CommandActionItem[] = [];
  const offlineCount = Number(fleetHealth.offline_trucks || 0);
  const criticalCount = Number(fleetHealth.critical_events_24h || 0);
  const idleMarkerCount = Number(fleetHealth.idle_events_24h || 0);
  const unreviewedAssets = Number(assetReview.unreviewed_assets || 0);
  const enabledAssets = Number(assetReview.enabled_assets || 0);
  const importedAssets = Number(assetReview.imported_assets || 0);

  if (capabilities.canViewOps && offlineCount > 0) {
    actions.push({
      id: "tracking-freshness",
      severity: offlineCount >= 5 ? "critical" : "warning",
      title: "Tracking freshness",
      count: `${offlineCount.toLocaleString()} stale/offline`,
      implication:
        "Live status is incomplete until provider sync or device reporting is checked.",
      href: "/tracking/live",
      actionLabel: "Open Live Tracking",
      suggestedQuestion:
        "Which enabled assets are stale or offline, and what should I check first?",
    });
  }

  if (capabilities.canViewOps && criticalCount > 0) {
    actions.push({
      id: "critical-events",
      severity: "critical",
      title: "Operational events",
      count: `${criticalCount.toLocaleString()} high-severity`,
      implication:
        "Review the affected trucks and add operational context before escalating.",
      href: "/ops/dashboard",
      actionLabel: "Review events",
      suggestedQuestion:
        "Explain today's high-severity tracker events and what context matters.",
    });
  }

  if (capabilities.canViewOps && idleMarkerCount > 0) {
    actions.push({
      id: "tracker-idle-markers",
      severity: "warning",
      title: "Tracker idle markers",
      count: `${idleMarkerCount.toLocaleString()} marker(s)`,
      implication:
        "Treat these as provider evidence to review, not engine-on idle or fuel-burn proof.",
      href: "/ops/efficiency",
      actionLabel: "Open Ops Intelligence",
      suggestedQuestion:
        "Which trucks have tracker idle markers today, and what should I review?",
    });
  }

  if (capabilities.canReviewAssets && (unreviewedAssets > 0 || enabledAssets === 0)) {
    actions.push({
      id: "provider-readiness",
      severity: enabledAssets === 0 && importedAssets > 0 ? "warning" : "info",
      title: "Provider readiness",
      count:
        unreviewedAssets > 0
          ? `${unreviewedAssets.toLocaleString()} awaiting review`
          : "Review enabled assets",
      implication:
        "Unreviewed provider assets stay out of Live Tracking and Nava Eye answers.",
      href: withCompanyContext("/admin/assets", adminCompanyId),
      actionLabel: "Open Asset Review",
      suggestedQuestion:
        "Which provider assets are waiting for review before Nava can use them?",
    });
  }

  if (
    capabilities.canViewFuel &&
    Number(fuelSummary.enabled_assets_checked || 0) > 0 &&
    Number(fuelSummary.enabled_assets_with_usable_fuel || 0) === 0
  ) {
    actions.push({
      id: "fuel-evidence",
      severity: "info",
      title: "Fuel evidence",
      count: "Fuel feed limited",
      implication:
        "Use manual fuel records and provider diagnostics until usable fuel telemetry is available.",
      href: capabilities.canReviewAssets
        ? withCompanyContext("/admin/providers", adminCompanyId)
        : "/fuel",
      actionLabel: capabilities.canReviewAssets ? "Open Provider Vault" : "Open Fuel",
      suggestedQuestion:
        "Which enabled trucks have usable fuel evidence, and what is missing?",
    });
  }

  if (capabilities.canViewFinance) {
    actions.push({
      id: "revenue-review",
      severity: "info",
      title: "Revenue review",
      count: "Finance queue",
      implication:
        "Review Trips against configured client rates before relying on contribution intelligence.",
      href: "/finance/revenue",
      actionLabel: "Open Revenue Review",
      suggestedQuestion: "Which trips need revenue review today?",
    });
  }

  if (!actions.length) {
    actions.push({
      id: "steady-state",
      severity: "info",
      title: "No urgent blocker",
      count: "Ready for review",
      implication:
        "No high-priority dashboard blockers are visible from the current role-safe summary.",
      href: "/nava-eye",
      actionLabel: "Ask Nava Eye",
      suggestedQuestion: "What should I act on today?",
    });
  }

  return actions
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 5);
}

function buildReviewQueues(
  overview: OverviewData | null,
  capabilities: DashboardRoleCapabilities,
  adminCompanyId: string
): ReviewQueueItem[] {
  const fleetHealth = overview?.fleet_health || {};
  const assetReview = overview?.asset_review_summary || {};
  const offlineCount = Number(fleetHealth.offline_trucks || 0);
  const criticalCount = Number(fleetHealth.critical_events_24h || 0);
  const unreviewedAssets = Number(assetReview.unreviewed_assets || 0);

  return [
    {
      id: "tracking",
      title: "Tracking issues",
      value: `${offlineCount.toLocaleString()} stale/offline`,
      body: "Check freshness, live status, and readable operational locations.",
      href: "/tracking/live",
      show: capabilities.canViewOps,
    },
    {
      id: "ops",
      title: "Trip operations",
      value: `${criticalCount.toLocaleString()} event(s)`,
      body: "Review high-severity tracker events and add operational context.",
      href: "/ops/dashboard",
      show: capabilities.canViewOps,
    },
    {
      id: "intelligence",
      title: "Ops Intelligence",
      value: "Movement review",
      body: "Review distance evidence, stopped-time, tracker markers, and trip readiness.",
      href: "/ops/efficiency",
      show: capabilities.canViewOps,
    },
    {
      id: "revenue",
      title: "Revenue Review",
      value: capabilities.canViewFinance ? "Finance queue" : "Restricted",
      body: capabilities.canViewFinance
        ? "Match Trips to client rates and apply auditable revenue entries."
        : "Finance details are restricted to finance and management roles.",
      href: capabilities.canViewFinance ? "/finance/revenue" : "/dashboard",
      show: true,
      restricted: !capabilities.canViewFinance,
    },
    {
      id: "management",
      title: "Management intelligence",
      value: capabilities.canViewFinance ? "Contribution velocity" : "Restricted",
      body: capabilities.canViewFinance
        ? "Review contribution velocity, blocked reviews, and operational drag."
        : "Management finance intelligence is not visible for this role.",
      href: capabilities.canViewFinance ? "/management/dashboard" : "/dashboard",
      show: true,
      restricted: !capabilities.canViewFinance,
    },
    {
      id: "provider",
      title: "Provider readiness",
      value:
        unreviewedAssets > 0
          ? `${unreviewedAssets.toLocaleString()} awaiting review`
          : "Review status",
      body: "Review provider connection health, asset matching, and signal capability.",
      href: withCompanyContext("/admin/providers", adminCompanyId),
      show: capabilities.canReviewAssets,
    },
  ].filter((item) => item.show);
}

function buildCommandLinks(
  capabilities: DashboardRoleCapabilities,
  adminCompanyId: string
) {
  return [
    { label: "Live Tracking", href: "/tracking/live", show: capabilities.canViewOps },
    { label: "Trips", href: "/ops/journey", show: capabilities.canViewJourneys },
    { label: "Ops Intelligence", href: "/ops/efficiency", show: capabilities.canViewOps },
    { label: "Revenue Review", href: "/finance/revenue", show: capabilities.canViewFinance },
    {
      label: "Provider Vault",
      href: withCompanyContext("/admin/providers", adminCompanyId),
      show: capabilities.canReviewAssets,
    },
    { label: "Nava Eye", href: "/nava-eye", show: true },
  ].filter((item) => item.show);
}

function groupCriticalEvents(events: any[]) {
  const groups = new Map<string, { type: string; count: number; trucks: Set<string>; latest: string | null }>();

  for (const event of events || []) {
    const type = String(event.event_type || "tracker event");
    const current = groups.get(type) || {
      type,
      count: 0,
      trucks: new Set<string>(),
      latest: null,
    };
    current.count += 1;
    if (event.truck_id) current.trucks.add(event.truck_id);
    if (
      event.created_at &&
      (!current.latest ||
        new Date(event.created_at).getTime() > new Date(current.latest).getTime())
    ) {
      current.latest = event.created_at;
    }
    groups.set(type, current);
  }

  return Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency || "KES",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatRevenueTotals(totals: Record<string, number> | undefined) {
  const entries = Object.entries(totals || {}).filter(([, value]) => {
    const numericValue = Number(value || 0);
    return Number.isFinite(numericValue) && numericValue > 0;
  });

  if (!entries.length) return "Pricing not set";

  return entries
    .map(([currency, value]) => formatMoney(Number(value || 0), currency))
    .join(", ");
}

function maybeHideMetric(value: string | number, hidden: boolean) {
  return hidden ? "••••" : value;
}

function readinessLabel(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ready") return "Ready";
  if (normalized === "blocked") return "Blocked";
  if (normalized === "needs_attention") return "Needs attention";
  return "Review";
}

function readinessClasses(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ready") {
    return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  }
  if (normalized === "blocked") {
    return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  }
  if (normalized === "needs_attention") {
    return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

function withCompanyContext(path: string, companyId: string) {
  if (!companyId) return path;
  return `${path}?companyId=${encodeURIComponent(companyId)}`;
}

function rolesForDashboardCompany(memberships: MembershipOption[], companyId: string | null) {
  if (!companyId) return [];

  return memberships
    .filter((membership) => membership.company_id === companyId)
    .map((membership) => membership.role)
    .filter(Boolean);
}

function buildDashboardRoleCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = roles.map((role) => String(role || "").trim().toLowerCase());
  const hasRole = (allowed: string[]) =>
    isPlatformOwner || allowed.some((role) => normalizedRoles.includes(role));
  const elevated = hasRole(["owner", "admin"]);

  return {
    canViewFinance: elevated || hasRole(["finance", "management"]),
    canEditFinance: elevated || hasRole(["finance"]),
    canViewExpenses: elevated || hasRole(["finance", "management"]),
    canViewBilling: elevated || hasRole(["finance", "management"]),
    canViewPlatformBilling: isPlatformOwner,
    canViewOps: elevated || hasRole(["ops", "management"]),
    canViewFuel: elevated || hasRole(["ops", "finance", "management"]),
    canViewJourneys: elevated || hasRole(["ops", "management", "finance"]),
    canViewSpares: elevated || hasRole(["ops", "finance", "management"]),
    isPlatformOwner,
    canReviewAssets: elevated,
  };
}

function BriefMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  const toneClasses =
    tone === "good"
      ? "text-emerald-200"
      : tone === "warn"
        ? "text-amber-200"
        : tone === "danger"
          ? "text-rose-200"
          : "text-white";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className={`text-lg font-semibold ${toneClasses}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [memberships, setMemberships] = useState<MembershipOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [companySwitcherOpen, setCompanySwitcherOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [copilotQuery, setCopilotQuery] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [sensitiveMetricsHidden, setSensitiveMetricsHidden] = useState(false);
  const router = useRouter();

  function buildDashboardCopilotContext() {
    const fleetHealth = data?.fleet_health || {};
    const activeCompanyId = selectedCompanyId || data?.company?.id || null;
    const capabilities = data?.capabilities ||
      buildDashboardRoleCapabilities(
        rolesForDashboardCompany(memberships, activeCompanyId),
        isPlatformOwner
      );
    const canSendOpsDashboardContext = Boolean(capabilities.canViewOps);

    return {
      page: "dashboard",
      active_company_id: activeCompanyId,
      capabilities: {
        canViewFinance: capabilities.canViewFinance,
        canViewExpenses: capabilities.canViewExpenses,
        canViewBilling: capabilities.canViewBilling,
        canViewPlatformBilling: capabilities.canViewPlatformBilling,
        canViewOps: capabilities.canViewOps,
        canViewFuel: capabilities.canViewFuel,
        canViewJourneys: capabilities.canViewJourneys,
        canViewSpares: capabilities.canViewSpares,
        isPlatformOwner: capabilities.isPlatformOwner,
      },
      highest_idle_trucks: canSendOpsDashboardContext
        ? (fleetHealth.highest_idle_trucks || []).slice(0, 5).map((truck: any) => ({
            truck_id: truck.truck_id,
            idle_minutes: truck.idle_minutes ?? null,
            idle_hours: truck.idle_hours ?? null,
          }))
        : [],
      highest_risk_trucks: canSendOpsDashboardContext
        ? (fleetHealth.highest_risk_trucks || []).slice(0, 5).map((truck: any) => ({
            truck_id: truck.truck_id,
            event_count: truck.event_count ?? null,
          }))
        : [],
      recent_critical_events: canSendOpsDashboardContext
        ? (fleetHealth.recent_critical_events || []).slice(0, 5).map((event: any) => ({
            truck_id: event.truck_id,
            event_type: event.event_type,
            severity: event.severity,
            location_name: event.location_name || null,
            created_at: event.created_at || null,
          }))
        : [],
    };
  }

  async function loadOverview(token: string, companyId: string, platformOwner: boolean) {
    const overviewUrl =
      platformOwner && companyId
        ? `/api/dashboard/overview?companyId=${encodeURIComponent(companyId)}`
        : "/api/dashboard/overview";

    const res = await fetch(overviewUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();
    if (json.success) {
      setData(json);
      setErrorDetail(null);
    } else {
      setErrorDetail(json.error || "Unknown error");
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          router.push("/login");
          return;
        }
        const token = sessionData.session.access_token;
        const companiesRes = await fetch("/api/companies", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const companiesJson = await companiesRes.json();
        if (companiesJson.success) {
          const nextCompanies = companiesJson.companies || [];
          const nextIsPlatformOwner = Boolean(companiesJson.is_platform_owner);
          const nextSelectedCompanyId = chooseDefaultDashboardCompanyId(
            nextCompanies,
            nextIsPlatformOwner
          );
          const nextMemberships = (companiesJson.memberships || []).map(
            (membership: any) => ({
              company_id: String(membership.company_id || ""),
              role: String(membership.role || "").trim().toLowerCase(),
              is_active: membership.is_active !== false,
            })
          );

          setCompanies(nextCompanies);
          setIsPlatformOwner(nextIsPlatformOwner);
          setMemberships(nextMemberships);
          setSelectedCompanyId(nextSelectedCompanyId);

          await loadOverview(token, nextSelectedCompanyId, nextIsPlatformOwner);
        } else {
          setErrorDetail(companiesJson.error || "Unknown error");
        }
      } catch (err: any) {
        console.error("Fetch error:", err);
        setErrorDetail(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const handleCompanyChange = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }
      await loadOverview(token, companyId, isPlatformOwner);
    } catch (err: any) {
      console.error("Fetch error:", err);
      setErrorDetail(err.message);
    } finally {
      setLoading(false);
    }
  };

  const askCopilot = async (questionOverride?: string) => {
    const question = String(questionOverride || copilotQuery || "").trim();
    if (!question) return;
    setCopilotQuery(question);
    setCopilotLoading(true);
    setCopilotAnswer("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/login");
        return;
      }

      const res = await fetch("/api/nava-eye/copilot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question,
          dashboard_context: buildDashboardCopilotContext(),
          ...(isPlatformOwner && selectedCompanyId
            ? { companyId: selectedCompanyId }
            : {}),
        }),
      });
      const json = await res.json();
      setCopilotAnswer(json.answer || "No answer");
    } catch {
      setCopilotAnswer("Nava Eye could not answer right now.");
    } finally {
      setCopilotLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Loading dashboard...</div>;
  if (errorDetail) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8">
        <h1 className="text-xl text-red-500">Dashboard Error</h1>
        <pre className="mt-4 text-sm">{errorDetail}</pre>
        <p className="mt-4">Please refresh or contact support if this continues.</p>
      </div>
    );
  }
  if (!data || !data.success) return <div className="min-h-screen bg-slate-950 text-white p-8">Unable to load dashboard.</div>;

  const fh = data.fleet_health || {};
  const company = data.company!;
  const memories = data.active_memories || [];
  const showCompanySelector = isPlatformOwner || companies.length > 1;
  const selectedCompany =
    companies.find((companyOption) => companyOption.id === selectedCompanyId) ||
    company;
  const roleCapabilities =
    data.capabilities ||
    buildDashboardRoleCapabilities(
      rolesForDashboardCompany(memberships, selectedCompanyId || company.id),
      isPlatformOwner
    );
  const isPlatformWorkspace =
    data.dashboard_mode === "platform_operator" && roleCapabilities.isPlatformOwner;
  const adminCompanyId = isPlatformOwner ? selectedCompanyId || company.id : "";
  const watchItems = isPlatformWorkspace
    ? []
    : buildWatchItems(data, roleCapabilities, adminCompanyId);
  const commandActions = isPlatformWorkspace
    ? []
    : buildCommandActions(data, roleCapabilities, adminCompanyId);
  const reviewQueues = isPlatformWorkspace
    ? []
    : buildReviewQueues(data, roleCapabilities, adminCompanyId);
  const commandLinks = isPlatformWorkspace
    ? platformDashboardLinks
    : buildCommandLinks(roleCapabilities, adminCompanyId);
  const criticalEventGroups = groupCriticalEvents(fh.recent_critical_events || []);
  const refreshedAtLabel = new Intl.DateTimeFormat("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  }).format(new Date());
  const platformSummary = data.platform_operator_summary;
  const tenantWorkspaces = platformSummary?.tenant_workspaces || [];
  const normalizedCompanySearch = companySearch.toLowerCase();
  const filteredCompanies = companies.filter(
    (companyOption) =>
      companyOption.name.toLowerCase().includes(normalizedCompanySearch) ||
      companyOption.slug.toLowerCase().includes(normalizedCompanySearch)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-8 py-5 flex justify-between items-center sticky top-0 bg-slate-950/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-full animate-pulse" />
          <h1 className="text-2xl font-bold tracking-tight">
            {isPlatformWorkspace ? "Platform Workspace" : "Command Brief"}
          </h1>
          {showCompanySelector ? (
            <div className="relative ml-2">
              <button
                type="button"
                onClick={() => {
                  setCompanySwitcherOpen((open) => !open);
                  setCompanySearch("");
                }}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-sm text-slate-200 shadow-sm hover:border-slate-600 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <span className="max-w-48 truncate font-medium">
                  {selectedCompany.name}
                </span>
                {isPlatformOwner && (
                  <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                    Platform Owner
                  </span>
                )}
                <span className="text-slate-500">⌄</span>
              </button>

              {companySwitcherOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40">
                  <div className="border-b border-slate-800 p-2">
                    <input
                      autoFocus
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setCompanySwitcherOpen(false);
                          setCompanySearch("");
                        }
                      }}
                      placeholder="Search companies..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div className="max-h-72 overflow-y-auto p-1">
                    {filteredCompanies.length > 0 ? (
                      filteredCompanies.map((companyOption) => (
                        <button
                          key={companyOption.id}
                          type="button"
                          onClick={() => {
                            handleCompanyChange(companyOption.id);
                            setCompanySwitcherOpen(false);
                            setCompanySearch("");
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                            companyOption.id === selectedCompanyId
                              ? "bg-slate-800"
                              : ""
                          }`}
                        >
                          <div className="truncate text-sm font-medium text-slate-100">
                            {companyOption.name}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {companyOption.slug}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-6 text-center text-sm text-slate-500">
                        No companies found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-slate-500 text-sm ml-2">{company.name}</span>
          )}
        </div>
        <button
          onClick={() => supabase.auth.signOut().then(() => router.push("/login"))}
          className="text-slate-400 hover:text-white transition text-sm"
        >
          Sign Out
        </button>
      </header>

      <div className="flex">
        {isPlatformWorkspace && (
          <aside className="w-64 border-r border-slate-800 p-6 space-y-6">
            <nav className="space-y-2">
              <div className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Platform routes</div>
              {platformDashboardLinks.map((item) => (
                <Link
                  key={`${item.label}-${item.href}`}
                  href={item.href}
                  className="block text-slate-300 hover:text-white py-1"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
        )}

        <main className="flex-1 p-8">
          {isPlatformWorkspace ? (
            <div className="space-y-8">
              <section className="rounded-lg border border-white/10 bg-slate-900/50 p-6 shadow-2xl shadow-black/20">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="max-w-3xl">
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                      Platform HQ
                    </div>
                    <h2 className="mt-2 text-3xl font-semibold text-white">
                      Nava Bloom Co. platform workspace
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      Manage customer tenants, readiness, billing, provider
                      operations, and product health from one place.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSensitiveMetricsHidden((current) => !current)
                      }
                      className="rounded-md border border-slate-700 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                    >
                      {sensitiveMetricsHidden
                        ? "Show sensitive metrics"
                        : "Hide sensitive metrics"}
                    </button>
                    <Link
                      href="/admin"
                      className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                    >
                      Open Admin Hub
                    </Link>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                  <div className="text-3xl font-bold text-white">
                    {platformSummary?.tenant_count ?? 0}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">Customer tenants</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                  <div className="text-3xl font-bold text-emerald-300">
                    {maybeHideMetric(
                      platformSummary?.strict_billable_asset_count ?? 0,
                      sensitiveMetricsHidden
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">Strict billable assets</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                  <div className="text-2xl font-bold text-blue-200">
                    {maybeHideMetric(
                      formatRevenueTotals(
                        platformSummary?.estimated_monthly_revenue_by_currency
                      ),
                      sensitiveMetricsHidden
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">Estimated monthly</div>
                  {Number(platformSummary?.tenants_missing_pricing || 0) > 0 && (
                    <div className="mt-2 text-xs text-yellow-300">
                      {platformSummary?.tenants_missing_pricing} tenant(s) missing pricing
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                  <div className="text-3xl font-bold text-yellow-300">
                    {maybeHideMetric(
                      platformSummary?.readiness
                        ? `${platformSummary.readiness.blocked}/${platformSummary.readiness.needs_attention}`
                        : "Review",
                      sensitiveMetricsHidden
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Blocked / needs attention
                  </div>
                  {platformSummary?.readiness_unavailable_reason && (
                    <div className="mt-2 text-xs text-slate-400">
                      Readiness summary unavailable
                    </div>
                  )}
                </div>
              </section>

              <section className="grid gap-5 xl:grid-cols-3">
                {platformActionGroups.map((group) => (
                  <div
                    key={group.title}
                    className="rounded-lg border border-slate-800 bg-slate-900/50 p-5"
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                      {group.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {group.body}
                    </p>
                    <div className="mt-5 grid gap-3">
                      {group.items.map((item) => (
                        <Link
                          key={`${group.title}-${item.href}`}
                          href={item.href}
                          className="group rounded-lg border border-white/10 bg-slate-950/40 p-4 transition hover:border-cyan-300/40 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-base font-semibold text-slate-100 group-hover:text-blue-200">
                                {item.label}
                              </div>
                              <div className="mt-2 text-sm leading-5 text-slate-500">
                                {item.description}
                              </div>
                            </div>
                            <span className="text-slate-500 group-hover:text-blue-300">
                              →
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </section>

              <section id="customer-workspaces" className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Customer workspaces
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Open a tenant fleet dashboard or readiness detail from the
                      platform workspace.
                    </p>
                  </div>
                </div>

                {tenantWorkspaces.length ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {tenantWorkspaces.map((workspace) => (
                      <div
                        key={workspace.company.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/50 p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-semibold text-white">
                              {workspace.company.name}
                            </h3>
                            <div className="mt-1 truncate text-xs text-slate-500">
                              {workspace.company.slug}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${readinessClasses(
                              workspace.readiness_status
                            )}`}
                          >
                            {readinessLabel(workspace.readiness_status)}
                          </span>
                        </div>

                        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
                            <div className="text-xs text-slate-500">
                              Strict billable
                            </div>
                            <div className="mt-1 font-semibold text-emerald-200">
                              {maybeHideMetric(
                                workspace.strict_billable_asset_count ?? 0,
                                sensitiveMetricsHidden
                              )}
                            </div>
                          </div>
                          <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
                            <div className="text-xs text-slate-500">
                              Active providers
                            </div>
                            <div className="mt-1 font-semibold text-blue-200">
                              {workspace.active_provider_count}/
                              {workspace.provider_count}
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-2">
                          <Link
                            href={`/dashboard?companyId=${encodeURIComponent(
                              workspace.company.id
                            )}`}
                            onClick={(event) => {
                              event.preventDefault();
                              window.history.pushState(
                                null,
                                "",
                                `/dashboard?companyId=${encodeURIComponent(
                                  workspace.company.id
                                )}`
                              );
                              handleCompanyChange(workspace.company.id);
                            }}
                            className="rounded-md border border-cyan-300/40 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                          >
                            Open Fleet Dashboard
                          </Link>
                          <Link
                            href={`/admin/pilot-readiness/${encodeURIComponent(
                              workspace.company.id
                            )}`}
                            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                          >
                            Open Readiness
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5 text-sm text-slate-400">
                    No customer tenant workspaces are available yet.
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-8">
              <section className="rounded-lg border border-cyan-200/20 bg-slate-900/70 p-6 shadow-2xl shadow-black/20">
                <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] xl:items-start">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                      Command brief
                    </div>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                      {company.name} operating brief
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
                      Action-first summary of today&apos;s tracking freshness,
                      operational events, review blockers, and the next pages to open.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-1.5">
                        Refreshed {refreshedAtLabel}
                      </span>
                      <span className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-1.5">
                        {Number(fh.online_trucks || 0).toLocaleString()} live now
                      </span>
                      <span className="rounded-md border border-white/10 bg-slate-950/50 px-3 py-1.5">
                        {Number(fh.offline_trucks || 0).toLocaleString()} stale/offline
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-slate-950/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">Ask Nava Eye</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Ask about the active brief or a specific truck.
                        </div>
                      </div>
                      <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                        Source-grounded
                      </span>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <input
                        value={copilotQuery}
                        onChange={(e) => setCopilotQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") askCopilot();
                        }}
                        placeholder="Ask what needs attention today..."
                        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => askCopilot()}
                        disabled={copilotLoading || !copilotQuery.trim()}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
                      >
                        {copilotLoading ? "Checking..." : "Ask"}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      Needs attention today
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Prioritized from role-safe fleet, provider, and review signals.
                    </p>
                  </div>
                  <Link
                    href="/nava-eye"
                    className="rounded-md border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/10"
                  >
                    Open Nava Eye
                  </Link>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {commandActions.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-5 ${actionCardClasses(item.severity)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            {item.title}
                          </div>
                          <div className="mt-2 text-2xl font-semibold text-white">
                            {item.count}
                          </div>
                        </div>
                        <span className="rounded-md border border-current/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                          {item.severity}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">
                        {item.implication}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          href={item.href}
                          className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          {item.actionLabel}
                        </Link>
                        {item.suggestedQuestion && (
                          <button
                            type="button"
                            onClick={() => askCopilot(item.suggestedQuestion)}
                            className="rounded-md border border-blue-400/30 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/10"
                          >
                            Ask Nava Eye
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <BriefMetric label="Enabled assets" value={Number(fh.total_trucks || 0).toLocaleString()} />
                <BriefMetric label="Live now" value={Number(fh.online_trucks || 0).toLocaleString()} tone="good" />
                <BriefMetric label="Stale/offline" value={Number(fh.offline_trucks || 0).toLocaleString()} tone="warn" />
                <BriefMetric label="Trip review" value={roleCapabilities.canViewJourneys ? "Open queue" : "Restricted"} />
                <BriefMetric label="Critical events" value={Number(fh.critical_events_24h || 0).toLocaleString()} tone={Number(fh.critical_events_24h || 0) > 0 ? "danger" : "good"} />
                <BriefMetric label="Provider readiness" value={roleCapabilities.canReviewAssets ? `${Number(data.asset_review_summary?.unreviewed_assets || 0).toLocaleString()} review` : "Role-gated"} />
              </section>

              <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
                <div className="space-y-6">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-white">Review queues</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Role-aware work areas. Restricted queues show boundaries without exposing amounts.
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {reviewQueues.map((queue) =>
                        queue.restricted ? (
                          <div
                            key={queue.id}
                            className="rounded-lg border border-white/10 bg-slate-950/40 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-100">
                                  {queue.title}
                                </div>
                                <div className="mt-2 text-lg font-semibold text-slate-400">
                                  {queue.value}
                                </div>
                              </div>
                            </div>
                            <p className="mt-2 text-sm leading-5 text-slate-500">
                              {queue.body}
                            </p>
                          </div>
                        ) : (
                          <Link
                            key={queue.id}
                            href={queue.href}
                            className="group rounded-lg border border-white/10 bg-slate-950/40 p-4 transition hover:border-cyan-300/40 hover:bg-slate-900"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-100 group-hover:text-cyan-100">
                                  {queue.title}
                                </div>
                                <div className="mt-2 text-lg font-semibold text-white">
                                  {queue.value}
                                </div>
                              </div>
                              <span className="text-slate-500 group-hover:text-cyan-200">→</span>
                            </div>
                            <p className="mt-2 text-sm leading-5 text-slate-500">
                              {queue.body}
                            </p>
                          </Link>
                        )
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                    <h2 className="text-lg font-semibold text-white">
                      Event review
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      High-severity tracker events grouped for triage, not shown as raw event spam.
                    </p>
                    {criticalEventGroups.length ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {criticalEventGroups.map((group) => (
                          <div
                            key={group.type}
                            className="rounded-lg border border-rose-300/20 bg-rose-500/10 p-4"
                          >
                            <div className="text-sm font-semibold text-rose-100">
                              {formatWatchLabel(group.type)}
                            </div>
                            <div className="mt-2 text-2xl font-semibold text-white">
                              {group.count.toLocaleString()}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {group.trucks.size.toLocaleString()} affected truck(s)
                              {group.latest ? ` · latest ${formatRelativeTime(group.latest)}` : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                        No high-severity tracker events in the current dashboard window.
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-white">
                          Command routes
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Open the specialist workspace after this brief points you there.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {commandLinks.map((item) => (
                        <Link
                          key={`${item.label}-${item.href}`}
                          href={item.href}
                          className="rounded-md border border-white/10 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-100"
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-lg border border-cyan-200/20 bg-slate-900/50 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-white">Nava Eye Watch</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Suggested questions from the current brief.
                        </p>
                      </div>
                      <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                        Action assistant
                      </span>
                    </div>

                    {watchItems.length ? (
                      <div className="mt-4 space-y-3">
                        {watchItems.map((item) => (
                          <div
                            key={item.id}
                            className={`rounded-lg border p-3 ${severityClasses(item.severity)}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-100">
                                {item.title}
                              </div>
                              <span className="shrink-0 rounded-md border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                {item.severity}
                              </span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-300">
                              {item.summary}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.suggested_question && (
                                <button
                                  type="button"
                                  onClick={() => askCopilot(item.suggested_question)}
                                  className="rounded-md border border-blue-400/30 px-3 py-1.5 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/10"
                                >
                                  Ask Nava Eye
                                </button>
                              )}
                              {item.href && (
                                <Link
                                  href={item.href}
                                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                                >
                                  Open view
                                </Link>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                        No urgent watch items from the current role-safe summary.
                      </div>
                    )}

                    {copilotAnswer && (
                      <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950/60 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
                          Nava Eye answer
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                          {copilotAnswer}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                    <h2 className="text-lg font-semibold text-white">
                      Active intelligence notes
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Durable Nava Eye notes that remain visible for this workspace and role.
                    </p>
                    {memories.length ? (
                      <div className="mt-4 space-y-3">
                        {memories.slice(0, 4).map((memory) => (
                          <div
                            key={memory.id}
                            className="rounded-lg border border-white/10 bg-slate-950/40 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                                memory.severity === "critical"
                                  ? "bg-red-900/50 text-red-300"
                                  : memory.severity === "warning"
                                    ? "bg-yellow-900/50 text-yellow-300"
                                    : "bg-blue-900/50 text-blue-300"
                              }`}>
                                {memory.severity || "info"}
                              </span>
                              <span className="text-xs text-slate-500">
                                {formatWatchLabel(memory.memory_type)}
                              </span>
                            </div>
                            <div className="mt-2 text-sm font-semibold text-slate-100">
                              {memory.title}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-400">
                              {memory.summary}
                            </div>
                            {memory.recommendation && (
                              <div className="mt-2 text-xs text-blue-300">
                                {memory.recommendation}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                        No active intelligence notes for this workspace.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
