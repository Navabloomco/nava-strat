"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

type OpsData = {
  company?: any;
  journeys: any[];
  fleet_assets: any[];
  provider_statuses: any[];
  alerts: any[];
  shared_disruption_candidate?: any;
  summary?: any;
};

function normalizeTruck(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function freshnessLabel(lastSeenAt: string | null | undefined) {
  if (!lastSeenAt) return "No recent telemetry";
  const minutes = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "Telemetry time unknown";
  if (minutes < 1) return "Seen just now";
  if (minutes === 1) return "Seen 1 minute ago";
  return `Seen ${minutes} minutes ago`;
}

export default function OpsDashboard() {
  const [data, setData] = useState<OpsData>({
    journeys: [],
    fleet_assets: [],
    provider_statuses: [],
    alerts: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");
  const [sharedDisruptionDismissed, setSharedDisruptionDismissed] =
    useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/ops/dashboard", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Failed to load operations dashboard");
      setLoading(false);
      return;
    }

    setData({
      company: json.company,
      journeys: json.journeys || [],
      fleet_assets: json.fleet_assets || [],
      provider_statuses: json.provider_statuses || [],
      alerts: json.alerts || [],
      shared_disruption_candidate: json.shared_disruption_candidate || null,
      summary: json.summary || {},
    });
    setLoading(false);
  }

  const assetsByTruck = useMemo(() => {
    const map = new Map<string, any>();
    for (const asset of data.fleet_assets) {
      const keys = [
        normalizeTruck(asset.truck_id),
        normalizeTruck(asset.registration),
      ].filter(Boolean);
      for (const key of keys) map.set(key, asset);
    }
    return map;
  }, [data.fleet_assets]);

  const operations = useMemo(() => {
    return data.journeys
      .filter((journey) => String(journey.status || "").toLowerCase() === "active")
      .map((journey) => {
      const asset =
        assetsByTruck.get(normalizeTruck(journey.truck)) ||
        assetsByTruck.get(normalizeTruck(journey.truck_id));
      const relatedAlerts = data.alerts.filter(
        (alert) =>
          normalizeTruck(alert.truck_id) === normalizeTruck(journey.truck) ||
          normalizeTruck(alert.truck_id) === normalizeTruck(asset?.truck_id)
      );
      const highAlert = relatedAlerts.some((alert) => alert.severity === "high");

      return {
        journey,
        asset,
        relatedAlerts,
        truck: journey.truck || asset?.registration || asset?.truck_id || "No truck",
        client: journey.client_name || "No client",
        route:
          journey.from_location || journey.to_location
            ? `${journey.from_location || "Unknown origin"} -> ${
                journey.to_location || "Unknown destination"
              }`
            : "No route saved",
        driver: journey.driver || "No driver",
        location:
          asset?.latitude && asset?.longitude
            ? `${Number(asset.latitude).toFixed(5)}, ${Number(asset.longitude).toFixed(5)}`
            : "No current location",
        status: asset?.last_seen_at ? freshnessLabel(asset.last_seen_at) : "No fleet match",
        risk: highAlert ? "High alert" : relatedAlerts.length ? "Review alerts" : "No recent alerts",
      };
      });
  }, [assetsByTruck, data.alerts, data.journeys]);

  const importedButNoneEnabled =
    (data.summary?.imported_assets || 0) > 0 &&
    (data.summary?.enabled_assets || 0) === 0;
  const sharedDisruption = data.shared_disruption_candidate;
  const showSharedDisruption =
    Boolean(sharedDisruption?.detected) && !sharedDisruptionDismissed;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading operations dashboard...</div>
        </Panel>
      </main>
    );
  }

  if (errorDetail) {
    return (
      <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
        <Panel dark className="border-rose-300/30 bg-rose-500/10 p-6">
          <h1 className="text-2xl font-semibold text-rose-100">
            Operations unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-rose-100">{errorDetail}</p>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Ops Command Center"
          body={`${data.company?.name || "Company"} real-time operations`}
        />

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Metric label="Active journeys" value={data.summary?.active_journeys || 0} />
          <Metric label="Online assets" value={data.summary?.online_assets || 0} accent />
          <Metric label="Alerts" value={data.summary?.alert_count || 0} />
        </section>

        {importedButNoneEnabled && (
          <section className="mt-8">
            <EmptyState
              dark
              title="No enabled intelligence vehicles yet"
              body="No enabled intelligence vehicles yet. Imported provider assets must be reviewed before they appear in operations."
            />
          </section>
        )}

        {showSharedDisruption && (
          <Panel dark className="mt-8 border-amber-300/30 bg-amber-300/10 p-5">
            <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-100">
                  Shared delay watch
                </div>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  Shared delay pattern detected
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200">
                  Multiple enabled assets are stopped or idle around the same period.
                  This may be a shared operational delay rather than separate vehicle issues.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full border border-amber-200/30 bg-amber-200/10 px-3 py-1 font-semibold text-amber-100">
                    {sharedDisruption.affected_count} of{" "}
                    {sharedDisruption.enabled_assets} assets affected
                  </span>
                  <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 font-semibold text-cyan-100">
                    {sharedDisruption.affected_percentage}% in last{" "}
                    {sharedDisruption.window_minutes} minutes
                  </span>
                </div>
                <div className="mt-5">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    Suggested context labels
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(sharedDisruption.suggested_reasons || []).map((reason: string) => (
                      <span
                        key={reason}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-400">
                  Context application is coming next. No alerts are changed yet.
                </p>
              </div>

              <div className="flex flex-col gap-2 lg:min-w-48">
                <button
                  type="button"
                  disabled
                  className="rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-400 opacity-70"
                >
                  Apply to all affected
                </button>
                <button
                  type="button"
                  disabled
                  className="rounded-md border border-white/10 px-4 py-2 text-sm font-semibold text-slate-400 opacity-70"
                >
                  Choose assets
                </button>
                <button
                  type="button"
                  onClick={() => setSharedDisruptionDismissed(true)}
                  className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
                >
                  Dismiss for now
                </button>
              </div>
            </div>
          </Panel>
        )}

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Panel dark className="p-5">
            <SectionTitle title="Provider status" />
            {data.provider_statuses.length === 0 ? (
              <EmptyState
                dark
                title="No provider data"
                body="No provider data configured for this company."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {data.provider_statuses.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-100">
                        {provider.provider_name || "Provider"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Last sync: {provider.last_sync_at || "none yet"}
                      </div>
                    </div>
                    <StatusPill tone={provider.status === "active" || provider.status === "success" ? "success" : "warning"}>
                      {provider.status || "unknown"}
                    </StatusPill>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel dark className="p-5">
            <SectionTitle title="Operational alerts" />
            {data.alerts.length === 0 ? (
              <EmptyState
                dark
                title="No telemetry alerts"
                body="No recent telemetry alerts for this company."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {data.alerts.slice(0, 5).map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-md border px-4 py-3 ${
                      alert.severity === "high"
                        ? "border-rose-300/30 bg-rose-500/10"
                        : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm font-semibold text-slate-100">
                        {alert.truck_id || "Unknown asset"} - {alert.event_type || "Event"}
                      </div>
                      <StatusPill tone={alert.severity === "high" ? "danger" : "warning"}>
                        {alert.severity || "event"}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {alert.location_name || alert.created_at || "No event detail"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="mt-8">
          <div className="mb-4">
            <SectionTitle title="Active operations" />
          </div>
          {operations.length === 0 ? (
            <EmptyState
              dark
              title="No active operations yet"
              body="Create a journey to start tracking movement, fuel, expenses, and delivery progress."
              action={
                <Link href="/ops/journey/new">
                  <PrimaryButton type="button">Create journey</PrimaryButton>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {operations.map((op) => (
                <Panel
                  key={op.journey.id}
                  dark
                  className={`p-5 ${
                    op.risk === "High alert"
                      ? "border-rose-300/30"
                      : "border-emerald-300/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-slate-100">
                        {op.truck}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
                        {op.client}
                      </div>
                    </div>
                    <StatusPill tone="info">{op.journey.status || "unknown"}</StatusPill>
                  </div>

                  <div className="mt-5 grid gap-3 text-sm">
                    <Detail label="Route" value={op.route} />
                    <Detail label="Location" value={op.location} />
                    <Detail label="Driver" value={op.driver} />
                  </div>

                  <div className="mt-5 border-t border-white/10 pt-4">
                    <div className="text-xs text-slate-400">{op.status}</div>
                    <div
                      className={
                        op.risk === "High alert"
                          ? "mt-1 text-xs font-bold text-rose-200"
                          : "mt-1 text-xs font-bold text-cyan-100"
                      }
                    >
                      {op.risk}
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </section>
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
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={accent ? "mt-3 text-3xl font-semibold text-cyan-200" : "mt-3 text-3xl font-semibold text-white"}>
        {value}
      </div>
    </Panel>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
      {title}
    </h2>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}
