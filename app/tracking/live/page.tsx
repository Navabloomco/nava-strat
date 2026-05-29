"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import NavaEyePromptLink from "../../components/NavaEyePromptLink";

type LiveTrackingData = {
  company: { id: string; name: string; slug: string } | null;
  freshness_minutes: number;
  summary: {
    imported_assets: number;
    enabled_assets: number;
    active_assets: number;
    live_assets: number;
    stale_assets: number;
    telemetry_points_24h: number;
    provider_count: number;
    active_provider_count: number;
  };
  capabilities?: {
    can_edit_availability?: boolean;
  };
  trucks: any[];
  stale_assets: any[];
  providers: any[];
};

type LiveTrackingFilter =
  | "all"
  | "live"
  | "stale"
  | "moving"
  | "stopped"
  | "active_trip"
  | "needs_location";

const LIVE_TRACKING_FILTERS: Array<{ key: LiveTrackingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "stale", label: "Stale" },
  { key: "moving", label: "Moving" },
  { key: "stopped", label: "Stopped" },
  { key: "active_trip", label: "Has active trip" },
  { key: "needs_location", label: "Needs readable location" },
];

const emptyData: LiveTrackingData = {
  company: null,
  freshness_minutes: 30,
  summary: {
    imported_assets: 0,
    enabled_assets: 0,
    active_assets: 0,
    live_assets: 0,
    stale_assets: 0,
    telemetry_points_24h: 0,
    provider_count: 0,
    active_provider_count: 0,
  },
  capabilities: {},
  trucks: [],
  stale_assets: [],
  providers: [],
};

const availabilityStatusOptions = [
  { value: "available", label: "Available / clear status" },
  { value: "grounded", label: "Grounded" },
  { value: "under_repair", label: "Under repair" },
  { value: "breakdown_reported", label: "Breakdown reported" },
  { value: "out_of_service", label: "Out of service" },
  { value: "at_client_site", label: "At client/site" },
  { value: "loading", label: "Loading" },
  { value: "offloading", label: "Offloading" },
  { value: "waiting", label: "Waiting" },
  { value: "unknown_stopped_time", label: "Unknown stopped time" },
];

export default function LiveTrackingPage() {
  const [data, setData] = useState<LiveTrackingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canEnrichLocations, setCanEnrichLocations] = useState(false);
  const [enrichingLocations, setEnrichingLocations] = useState(false);
  const [error, setError] = useState("");
  const [enrichmentMessage, setEnrichmentMessage] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<LiveTrackingFilter>("all");

  useEffect(() => {
    loadAccess();
    loadData();

    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    return session?.access_token || null;
  }

  async function loadAccess() {
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    try {
      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const json = await res.json();
      const roles = new Set(
        (json.roles || []).map((role: string) => String(role).toLowerCase())
      );

      setCanEnrichLocations(
        Boolean(json.is_platform_owner) ||
          roles.has("platform_owner") ||
          roles.has("owner") ||
          roles.has("admin")
      );
    } catch {
      setCanEnrichLocations(false);
    }
  }

  async function loadData() {
    setError("");
    setRefreshing(true);

    const accessToken = await getAccessToken();

    if (!accessToken) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/tracking/live", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load live tracking.");
      }

      setData({
        company: json.company || null,
        freshness_minutes: json.freshness_minutes || 30,
        summary: json.summary || emptyData.summary,
        capabilities: json.capabilities || {},
        trucks: json.trucks || [],
        stale_assets: json.stale_assets || [],
        providers: json.providers || [],
      });
      setLastLoadedAt(new Date().toISOString());
    } catch (err: any) {
      setError(err.message || "Failed to load live tracking.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function saveAvailability(row: any, status: string, note: string) {
    setError("");
    setEnrichmentMessage("");
    const accessToken = await getAccessToken();
    if (!accessToken) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/asset-availability", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asset_id: row.asset_id || null,
          truck_id: row.registration || row.truck_id || null,
          journey_id: row.active_trip_id || null,
          status,
          note,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save availability status.");
      }

      setEnrichmentMessage(json.message || "Availability status saved.");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to save availability status.");
    }
  }

  async function enrichLocationLabels() {
    setEnrichmentMessage("");
    setError("");
    setEnrichingLocations(true);

    const accessToken = await getAccessToken();
    if (!accessToken) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/tracking/enrich-locations", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ maxItems: 10 }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to enrich location labels.");
      }

      setEnrichmentMessage(
        `Location enrichment checked ${json.checked} coordinate sets, added ${json.enriched} labels, and skipped ${json.skipped_recent_attempt} recent attempts.`
      );
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to enrich location labels.");
    } finally {
      setEnrichingLocations(false);
    }
  }

  const summary = data.summary;
  const noProviders = summary.provider_count === 0;
  const noImportedAssets = summary.provider_count > 0 && summary.imported_assets === 0;
  const importedButNoneEnabled =
    summary.imported_assets > 0 && summary.enabled_assets === 0;
  const importedAssetsAwaitingReview =
    summary.imported_assets > summary.enabled_assets;
  const noLiveLocations = summary.enabled_assets > 0 && summary.live_assets === 0;
  const filteredRows = useMemo(
    () =>
      filterLiveTrackingRows({
        liveRows: data.trucks,
        staleRows: data.stale_assets,
        searchQuery,
        activeFilter,
      }),
    [data.trucks, data.stale_assets, searchQuery, activeFilter]
  );
  const hasActiveFilters = searchQuery.trim().length > 0 || activeFilter !== "all";
  const totalSearchableAssets = data.trucks.length + data.stale_assets.length;
  const visibleAssetCount = filteredRows.live.length + filteredRows.stale.length;
  const resultCountText = formatResultCountText({
    query: searchQuery,
    activeFilter,
    visibleAssetCount,
    totalAssetCount: totalSearchableAssets,
    liveCount: filteredRows.live.length,
    staleCount: filteredRows.stale.length,
  });
  const canEditAvailability = Boolean(data.capabilities?.can_edit_availability);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="break-words text-xs font-bold uppercase tracking-[0.16em] text-cyan-200 sm:tracking-[0.2em]">
              Live Fleet
            </p>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-normal">
              Live Tracking
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Current active fleet locations from your secure provider connections.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-2 text-sm text-slate-300 lg:items-end">
            <span className="break-words">{data.company?.name || "Company workspace"}</span>
            <span className="break-words">
              {refreshing ? "Refreshing..." : "Auto-refresh every 30 seconds"}
              {lastLoadedAt ? ` · ${formatDateTime(lastLoadedAt)}` : ""}
            </span>
            {canEnrichLocations && (
              <button
                type="button"
                onClick={enrichLocationLabels}
                disabled={enrichingLocations}
                className="self-start rounded-md border border-cyan-200/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60 lg:self-auto"
              >
                {enrichingLocations ? "Enriching..." : "Enrich location labels"}
              </button>
            )}
          </div>
        </header>

        {loading ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-white/[0.06] p-6 text-slate-200">
            Loading live fleet data...
          </section>
        ) : (
          <>
            {error && (
              <section className="mt-8 rounded-lg border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                {error}
              </section>
            )}
            {enrichmentMessage && (
              <section className="mt-8 rounded-lg border border-cyan-200/20 bg-cyan-300/10 p-4 text-sm text-cyan-50">
                {enrichmentMessage}
              </section>
            )}

            <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              <Metric label="Enabled assets" value={summary.enabled_assets} />
              <Metric label="Live now" value={summary.live_assets} accent />
              <Metric label="Stale assets" value={summary.stale_assets} />
              <Metric label="Telemetry 24h" value={summary.telemetry_points_24h} />
              <Metric label="Providers" value={summary.provider_count} />
            </section>

            {importedAssetsAwaitingReview && (
              <section className="mt-8 rounded-lg border border-amber-300/25 bg-amber-300/10 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-amber-100">
                      Provider assets waiting for review
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                      Some provider assets are waiting for review before they appear in live tracking.
                    </p>
                  </div>
                  <Link
                    href="/admin/assets"
                    className="inline-flex w-full items-center justify-center rounded-md bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 sm:w-auto"
                  >
                    Review provider assets
                  </Link>
                </div>
              </section>
            )}

            {(noProviders || noImportedAssets || importedButNoneEnabled || noLiveLocations) && (
              <EmptyState
                noProviders={noProviders}
                noImportedAssets={noImportedAssets}
                importedButNoneEnabled={importedButNoneEnabled}
                noLiveLocations={noLiveLocations}
                freshnessMinutes={data.freshness_minutes}
              />
            )}

            <LiveTrackingCommandBar
              searchQuery={searchQuery}
              activeFilter={activeFilter}
              resultText={resultCountText}
              onSearchChange={setSearchQuery}
              onFilterChange={setActiveFilter}
              onClearSearch={() => setSearchQuery("")}
              onResetFilter={() => setActiveFilter("all")}
              onResetAll={() => {
                setSearchQuery("");
                setActiveFilter("all");
              }}
            />

            {hasActiveFilters && visibleAssetCount > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span>Need a quick read on the filtered set?</span>
                <NavaEyePromptLink
                  label="Ask Nava Eye about these results"
                  prompt={buildLiveTrackingResultsPrompt({
                    searchQuery,
                    activeFilter,
                    resultText: resultCountText,
                    liveCount: filteredRows.live.length,
                    staleCount: filteredRows.stale.length,
                  })}
                  companyId={data.company?.id}
                  contextType="live_tracking_results"
                  variant="chip"
                />
              </div>
            )}

            {hasActiveFilters && visibleAssetCount === 0 && (
              <section className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                <div className="font-medium text-slate-100">
                  No matching assets found.
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Clear search or reset filters to view all assets.
                </div>
              </section>
            )}

            {hasActiveFilters ? (
              <>
                {filteredRows.live.length > 0 && (
                  <div className="mt-8">
                    <LiveTrucksSection
                      rows={filteredRows.live}
                      freshnessMinutes={data.freshness_minutes}
                      refreshing={refreshing}
                      hasActiveFilters={hasActiveFilters}
                      showEmptyState={false}
                      canEditAvailability={canEditAvailability}
                      companyId={data.company?.id}
                      onRefresh={loadData}
                      onSaveAvailability={saveAvailability}
                    />
                  </div>
                )}

                {filteredRows.stale.length > 0 && (
                  <div className="mt-6">
                    <StaleAssetsSection
                      rows={filteredRows.stale}
                      hasActiveFilters={hasActiveFilters}
                      showEmptyState={false}
                      canEditAvailability={canEditAvailability}
                      companyId={data.company?.id}
                      onSaveAvailability={saveAvailability}
                    />
                  </div>
                )}

                <section className="mt-8 grid gap-6 xl:grid-cols-[360px]">
                  <ProviderStatusSection providers={data.providers} />
                </section>
              </>
            ) : (
              <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
                <LiveTrucksSection
                  rows={filteredRows.live}
                  freshnessMinutes={data.freshness_minutes}
                  refreshing={refreshing}
                  hasActiveFilters={hasActiveFilters}
                  showEmptyState
                  canEditAvailability={canEditAvailability}
                  companyId={data.company?.id}
                  onRefresh={loadData}
                  onSaveAvailability={saveAvailability}
                />

                <aside className="space-y-6">
                  <ProviderStatusSection providers={data.providers} />
                  <StaleAssetsSection
                    rows={filteredRows.stale}
                    hasActiveFilters={hasActiveFilters}
                    showEmptyState
                    canEditAvailability={canEditAvailability}
                    companyId={data.company?.id}
                    onSaveAvailability={saveAvailability}
                  />
                </aside>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={accent ? "mt-3 text-3xl font-semibold text-cyan-200" : "mt-3 text-3xl font-semibold text-white"}>
        {value}
      </div>
    </div>
  );
}

function LiveTrucksSection({
  rows,
  freshnessMinutes,
  refreshing,
  hasActiveFilters,
  showEmptyState,
  canEditAvailability,
  companyId,
  onRefresh,
  onSaveAvailability,
}: {
  rows: any[];
  freshnessMinutes: number;
  refreshing: boolean;
  hasActiveFilters: boolean;
  showEmptyState: boolean;
  canEditAvailability: boolean;
  companyId?: string | null;
  onRefresh: () => void;
  onSaveAvailability: (row: any, status: string, note: string) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.06]">
      <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Live trucks</h2>
          <p className="mt-1 text-xs text-slate-400">
            Fresh locations within {freshnessMinutes} minutes.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="self-start rounded-md border border-cyan-200/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
        >
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        showEmptyState ? (
          <div className="p-6 text-sm text-slate-300">
            {hasActiveFilters
              ? "No matching live trucks."
              : `No fresh live locations in the last ${freshnessMinutes} minutes.`}
          </div>
        ) : null
      ) : (
        <div className="divide-y divide-white/10">
          {rows.map((truck) => (
            <TruckRow
              key={truck.truck_id}
              truck={truck}
              canEditAvailability={canEditAvailability}
              companyId={companyId}
              onSaveAvailability={onSaveAvailability}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderStatusSection({ providers }: { providers: any[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.06]">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold">Provider status</h2>
      </div>
      {providers.length === 0 ? (
        <div className="p-5 text-sm text-slate-300">
          No tracking provider connected yet.
        </div>
      ) : (
        <div className="divide-y divide-white/10">
          {providers.map((provider) => (
            <div key={provider.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 break-words font-semibold text-slate-100">
                  {provider.provider_name || "Provider"}
                </div>
                <StatusPill value={provider.status} />
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Last sync: {formatDateTime(provider.last_sync_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StaleAssetsSection({
  rows,
  hasActiveFilters,
  showEmptyState,
  canEditAvailability,
  companyId,
  onSaveAvailability,
}: {
  rows: any[];
  hasActiveFilters: boolean;
  showEmptyState: boolean;
  canEditAvailability: boolean;
  companyId?: string | null;
  onSaveAvailability: (row: any, status: string, note: string) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.06]">
      <div className="border-b border-white/10 px-5 py-4">
        <h2 className="text-lg font-semibold">Stale assets</h2>
        <p className="mt-1 text-xs text-slate-400">
          Active assets without fresh location updates.
        </p>
      </div>
      {rows.length === 0 ? (
        showEmptyState ? (
          <div className="p-5 text-sm text-slate-300">
            {hasActiveFilters ? "No matching stale assets." : "No stale active assets right now."}
          </div>
        ) : null
      ) : (
        <div className="divide-y divide-white/10">
          {rows.map((asset) => (
            <div key={asset.truck_id} className="px-5 py-4">
              <div className="font-semibold text-slate-100">
                {asset.registration || asset.truck_id}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {asset.provider_name || "Provider not specified"}
              </div>
              <IdentityHints item={asset} />
              <AvailabilityChip availability={asset.availability} />
              <TripContext item={asset} compact />
              <GeofenceBadge match={asset.geofence_match} />
              <div className="mt-1 text-sm text-slate-300">
                {asset.location_label || "Location not labeled yet"}
              </div>
              {asset.location_note && (
                <div className="mt-1 text-xs leading-5 text-amber-100">
                  {asset.location_note}
                </div>
              )}
              <div className="mt-1 text-xs text-slate-400">
                Last seen: {formatDateTime(asset.last_seen_at)}
              </div>
              {canEditAvailability && (
                <AvailabilityEditor
                  item={asset}
                  compact
                  onSave={onSaveAvailability}
                />
              )}
              <div className="mt-3">
                <NavaEyePromptLink
                  label="Ask about this truck"
                  prompt={buildLiveTruckPrompt(asset, "stale")}
                  companyId={companyId}
                  contextType="truck"
                  contextId={asset.asset_id || asset.truck_id || asset.registration}
                  variant="rowAction"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LiveTrackingCommandBar({
  searchQuery,
  activeFilter,
  resultText,
  onSearchChange,
  onFilterChange,
  onClearSearch,
  onResetFilter,
  onResetAll,
}: {
  searchQuery: string;
  activeFilter: LiveTrackingFilter;
  resultText: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: LiveTrackingFilter) => void;
  onClearSearch: () => void;
  onResetFilter: () => void;
  onResetAll: () => void;
}) {
  const trimmedSearch = searchQuery.trim();
  const hasActiveSearch = trimmedSearch.length > 0;
  const hasActiveFilter = activeFilter !== "all";
  const hasActiveInput = hasActiveSearch || hasActiveFilter;
  const activeFilterLabel =
    LIVE_TRACKING_FILTERS.find((filter) => filter.key === activeFilter)?.label || "";
  const resetLabel =
    hasActiveSearch && hasActiveFilter
      ? "Reset search & filter"
      : hasActiveSearch
        ? "Clear search"
        : "Reset filter";
  const handleReset = () => {
    if (hasActiveSearch && hasActiveFilter) {
      onResetAll();
      return;
    }

    if (hasActiveSearch) {
      onClearSearch();
      return;
    }

    onResetFilter();
  };

  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/60 p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label htmlFor="live-tracking-search" className="sr-only">
            Search live tracking assets
          </label>
          <input
            id="live-tracking-search"
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search truck, trailer, provider, client, route, or location..."
            className="min-h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-200/60 focus:ring-1 focus:ring-cyan-200/25"
          />
          {hasActiveInput && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-white/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-200 hover:border-cyan-200/40 hover:bg-cyan-300/10"
            >
              {resetLabel}
            </button>
          )}
          <div className="text-xs leading-5 text-slate-400 lg:min-w-[240px] lg:text-right">
            {resultText}
          </div>
        </div>
        {hasActiveInput && (
          <div className="text-xs leading-5 text-slate-400">
            {hasActiveSearch && (
              <span>
                Search: <span className="text-slate-200">"{trimmedSearch}"</span>
              </span>
            )}
            {hasActiveSearch && hasActiveFilter && (
              <span className="px-2 text-slate-600">·</span>
            )}
            {hasActiveFilter && activeFilterLabel && (
              <span>
                Filter: <span className="text-cyan-100">{activeFilterLabel}</span>
              </span>
            )}
          </div>
        )}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {LIVE_TRACKING_FILTERS.map((filter) => {
            const active = activeFilter === filter.key;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => onFilterChange(filter.key)}
                className={
                  active
                    ? "shrink-0 rounded-full border border-cyan-200/60 bg-cyan-300/15 px-3 py-1.5 text-xs font-semibold text-cyan-50"
                    : "shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-200/30 hover:bg-cyan-300/10"
                }
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TruckRow({
  truck,
  canEditAvailability,
  companyId,
  onSaveAvailability,
}: {
  truck: any;
  canEditAvailability: boolean;
  companyId?: string | null;
  onSaveAvailability: (row: any, status: string, note: string) => Promise<void>;
}) {
  return (
    <article className="grid gap-4 px-5 py-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:items-center">
      <div>
        <div className="text-base font-semibold text-slate-100">
          {truck.registration || truck.truck_id}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {truck.provider_name || "Provider not specified"}
        </div>
        <IdentityHints item={truck} />
        <AvailabilityChip availability={truck.availability} />
        <TripContext item={truck} />
        {canEditAvailability && (
          <AvailabilityEditor item={truck} onSave={onSaveAvailability} />
        )}
      </div>

      <div className="text-sm text-slate-200">
        <div className="font-medium">Location</div>
        <GeofenceBadge match={truck.geofence_match} />
        <div className="mt-1 text-slate-100">
          {truck.location_label || "Location not labeled yet"}
        </div>
        {truck.location_note && (
          <div className="mt-1 text-xs leading-5 text-amber-100">
            {truck.location_note}
          </div>
        )}
      </div>

      <div className="text-sm text-slate-200">
        <div className="font-medium">Live readings</div>
        <div className="mt-1 text-slate-400">
          Speed: {formatValue(truck.speed, "km/h")} · {formatFuelReading(truck.fuel_level, truck.fuel_unit)}
        </div>
      </div>

      <div className="text-sm text-slate-200 lg:text-right">
        <StatusPill value={truck.status || "active"} />
        <div className="mt-2 text-xs text-slate-400">
          {truck.freshness_minutes ?? "—"} min old · {formatDateTime(truck.last_seen_at)}
        </div>
        <div className="mt-3">
          <NavaEyePromptLink
            label="Ask about this truck"
            prompt={buildLiveTruckPrompt(truck, "live")}
            companyId={companyId}
            contextType="truck"
            contextId={truck.asset_id || truck.truck_id || truck.registration}
            variant="rowAction"
          />
        </div>
      </div>
    </article>
  );
}

function AvailabilityChip({ availability }: { availability?: any }) {
  if (!availability?.status) return null;
  const status = String(availability.status || "");
  const tone = availabilityTone(status);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className={availabilityPillClass(tone)}>
        {availabilityLabel(status)}
      </span>
      {availability.note && (
        <span className="text-xs leading-5 text-slate-400">{availability.note}</span>
      )}
    </div>
  );
}

function AvailabilityEditor({
  item,
  compact = false,
  onSave,
}: {
  item: any;
  compact?: boolean;
  onSave: (row: any, status: string, note: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(item?.availability?.status || "available");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: any) {
    event.preventDefault();
    setSaving(true);
    await onSave(item, status, note);
    setNote("");
    setSaving(false);
  }

  return (
    <details className={compact ? "mt-3 text-xs" : "mt-3 text-xs"}>
      <summary className="cursor-pointer font-semibold text-cyan-100">
        Update availability
      </summary>
      <form onSubmit={submit} className="mt-3 grid gap-2">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-200/50"
        >
          {availabilityStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
          className="w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500 focus:border-cyan-200/50"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-cyan-200/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving..." : status === "available" ? "Clear status" : "Save status"}
        </button>
      </form>
    </details>
  );
}

function IdentityHints({ item }: { item: any }) {
  const registration = normalizeSearchCompact(item?.registration || item?.truck_id);
  const hints = [
    item?.provider_asset_label &&
    normalizeSearchCompact(item.provider_asset_label) !== registration
      ? `Provider asset: ${item.provider_asset_label}`
      : null,
    item?.attached_trailer_plate ? `Trailer: ${item.attached_trailer_plate}` : null,
  ].filter(Boolean);

  if (!hints.length) return null;

  return (
    <div className="mt-1 break-words text-xs text-slate-500">
      {hints.join(" · ")}
    </div>
  );
}

function TripContext({ item, compact = false }: { item: any; compact?: boolean }) {
  if (item?.active_trip_conflict) {
    return (
      <div className={compact ? "mt-2 text-xs text-amber-100" : "mt-3 text-xs text-amber-100"}>
        Multiple active trips need review.
      </div>
    );
  }

  if (!item?.active_trip_id) return null;

  const client = item.active_trip_client || "Client pending";
  const route =
    item.active_trip_from || item.active_trip_to
      ? `${item.active_trip_from || "Origin pending"} → ${item.active_trip_to || "Destination pending"}`
      : item.active_trip_reference || "Route pending";
  const status = String(item.active_trip_status || "active").toLowerCase();

  return (
    <div className={compact ? "mt-2 text-xs leading-5 text-cyan-100" : "mt-3 rounded-md border border-cyan-200/15 bg-cyan-300/10 p-3 text-xs leading-5 text-cyan-50"}>
      <div className="font-semibold">
        Trip: {client} · {route}
      </div>
      <div className="text-cyan-100/80">
        Trip status: {status}
      </div>
    </div>
  );
}

function GeofenceBadge({ match }: { match?: any }) {
  if (!match?.name) return null;
  const relation = String(match.relation || "inside").toLowerCase() === "near" ? "Near" : "Inside";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="inline-flex max-w-full whitespace-normal break-words rounded-full border border-cyan-200/25 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold leading-5 text-cyan-100">
        {relation} {match.name}
      </span>
      {match.type && (
        <span className="text-xs text-slate-400">{formatGeofenceType(match.type)}</span>
      )}
    </div>
  );
}

function EmptyState({
  noProviders,
  noImportedAssets,
  importedButNoneEnabled,
  noLiveLocations,
  freshnessMinutes,
}: {
  noProviders: boolean;
  noImportedAssets: boolean;
  importedButNoneEnabled: boolean;
  noLiveLocations: boolean;
  freshnessMinutes: number;
}) {
  let title = "No fresh live locations";
  let body = `No active fleet asset has reported a valid location in the last ${freshnessMinutes} minutes.`;

  if (noProviders) {
    title = "No tracking provider connected";
    body = "Connect a GPS or telemetry provider so Nava can begin receiving fleet locations.";
  } else if (noImportedAssets) {
    title = "Provider connected, no fleet assets yet";
    body = "Your provider connection exists, but Nava has not received fleet assets yet.";
  } else if (importedButNoneEnabled) {
    title = "Provider assets are waiting for review";
    body =
      "Provider assets have been received, but none have been enabled for Nava intelligence yet. Review provider assets before they appear in live tracking.";
  } else if (noLiveLocations) {
    title = "No fresh live locations";
    body =
      "Enabled assets exist, but no fresh live locations have arrived in the last 30 minutes.";
  }

  return (
    <section className="mt-8 rounded-lg border border-cyan-200/20 bg-cyan-300/10 p-5">
      <h2 className="text-lg font-semibold text-cyan-100">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{body}</p>
      {importedButNoneEnabled && (
        <Link
          href="/admin/assets"
          className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 sm:w-auto"
        >
          Review provider assets
        </Link>
      )}
    </section>
  );
}

function StatusPill({ value }: { value: string }) {
  const normalized = String(value || "").toLowerCase();
  const active =
    normalized === "active" || normalized === "success" || normalized === "not_tested";

  return (
    <span
      className={
        active
          ? "inline-flex max-w-full whitespace-normal break-words rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-center text-xs font-semibold leading-5 text-emerald-100"
          : "inline-flex max-w-full whitespace-normal break-words rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-center text-xs font-semibold leading-5 text-amber-100"
      }
    >
      {value || "unknown"}
    </span>
  );
}

function buildLiveTrackingResultsPrompt({
  searchQuery,
  activeFilter,
  resultText,
  liveCount,
  staleCount,
}: {
  searchQuery: string;
  activeFilter: LiveTrackingFilter;
  resultText: string;
  liveCount: number;
  staleCount: number;
}) {
  const filterLabel =
    LIVE_TRACKING_FILTERS.find((filter) => filter.key === activeFilter)?.label || "All";
  const searchText = searchQuery.trim()
    ? `Search: "${searchQuery.trim()}".`
    : "No search text.";
  return [
    "Review these Live Tracking results and tell me what to check first.",
    searchText,
    `Filter: ${filterLabel}.`,
    `Result summary: ${resultText}.`,
    `${liveCount.toLocaleString()} live match(es), ${staleCount.toLocaleString()} stale match(es).`,
  ].join(" ");
}

function buildLiveTruckPrompt(row: any, statusText: "live" | "stale") {
  const truck = row?.registration || row?.truck_id || "this truck";
  const availabilityStatus = String(row?.availability?.status || "").trim();
  const availabilityText = availabilityStatus ? availabilityLabel(availabilityStatus) : "";

  if (availabilityStatus && availabilityStatus !== "available") {
    return `Why is ${truck} marked ${availabilityText}, and what should I check next?`;
  }

  if (row?.active_trip_id || row?.active_trip_conflict) {
    return `How is ${truck} doing on its active Trip?`;
  }

  if (statusText === "stale") {
    return `Why is ${truck} stale and what should I check?`;
  }

  if (Number(row?.speed || 0) > 0) {
    return `What should I know about ${truck} right now?`;
  }

  return `Why is ${truck} stopped and what should I check?`;
}

function filterLiveTrackingRows({
  liveRows,
  staleRows,
  searchQuery,
  activeFilter,
}: {
  liveRows: any[];
  staleRows: any[];
  searchQuery: string;
  activeFilter: LiveTrackingFilter;
}) {
  const query = normalizeSearchText(searchQuery);
  const compactQuery = normalizeSearchCompact(searchQuery);

  return {
    live: (liveRows || []).filter(
      (row) =>
        rowMatchesFilter(row, "live", activeFilter) &&
        rowMatchesSearch(row, "live", query, compactQuery)
    ),
    stale: (staleRows || []).filter(
      (row) =>
        rowMatchesFilter(row, "stale", activeFilter) &&
        rowMatchesSearch(row, "stale", query, compactQuery)
    ),
  };
}

function rowMatchesSearch(
  row: any,
  statusText: "live" | "stale",
  query: string,
  compactQuery: string
) {
  if (!query && !compactQuery) return true;
  const fields = buildSearchFields(row, statusText);
  const readableText = normalizeSearchText(fields.join(" "));
  const compactText = normalizeSearchCompact(fields.join(" "));

  return Boolean(
    (query && readableText.includes(query)) ||
    (compactQuery && compactText.includes(compactQuery))
  );
}

function buildSearchFields(row: any, statusText: "live" | "stale") {
  const geofence = row?.geofence_match || {};
  return [
    statusText,
    row?.truck_id,
    row?.registration,
    row?.provider_name,
    row?.provider_asset_label,
    row?.attached_trailer_plate,
    row?.status,
    row?.location_label,
    row?.location_note,
    row?.location_source,
    geofence.name,
    geofence.type,
    geofence.relation,
    row?.availability?.status,
    row?.availability?.note,
    row?.active_trip_reference,
    row?.active_trip_client,
    row?.active_trip_from,
    row?.active_trip_to,
    row?.active_trip_status,
    row?.active_trip_message,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function rowMatchesFilter(
  row: any,
  statusText: "live" | "stale",
  activeFilter: LiveTrackingFilter
) {
  if (activeFilter === "all") return true;
  if (activeFilter === "live") return statusText === "live";
  if (activeFilter === "stale") return statusText === "stale";
  if (activeFilter === "moving") {
    return statusText === "live" && Number(row?.speed || 0) > 0;
  }
  if (activeFilter === "stopped") {
    const speed = Number(row?.speed);
    const status = normalizeSearchText(`${row?.status || ""} ${row?.availability?.status || ""}`);
    return (
      (statusText === "live" && Number.isFinite(speed) && speed === 0) ||
      /\b(stopped|stationary|parked|idle|idling)\b/.test(status)
    );
  }
  if (activeFilter === "active_trip") {
    return Boolean(row?.active_trip_id || row?.active_trip_conflict);
  }
  if (activeFilter === "needs_location") {
    return rowNeedsReadableLocation(row);
  }
  return true;
}

function rowNeedsReadableLocation(row: any) {
  const label = normalizeSearchText(row?.location_label);
  return (
    !label ||
    label === "-" ||
    label.includes("readable place name unavailable") ||
    label.includes("location not labeled") ||
    label.includes("unavailable")
  );
}

function availabilityLabel(value: string) {
  const labels: Record<string, string> = {
    available: "Available",
    on_trip: "On trip",
    grounded: "Grounded",
    under_repair: "Under repair",
    breakdown_reported: "Breakdown reported",
    out_of_service: "Out of service",
    at_client_site: "At client/site",
    loading: "Loading",
    offloading: "Offloading",
    waiting: "Waiting",
    unknown_stopped_time: "Unknown stopped time",
  };
  return labels[String(value || "").toLowerCase()] || "Availability";
}

function availabilityTone(value: string) {
  const status = String(value || "").toLowerCase();
  if (["grounded", "under_repair", "breakdown_reported", "out_of_service"].includes(status)) {
    return "danger";
  }
  if (["at_client_site", "waiting", "unknown_stopped_time"].includes(status)) return "warning";
  if (["on_trip", "loading", "offloading"].includes(status)) return "info";
  return "neutral";
}

function availabilityPillClass(tone: string) {
  const classes: Record<string, string> = {
    neutral: "border-slate-300/30 bg-slate-300/10 text-slate-200",
    info: "border-cyan-200/30 bg-cyan-300/10 text-cyan-100",
    warning: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    danger: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  };
  return `inline-flex max-w-full whitespace-normal break-words rounded-full border px-2.5 py-1 text-center text-xs font-semibold leading-5 ${classes[tone] || classes.neutral}`;
}

function formatResultCountText({
  query,
  activeFilter,
  visibleAssetCount,
  totalAssetCount,
  liveCount,
  staleCount,
}: {
  query: string;
  activeFilter: LiveTrackingFilter;
  visibleAssetCount: number;
  totalAssetCount: number;
  liveCount: number;
  staleCount: number;
}) {
  const trimmedQuery = query.trim();
  const filterLabel = LIVE_TRACKING_FILTERS.find((filter) => filter.key === activeFilter)?.label;
  const countText = trimmedQuery
    ? `${visibleAssetCount.toLocaleString()} ${
        visibleAssetCount === 1 ? "match" : "matches"
      } for "${trimmedQuery}"`
    : `Showing ${visibleAssetCount.toLocaleString()} of ${totalAssetCount.toLocaleString()} assets`;
  const filterText = activeFilter !== "all" && filterLabel ? ` · ${filterLabel}` : "";

  return `${countText}${filterText} · ${liveCount.toLocaleString()} live / ${staleCount.toLocaleString()} stale`;
}

function normalizeSearchText(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchCompact(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatValue(value: any, suffix: string) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toFixed(0)} ${suffix}`;
}

function formatFuelReading(value: any, unit?: string | null) {
  if (value === null || value === undefined || value === "") {
    return "Fuel: unavailable";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Fuel: unavailable";
  }

  const formatted = numeric.toLocaleString(undefined, {
    maximumFractionDigits: numeric % 1 === 0 ? 0 : 1,
  });
  const normalizedUnit = String(unit || "").trim().toLowerCase();

  if (["%", "percent", "percentage"].includes(normalizedUnit)) {
    return `Fuel: ${formatted}%`;
  }

  if (["l", "lt", "ltr", "liter", "liters", "litre", "litres"].includes(normalizedUnit)) {
    return `Fuel: ${formatted} litres`;
  }

  return `Provider fuel reading: ${formatted}`;
}

function formatGeofenceType(value: string) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
