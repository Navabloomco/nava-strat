"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

interface OverviewData {
  success: boolean;
  error?: string;
  company?: any;
  fleet_health?: any;
  asset_review_summary?: any;
  capabilities?: DashboardRoleCapabilities;
  active_memories?: any[];
  trucks_in_uganda?: any[];
}

interface CompanyOption {
  id: string;
  name: string;
  slug: string;
}

interface MembershipOption {
  company_id: string;
  role: string;
  is_active?: boolean;
}

const dashboardLinks = [
  { label: "Fleet / live tracking", href: "/tracking/live" },
  { label: "Journeys", href: "/ops/journey" },
  { label: "Fuel", href: "/fuel" },
  { label: "Nava Eye", href: "/nava-eye" },
  { label: "Settings", href: "/admin/company" },
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
      title: "Idle duration looks suspicious",
      summary:
        "One or more top idle totals are too large to treat as continuous idling. This may be an unclosed idle event or accumulator issue.",
      evidence: trucks.map(
        (truck: any) => `${truck.truck_id}: ${formatWatchNumber(truck.idle_hours)} hours accumulated`
      ),
      suggested_next_check:
        "Investigate whether idle events are closing correctly before using the total as a continuous-duration fact.",
      suggested_question:
        "Check whether the top idle trucks have an idle-event closure or data-quality problem.",
      href: "/nava-eye",
    });
  }

  if (capabilities.canViewOps && stationaryIdleTrucks.length) {
    const trucks = stationaryIdleTrucks.slice(0, 3);
    items.push({
      id: "current-stationary-idle",
      severity: "warning",
      title: "Top idle trucks appear stationary",
      summary:
        "These trucks have fresh low-speed telemetry and recent idle events. Nava can interpret that as current stationary/idle evidence, without claiming engine-on idling.",
      evidence: trucks.map(
        (truck: any) =>
          `${truck.truck_id}: speed ${formatWatchNumber(truck.latest_speed)}, ${formatFreshness(
            truck.freshness_minutes
          )}, latest idle ${formatRelativeTime(truck.latest_idle_event_at)}`
      ),
      suggested_next_check:
        "Check active journeys, geofences, driver assignment, and provider freshness for the same trucks.",
      suggested_question:
        "Are the top idle trucks still idling, and what context explains the stop?",
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
        "Check whether these events line up with journeys, geofences, driver assignment, or shared disruption context.",
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
  return String(value || "event").replace(/_/g, " ");
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
  const router = useRouter();

  function buildDashboardCopilotContext() {
    const fleetHealth = data?.fleet_health || {};
    const activeCompanyId = selectedCompanyId || data?.company?.id || null;
    const capabilities = data?.capabilities ||
      buildDashboardRoleCapabilities(
        rolesForDashboardCompany(memberships, activeCompanyId),
        isPlatformOwner
      );

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
      highest_idle_trucks: (fleetHealth.highest_idle_trucks || [])
        .slice(0, 5)
        .map((truck: any) => ({
          truck_id: truck.truck_id,
          idle_minutes: truck.idle_minutes ?? null,
          idle_hours: truck.idle_hours ?? null,
        })),
      highest_risk_trucks: (fleetHealth.highest_risk_trucks || [])
        .slice(0, 5)
        .map((truck: any) => ({
          truck_id: truck.truck_id,
          event_count: truck.event_count ?? null,
        })),
      recent_critical_events: (fleetHealth.recent_critical_events || [])
        .slice(0, 5)
        .map((event: any) => ({
          truck_id: event.truck_id,
          event_type: event.event_type,
          severity: event.severity,
          location_name: event.location_name || null,
          created_at: event.created_at || null,
        })),
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
          const nextSelectedCompanyId = nextCompanies[0]?.id || "";
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

  const askCopilot = async () => {
    if (!copilotQuery.trim()) return;
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
          question: copilotQuery,
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

  const fh = data.fleet_health!;
  const company = data.company!;
  const memories = data.active_memories || [];
  const ugandaTrucks = data.trucks_in_uganda || [];
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
  const adminCompanyId = isPlatformOwner ? selectedCompanyId || company.id : "";
  const watchItems = buildWatchItems(data, roleCapabilities, adminCompanyId);
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
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
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
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                    Platform Owner
                  </span>
                )}
                <span className="text-slate-500">⌄</span>
              </button>

              {companySwitcherOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/40">
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
        <aside className="w-64 border-r border-slate-800 p-6 space-y-6">
          <nav className="space-y-2">
            <div className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Quick links</div>
            {dashboardLinks.map((item) => (
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

        <main className="flex-1 p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold">{fh.total_trucks}</div>
              <div className="text-slate-500 text-sm">Active Trucks</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-green-500">{fh.online_trucks}</div>
              <div className="text-slate-500 text-sm">Online</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-yellow-500">{fh.critical_events_24h}</div>
              <div className="text-slate-500 text-sm">Critical Events (24h)</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-purple-500">{ugandaTrucks.length}</div>
              <div className="text-slate-500 text-sm">Trucks in Uganda</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">⚠️ Highest Risk Trucks</h2>
                {fh.highest_risk_trucks.map((t: any) => (
                  <div key={t.truck_id} className="flex justify-between border-b border-slate-800 py-2">
                    <span className="font-mono">{t.truck_id}</span>
                    <span className="text-red-400">{t.event_count} events</span>
                  </div>
                ))}
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🛑 Highest Idle Trucks</h2>
                {fh.highest_idle_trucks.map((t: any) => (
                  <div key={t.truck_id} className="flex justify-between border-b border-slate-800 py-2">
                    <span className="font-mono">{t.truck_id}</span>
                    <span className="text-yellow-400">{t.idle_hours} hours idle</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🔥 Recent Critical Events</h2>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {fh.recent_critical_events.map((e: any, idx: number) => (
                    <div key={idx} className="border-l-2 border-red-500 pl-3">
                      <div className="flex justify-between text-sm">
                        <span className="font-mono">{e.truck_id}</span>
                        <span className="text-slate-500 text-xs">{new Date(e.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-sm my-1">{e.event_type.replace(/_/g, " ").toUpperCase()}</div>
                      <div className="text-xs text-slate-500">{e.location_name || "Unknown"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">Nava Eye Watch</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Evidence-led items from the current dashboard data.
                    </p>
                  </div>
                  <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
                    Live read
                  </span>
                </div>

                {watchItems.length ? (
                  <div className="space-y-3">
                    {watchItems.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-xl border p-3 ${severityClasses(item.severity)}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-100">
                              {item.title}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-300">
                              {item.summary}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {item.severity}
                          </span>
                        </div>

                        {item.evidence.length > 0 && (
                          <ul className="mt-3 space-y-1 text-xs text-slate-300">
                            {item.evidence.slice(0, 4).map((evidence) => (
                              <li key={evidence} className="break-words">
                                • {evidence}
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="mt-3 rounded-lg bg-slate-950/40 p-2 text-xs text-slate-300">
                          {item.suggested_next_check}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.suggested_question && (
                            <button
                              type="button"
                              onClick={() => setCopilotQuery(item.suggested_question || "")}
                              className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-200 hover:bg-blue-500/10"
                            >
                              Ask Nava Eye
                            </button>
                          )}
                          {item.href && (
                            <Link
                              href={item.href}
                              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                            >
                              Open related view
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                    No urgent watch items from the current dashboard data.
                  </div>
                )}
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🧠 Nava Eye fleet answers</h2>
                <textarea
                  value={copilotQuery}
                  onChange={(e) => setCopilotQuery(e.target.value)}
                  placeholder="Ask about fleet health, fuel risk, specific trucks..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  rows={3}
                />
                <button
                  onClick={askCopilot}
                  disabled={copilotLoading || !copilotQuery.trim()}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-medium py-2 rounded-xl transition"
                >
                  {copilotLoading ? "Checking your fleet data..." : "Ask Nava Eye"}
                </button>
                {copilotAnswer && (
                  <div className="mt-4 bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <div className="text-sm text-slate-300 whitespace-pre-wrap">{copilotAnswer}</div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">💡 Active Insights</h2>
                <div className="space-y-3">
                  {memories.map((m) => (
                    <div key={m.id} className="border border-slate-700 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          m.severity === "critical" ? "bg-red-900/50 text-red-300" :
                          m.severity === "warning" ? "bg-yellow-900/50 text-yellow-300" :
                          "bg-blue-900/50 text-blue-300"
                        }`}>
                          {m.severity}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{m.memory_type}</span>
                      </div>
                      <div className="font-medium text-sm">{m.title}</div>
                      <div className="text-xs text-slate-400 mt-1">{m.summary}</div>
                      {m.recommendation && <div className="text-xs text-blue-400 mt-2">🔧 {m.recommendation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
