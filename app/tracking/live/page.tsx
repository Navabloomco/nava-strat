"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type LiveTrackingData = {
  company: { id: string; name: string; slug: string } | null;
  freshness_minutes: number;
  summary: {
    active_assets: number;
    live_assets: number;
    stale_assets: number;
    telemetry_points_24h: number;
    provider_count: number;
    active_provider_count: number;
  };
  trucks: any[];
  stale_assets: any[];
  providers: any[];
};

const emptyData: LiveTrackingData = {
  company: null,
  freshness_minutes: 30,
  summary: {
    active_assets: 0,
    live_assets: 0,
    stale_assets: 0,
    telemetry_points_24h: 0,
    provider_count: 0,
    active_provider_count: 0,
  },
  trucks: [],
  stale_assets: [],
  providers: [],
};

export default function LiveTrackingPage() {
  const [data, setData] = useState<LiveTrackingData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canEnrichLocations, setCanEnrichLocations] = useState(false);
  const [enrichingLocations, setEnrichingLocations] = useState(false);
  const [error, setError] = useState("");
  const [enrichmentMessage, setEnrichmentMessage] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

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
  const noAssets = summary.provider_count > 0 && summary.active_assets === 0;
  const noLiveLocations = summary.active_assets > 0 && summary.live_assets === 0;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
              Live Fleet
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal">
              Live Tracking
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Current active fleet locations from your secure provider connections.
            </p>
          </div>

          <div className="flex flex-col gap-2 text-sm text-slate-300 lg:items-end">
            <span>{data.company?.name || "Company workspace"}</span>
            <span>
              {refreshing ? "Refreshing..." : "Auto-refresh every 30 seconds"}
              {lastLoadedAt ? ` · ${formatDateTime(lastLoadedAt)}` : ""}
            </span>
            {canEnrichLocations && (
              <button
                type="button"
                onClick={enrichLocationLabels}
                disabled={enrichingLocations}
                className="rounded-md border border-cyan-200/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
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

            <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="Active assets" value={summary.active_assets} />
              <Metric label="Live now" value={summary.live_assets} accent />
              <Metric label="Stale assets" value={summary.stale_assets} />
              <Metric label="Telemetry 24h" value={summary.telemetry_points_24h} />
              <Metric label="Providers" value={summary.provider_count} />
              <Metric label="Active providers" value={summary.active_provider_count} />
            </section>

            {(noProviders || noAssets || noLiveLocations) && (
              <EmptyState
                noProviders={noProviders}
                noAssets={noAssets}
                noLiveLocations={noLiveLocations}
                freshnessMinutes={data.freshness_minutes}
              />
            )}

            <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_360px]">
              <div className="rounded-lg border border-white/10 bg-white/[0.06]">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-semibold">Live trucks</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Fresh locations within {data.freshness_minutes} minutes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadData}
                    disabled={refreshing}
                    className="rounded-md border border-cyan-200/30 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-cyan-100 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Refresh
                  </button>
                </div>

                {data.trucks.length === 0 ? (
                  <div className="p-6 text-sm text-slate-300">
                    No fresh live locations in the last {data.freshness_minutes} minutes.
                  </div>
                ) : (
                  <div className="divide-y divide-white/10">
                    {data.trucks.map((truck) => (
                      <TruckRow key={truck.truck_id} truck={truck} />
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-6">
                <section className="rounded-lg border border-white/10 bg-white/[0.06]">
                  <div className="border-b border-white/10 px-5 py-4">
                    <h2 className="text-lg font-semibold">Provider status</h2>
                  </div>
                  {data.providers.length === 0 ? (
                    <div className="p-5 text-sm text-slate-300">
                      No tracking provider connected yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {data.providers.map((provider) => (
                        <div key={provider.id} className="px-5 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-slate-100">
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

                <section className="rounded-lg border border-white/10 bg-white/[0.06]">
                  <div className="border-b border-white/10 px-5 py-4">
                    <h2 className="text-lg font-semibold">Stale assets</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Active assets without fresh coordinates.
                    </p>
                  </div>
                  {data.stale_assets.length === 0 ? (
                    <div className="p-5 text-sm text-slate-300">
                      No stale active assets right now.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {data.stale_assets.map((asset) => (
                        <div key={asset.truck_id} className="px-5 py-4">
                          <div className="font-semibold text-slate-100">
                            {asset.registration || asset.truck_id}
                          </div>
                          <div className="mt-1 text-sm text-slate-300">
                            {asset.location_label || "Location not labeled yet"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {formatCoordinate(asset.latitude)}, {formatCoordinate(asset.longitude)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            Last seen: {formatDateTime(asset.last_seen_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </aside>
            </section>
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

function TruckRow({ truck }: { truck: any }) {
  return (
    <article className="grid gap-4 px-5 py-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr] lg:items-center">
      <div>
        <div className="text-base font-semibold text-slate-100">
          {truck.registration || truck.truck_id}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {truck.provider_name || "Provider not specified"}
        </div>
      </div>

      <div className="text-sm text-slate-200">
        <div className="font-medium">Location</div>
        <div className="mt-1 text-slate-100">
          {truck.location_label || "Location not labeled yet"}
        </div>
        <div className="mt-1 text-slate-400">
          {formatCoordinate(truck.latitude)}, {formatCoordinate(truck.longitude)}
        </div>
      </div>

      <div className="text-sm text-slate-200">
        <div className="font-medium">Live readings</div>
        <div className="mt-1 text-slate-400">
          Speed: {formatValue(truck.speed, "km/h")} · Fuel: {formatValue(truck.fuel_level, "%")}
        </div>
      </div>

      <div className="text-sm text-slate-200 lg:text-right">
        <StatusPill value={truck.status || "active"} />
        <div className="mt-2 text-xs text-slate-400">
          {truck.freshness_minutes ?? "—"} min old · {formatDateTime(truck.last_seen_at)}
        </div>
      </div>
    </article>
  );
}

function EmptyState({
  noProviders,
  noAssets,
  noLiveLocations,
  freshnessMinutes,
}: {
  noProviders: boolean;
  noAssets: boolean;
  noLiveLocations: boolean;
  freshnessMinutes: number;
}) {
  let title = "No fresh live locations";
  let body = `No active fleet asset has reported a valid location in the last ${freshnessMinutes} minutes.`;

  if (noProviders) {
    title = "No tracking provider connected";
    body = "Connect a GPS or telemetry provider so Nava can begin receiving fleet locations.";
  } else if (noAssets) {
    title = "Provider connected, no fleet assets yet";
    body = "Your provider connection exists, but Nava has not received fleet assets yet.";
  } else if (noLiveLocations) {
    title = "No fresh live locations";
    body = `Fleet assets exist, but none have fresh valid coordinates in the last ${freshnessMinutes} minutes.`;
  }

  return (
    <section className="mt-8 rounded-lg border border-cyan-200/20 bg-cyan-300/10 p-5">
      <h2 className="text-lg font-semibold text-cyan-100">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{body}</p>
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
          ? "inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-100"
          : "inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100"
      }
    >
      {value || "unknown"}
    </span>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatCoordinate(value: any) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toFixed(5);
}

function formatValue(value: any, suffix: string) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toFixed(0)} ${suffix}`;
}
