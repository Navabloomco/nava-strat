"use client";

import type { ReactNode } from "react";
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

type RangeValue = "today" | "yesterday" | "7d";

type EfficiencyState = {
  efficiency: any | null;
  tripIntelligence: any | null;
};

const rangeOptions: Array<{ value: RangeValue; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
];

export default function OpsEfficiencyPage() {
  const [range, setRange] = useState<RangeValue>(() => initialRangeFromUrl());
  const [data, setData] = useState<EfficiencyState>({
    efficiency: null,
    tripIntelligence: null,
  });
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

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

    const query = new URLSearchParams({ range });
    const companyId =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search).get("companyId");
    if (companyId) query.set("companyId", companyId);

    const headers = {
      Authorization: `Bearer ${session.access_token}`,
    };

    const [efficiencyRes, tripsRes] = await Promise.all([
      fetch(`/api/ops/efficiency?${query.toString()}`, {
        cache: "no-store",
        headers,
      }),
      fetch(`/api/ops/trip-intelligence?${query.toString()}`, {
        cache: "no-store",
        headers,
      }),
    ]);

    const [efficiencyJson, tripsJson] = await Promise.all([
      efficiencyRes.json(),
      tripsRes.json(),
    ]);

    if (!efficiencyRes.ok || !efficiencyJson.success) {
      setErrorDetail(friendlyError(efficiencyRes.status, efficiencyJson.error));
      setLoading(false);
      return;
    }

    if (!tripsRes.ok || !tripsJson.success) {
      setErrorDetail(friendlyError(tripsRes.status, tripsJson.error));
      setLoading(false);
      return;
    }

    setData({
      efficiency: efficiencyJson,
      tripIntelligence: tripsJson,
    });
    setLoading(false);
  }

  const summaries = data.efficiency?.summaries || {};
  const movement = summaries.movement || {};
  const idle = summaries.idle || {};
  const stale = summaries.stale_locations || {};
  const productivity = summaries.productivity || {};
  const driverEfficiency = summaries.driver_efficiency || {};
  const clientWaiting = summaries.client_waiting || {};
  const tripSummary = data.tripIntelligence?.summary || {};
  const tripMissingSummary = data.tripIntelligence?.missing_data_summary || {};
  const trips = Array.isArray(data.tripIntelligence?.trips)
    ? data.tripIntelligence.trips
    : [];
  const contributionReadyCount = Number(
    tripSummary.contribution_review_ready_count ??
      tripSummary.ready_for_profit_review_count ??
      0
  );
  const incompleteTripCount = Number(tripSummary.partially_linked_count || 0) +
    Number(tripSummary.not_enough_linked_data_count || 0);

  const tripFlagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const trip of trips) {
      for (const flag of trip.management_flags || []) {
        counts[flag] = (counts[flag] || 0) + 1;
      }
    }
    return counts;
  }, [trips]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading efficiency intelligence...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Efficiency Intelligence"
          body="A pilot view of movement, stopped-time evidence, trip readiness, and missing links. This page explains operational evidence; it does not replace provider maps or invent fuel/profit conclusions."
          actions={
            <div className="flex flex-wrap gap-2">
              {rangeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRange(option.value)}
                  className={`rounded-md border px-4 py-3 text-sm font-semibold ${
                    range === option.value
                      ? "border-cyan-200 bg-cyan-300 text-slate-950"
                      : "border-white/15 text-slate-100 hover:bg-white/10"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />

        {errorDetail ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="Operational efficiency unavailable"
              body={errorDetail}
              action={
                <PrimaryButton type="button" onClick={load}>
                  Try again
                </PrimaryButton>
              }
            />
          </div>
        ) : (
          <>
            <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
              <div className="flex flex-wrap items-center gap-3 text-sm text-cyan-50">
                <span>{data.efficiency?.company?.name || "Company"} efficiency view</span>
                <StatusPill tone="info">
                  {data.efficiency?.timeframe?.display_label || range}
                </StatusPill>
                <span className="text-cyan-100">
                  Times and dates follow the company operational timezone.
                </span>
              </div>
            </Panel>

            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Trucks with distance"
                value={formatCount(movement.trucks_with_distance)}
                detail={movement.evidence_label || "Distance evidence unavailable"}
              />
              <MetricCard
                label="Stopped-time trucks"
                value={formatCount(idle.gps_stopped_truck_count)}
                detail={idle.evidence_label || "Stopped-time evidence unavailable"}
              />
              <MetricCard
                label="Stale locations"
                value={formatCount(stale.stale_count)}
                detail={`Threshold: ${formatCount(stale.stale_threshold_minutes)} min`}
                tone={Number(stale.stale_count || 0) > 0 ? "warning" : "success"}
              />
              <MetricCard
                label="Trips projected"
                value={formatCount(tripSummary.trip_count)}
                detail={`${formatCount(contributionReadyCount)} contribution review ready`}
              />
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-2">
              <RankedPanel
                title="Trucks Moved Most"
                subtitle={movement.evidence_label}
                emptyTitle="No movement evidence"
                emptyBody="No provider-reported or GPS-estimated distance was found for this range."
                rows={(movement.top_movers || []).slice(0, 8)}
                renderRow={(truck: any) => (
                  <RankRow
                    key={truck.truck_key || truck.truck_id}
                    title={truck.truck_id || "Unknown truck"}
                    metric={`${formatKm(truck.distance_km)} km`}
                    detail={`${truck.distance_source || "unavailable"} distance`}
                  />
                )}
              />

              <RankedPanel
                title="Stopped Most"
                subtitle={productivity.evidence_label || idle.evidence_label}
                emptyTitle="No stopped-time evidence"
                emptyBody="Stopped-time ranking needs enough GPS point intervals in the selected range."
                rows={(productivity.stopped_most_of_day || idle.top_stopped_by_gps || []).slice(0, 8)}
                renderRow={(truck: any) => (
                  <RankRow
                    key={truck.truck_key || truck.truck_id}
                    title={truck.truck_id || "Unknown truck"}
                    metric={`${formatMinutes(truck.stopped_minutes)} estimated`}
                    detail={`${formatStoppedConfidence(truck)} · ${formatPercent(truck.productive_ratio ?? truck.stopped_share)} observed-interval ratio`}
                  />
                )}
              />

              <RankedPanel
                title="Low Productive-Time Trucks"
                subtitle={productivity.evidence_label}
                emptyTitle="No low productive-time exceptions"
                emptyBody="No trucks met the low productive-time threshold for this range."
                rows={(productivity.low_productive_trucks || []).slice(0, 8)}
                renderRow={(truck: any) => (
                  <RankRow
                    key={truck.truck_key || truck.truck_id}
                    title={truck.truck_id || "Unknown truck"}
                    metric={formatPercent(truck.productive_ratio)}
                    detail={`${formatKm(truck.distance_km)} km, ${formatMinutes(truck.stopped_minutes)} stopped estimate · ${formatStoppedConfidence(truck)}`}
                  />
                )}
              />

              <RankedPanel
                title="Idle Marker Windows"
                subtitle={idle.evidence_label}
                emptyTitle="No idle marker windows"
                emptyBody="No idle/excessive-idle marker windows were found, or event evidence is not available."
                rows={(idle.top_idle_alert_windows || []).slice(0, 8)}
                renderRow={(truck: any) => (
                  <RankRow
                    key={truck.truck_key || truck.truck_id}
                    title={truck.truck_id || "Unknown truck"}
                    metric={formatMinutes(truck.total_alert_span_minutes)}
                    detail={`${formatCount(truck.alert_window_count)} window(s), ${formatCount(truck.marker_count)} marker(s)`}
                  />
                )}
              />
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel dark className="p-5">
                <SectionTitle
                  title="Trip Intelligence"
                  subtitle="Projected from journeys and linked evidence. Profit appears only when revenue and linked costs are safe."
                />
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <SmallStat
                    label="Contribution review ready"
                    value={formatCount(contributionReadyCount)}
                  />
                  <SmallStat
                    label="Need finance linking"
                    value={formatCount(tripFlagCounts.needs_finance_linking)}
                  />
                  <SmallStat
                    label="Missing driver"
                    value={formatCount(tripFlagCounts.missing_driver)}
                  />
                </div>

                {trips.length === 0 ? (
                  <InlineEmpty
                    title="No trips projected"
                    body={
                      data.tripIntelligence?.empty_state?.message ||
                      "No real journey records are linked for this period yet."
                    }
                  />
                ) : (
                  <div className="mt-5 grid gap-3">
                    {trips.slice(0, 8).map((trip: any) => (
                      <TripRow key={trip.trip_identity?.journey_id} trip={trip} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel dark className="p-5">
                <SectionTitle
                  title="Missing Data"
                  subtitle="These are the links blocking stronger trip conclusions."
                />
                <div className="mt-4 grid gap-3">
                  {Object.keys(tripMissingSummary || {}).length === 0 ? (
                    <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">
                      No repeated missing-data pattern appears in the projected trips.
                    </div>
                  ) : (
                    Object.entries(tripMissingSummary)
                      .sort((a: any, b: any) => Number(b[1]) - Number(a[1]))
                      .slice(0, 8)
                      .map(([label, count]) => (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                        >
                          <span className="text-sm text-slate-200">{missingDataLabel(label)}</span>
                          <StatusPill tone="warning">{formatCount(count)}</StatusPill>
                        </div>
                      ))
                  )}
                </div>
              </Panel>
            </section>

            <section className="mt-8 grid gap-6 lg:grid-cols-3">
              <ReadinessPanel
                title="Driver Efficiency Ranking"
                item={driverEfficiency}
                fallback="Driver efficiency needs movement linked to overlapping driver assignments. Standing assignments are cautionary evidence, not trip-level proof."
              />
              <ReadinessPanel
                title="Client Waiting Ranking"
                item={clientWaiting}
                fallback="Client waiting needs stop or idle evidence linked to client sites, geofences, or journey legs."
              />
              <ReadinessPanel
                title="Trip Profitability"
                item={{
                  status:
                    contributionReadyCount > 0
                      ? "available_with_caution"
                      : incompleteTripCount > 0
                        ? "not_enough_linked_data"
                        : "available",
                  reason: tripProfitabilityReason(
                    contributionReadyCount,
                    incompleteTripCount,
                    Number(tripSummary.trip_count || 0)
                  ),
                  evidence_label:
                    "journey revenue minus linked fuel/expense cost evidence; per-km metrics need distance",
                }}
                fallback="Profitability requires linked revenue and cost evidence. Unlinked costs are not used for exact trip contribution."
              />
            </section>

            <section className="mt-8">
              <Panel dark className="p-5">
                <SectionTitle title="Evidence Sources" />
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <EvidenceSource label="Provider reports" source={data.efficiency?.data_sources?.provider_trip_summaries} />
                  <EvidenceSource label="GPS telemetry" source={data.efficiency?.data_sources?.telemetry_logs} />
                  <EvidenceSource label="Idle events" source={data.efficiency?.data_sources?.telemetry_events} />
                  <EvidenceSource label="Trip records" source={data.tripIntelligence?.data_sources?.journeys} />
                </div>
              </Panel>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function RankedPanel({
  title,
  subtitle,
  emptyTitle,
  emptyBody,
  rows,
  renderRow,
}: {
  title: string;
  subtitle?: string;
  emptyTitle: string;
  emptyBody: string;
  rows: any[];
  renderRow: (row: any) => ReactNode;
}) {
  return (
    <Panel dark className="p-5">
      <SectionTitle title={title} subtitle={subtitle} />
      {!rows.length ? (
        <InlineEmpty title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="mt-4 grid gap-3">{rows.map(renderRow)}</div>
      )}
    </Panel>
  );
}

function InlineEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

function RankRow({
  title,
  metric,
  detail,
}: {
  title: string;
  metric: string;
  detail: string;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="break-words text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
      </div>
      <div className="text-sm font-bold text-cyan-100 sm:text-right">{metric}</div>
    </div>
  );
}

function TripRow({ trip }: { trip: any }) {
  const identity = trip.trip_identity || {};
  const movement = trip.movement_evidence || {};
  const readiness = trip.profitability_readiness || {};
  const contribution = readiness.contribution_summary || {};
  const flags = trip.management_flags || [];
  const route = identity.route?.route_label || "Route missing";
  const showContribution = Boolean(contribution.ready_for_contribution_review);

  const content = (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4 transition hover:border-cyan-200/40 hover:bg-cyan-300/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-white">
            {identity.reference || "Trip reference pending"}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-400">
            {identity.truck || "No truck"} - {identity.client_name || "No client"} - {route}
          </div>
        </div>
        <StatusPill tone={readinessTone(readiness.status)}>
          {readinessLabel(readiness)}
        </StatusPill>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
        <span>Distance: {movement.distance_km ? `${formatKm(movement.distance_km)} km` : "Unavailable"}</span>
        <span>Source: {movement.distance_source || "unavailable"}</span>
        <span>Flags: {flags.length ? flags.slice(0, 3).map(humanize).join(", ") : "None"}</span>
      </div>
      {showContribution && (
        <div className="mt-3 grid gap-2 rounded-md border border-emerald-300/15 bg-emerald-300/10 p-3 text-xs leading-5 text-emerald-50 sm:grid-cols-4">
          <span>Revenue: {formatCurrency(contribution.revenue_amount)}</span>
          <span>Linked cost: {formatCurrency(contribution.linked_variable_cost)}</span>
          <span>Contribution: {formatCurrency(contribution.contribution_amount)}</span>
          <span>Margin: {formatPercentValue(contribution.contribution_margin_percent)}</span>
        </div>
      )}
      {Array.isArray(readiness.supporting_notes) && readiness.supporting_notes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {readiness.supporting_notes.slice(0, 3).map((note: string) => (
            <StatusPill key={note} tone="info">
              {note}
            </StatusPill>
          ))}
        </div>
      )}
    </div>
  );

  const companyId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("companyId");
  const companyQuery = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";

  return identity.journey_id ? (
    <Link href={`/ops/journey/${identity.journey_id}${companyQuery}`}>{content}</Link>
  ) : (
    content
  );
}

function ReadinessPanel({
  title,
  item,
  fallback,
}: {
  title: string;
  item: any;
  fallback: string;
}) {
  const status = item?.status || "not_enough_linked_data";
  const enough = status === "available" || status === "available_with_caution";
  return (
    <Panel dark className="p-5">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle title={title} subtitle={item?.evidence_label || "Evidence unavailable"} />
        <StatusPill tone={enough ? "success" : "warning"}>
          {humanize(status)}
        </StatusPill>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">
        {item?.reason || fallback}
      </p>
      {Array.isArray(item?.missing) && item.missing.length > 0 && (
        <div className="mt-3 text-xs leading-5 text-amber-100">
          Missing: {item.missing.map(humanize).join(", ")}
        </div>
      )}
    </Panel>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-100"
      : tone === "warning"
        ? "text-amber-100"
        : "text-white";

  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={`mt-3 text-3xl font-semibold ${valueClass}`}>{value}</div>
      <div className="mt-2 text-xs leading-5 text-slate-400">{detail}</div>
    </Panel>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function EvidenceSource({ label, source }: { label: string; source: any }) {
  const status = source?.status || "unavailable";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill tone={status === "available" ? "success" : status === "missing" ? "danger" : "neutral"}>
          {humanize(status)}
        </StatusPill>
        <span className="text-xs text-slate-400">{formatCount(source?.row_count)} rows</span>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>}
    </div>
  );
}

function friendlyError(status: number, error?: string) {
  if (status === 401 || status === 403) {
    return "You do not have access to operational efficiency for this company.";
  }
  return error || "Unable to load operational efficiency right now.";
}

function readinessTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "calculable") return "success";
  if (status === "partially_linked") return "warning";
  if (status === "not_enough_linked_data") return "danger";
  return "neutral";
}

function readinessLabel(readiness: any) {
  if (readiness?.label || readiness?.customer_label) {
    return readiness.label || readiness.customer_label;
  }
  if (readiness?.status === "calculable") return "Contribution review ready";
  return humanize(readiness?.status || "not_enough_linked_data");
}

function missingDataLabel(value: any) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "missing distance") return "Distance evidence missing";
  if (key === "missing linked expenses") return "Other expenses missing";
  if (key === "missing linked cost evidence") return "Linked cost evidence missing";
  if (key === "fuel allocation missing") return "Fuel allocation missing";
  return humanize(value);
}

function tripProfitabilityReason(
  contributionReadyCount: number,
  incompleteTripCount: number,
  tripCount: number
) {
  if (tripCount <= 0) {
    return "No production trips are projected for this range yet.";
  }
  if (contributionReadyCount > 0) {
    const noun = contributionReadyCount === 1 ? "trip has" : "trips have";
    return `${formatCount(contributionReadyCount)} ${noun} enough linked revenue and fuel/cost evidence for contribution review. Distance or extra expense links may still be incomplete.`;
  }
  if (incompleteTripCount > 0) {
    return `${formatCount(incompleteTripCount)} trip(s) still need linked revenue or linked cost evidence before contribution review is safe.`;
  }
  return "Projected trips with available finance evidence are ready for contribution review.";
}

function formatCount(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString();
}

function formatKm(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, {
    maximumFractionDigits: number % 1 === 0 ? 0 : 2,
  });
}

function formatCurrency(value: any) {
  if (value === null || value === undefined || value === "") return "Pending";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Pending";
  return `KES ${number.toLocaleString(undefined, {
    maximumFractionDigits: number % 1 === 0 ? 0 : 2,
  })}`;
}

function formatPercentValue(value: any) {
  if (value === null || value === undefined || value === "") return "Pending";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Pending";
  return `${number.toLocaleString(undefined, {
    maximumFractionDigits: number % 1 === 0 ? 0 : 1,
  })}%`;
}

function formatMinutes(value: any) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function formatPercent(value: any) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  const percent = number <= 1 ? number * 100 : number;
  return `${Math.round(percent)}%`;
}

function formatStoppedConfidence(row: any) {
  const confidence = String(row?.confidence || row?.stopped_time_confidence || "").trim();
  const reason = String(row?.confidence_reason || row?.stopped_time_confidence_reason || "").trim();
  const points = Number(row?.point_count || row?.telemetry_points || 0);
  const intervals = Number(row?.interval_count || row?.stopped_interval_count || 0);
  const gapCount = Number(row?.large_gap_count || row?.stopped_large_gap_count || 0);
  const parts = [
    confidence ? `${humanize(confidence)} confidence` : "Estimated from GPS",
    points || intervals ? `${formatCount(points)} GPS points / ${formatCount(intervals)} intervals` : null,
    row?.capped_estimate || row?.stopped_time_capped_estimate
      ? `${formatCount(gapCount)} long gap(s) excluded`
      : null,
    reason || null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function humanize(value: any) {
  const text = String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Unavailable";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function initialRangeFromUrl(): RangeValue {
  if (typeof window === "undefined") return "yesterday";
  const value = new URLSearchParams(window.location.search).get("range");
  return value === "today" || value === "7d" || value === "yesterday"
    ? value
    : "yesterday";
}
