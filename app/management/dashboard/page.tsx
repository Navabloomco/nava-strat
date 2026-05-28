"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

const ranges = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export default function ManagementDashboard() {
  const [data, setData] = useState<any>({
    summary: {},
    trip_velocity_ranking: [],
    client_contribution_velocity: [],
    delay_summary: { categories: [] },
    evidence_caveats: [],
  });
  const [range, setRange] = useState("7d");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    load(range);
  }, [range]);

  async function load(selectedRange = range) {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const query = new URLSearchParams();
    query.set("range", selectedRange);
    if (typeof window !== "undefined") {
      const companyId = new URLSearchParams(window.location.search).get("companyId");
      if (companyId) query.set("companyId", companyId);
    }

    const res = await fetch(`/api/management/dashboard?${query.toString()}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setMessage(json.error || "Failed to load management dashboard.");
      setLoading(false);
      return;
    }

    setData(json);
    setLoading(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading management intelligence...</div>
        </Panel>
      </main>
    );
  }

  const stats = data.summary || {};
  const tripVelocity = data.trip_velocity_ranking || [];
  const clientVelocity = data.client_contribution_velocity || [];
  const delayCategories = data.delay_summary?.categories || [];
  const periodLabel = data.timeframe?.display_label || rangeLabel(range);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Management"
          title="Management Intelligence Center"
          body="Contribution velocity, trip-cycle performance, and operational drag for the selected period."
        />

        {message && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <pre className="whitespace-pre-wrap text-sm text-rose-100">{message}</pre>
          </Panel>
        )}

        <Panel dark className="mt-6 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Selected period</div>
              <div className="mt-1 text-sm text-slate-400">{periodLabel}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ranges.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setRange(item.value)}
                  className={
                    range === item.value
                      ? "rounded-md border border-cyan-200/40 bg-cyan-300/15 px-3 py-2 text-sm font-semibold text-cyan-50"
                      : "rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-300 hover:border-cyan-200/30 hover:text-white"
                  }
                >
                  {item.label}
                </button>
              ))}
              <SecondaryButton type="button" onClick={() => load(range)}>
                Refresh
              </SecondaryButton>
            </div>
          </div>
        </Panel>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Review-ready contribution"
            value={`KES ${formatMoney(stats.review_ready_contribution)}`}
          />
          <MetricCard
            label="Contribution per active day"
            value={
              hasNumericValue(stats.average_contribution_per_day)
                ? `KES ${formatMoney(stats.average_contribution_per_day)}`
                : "Pending"
            }
            tone={hasNumericValue(stats.average_contribution_per_day) ? "success" : "neutral"}
          />
          <MetricCard
            label="Trips reviewed"
            value={`${stats.trips_reviewed || 0} of ${stats.trip_count || 0}`}
          />
          <MetricCard
            label="Trips needing review"
            value={`${stats.trips_needing_review || 0}`}
            tone={Number(stats.trips_needing_review || 0) > 0 ? "warning" : "success"}
          />
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <Panel dark className="p-5">
            <SectionTitle
              title="Trip contribution velocity"
              subtitle={`Ranked by contribution per active day for ${periodLabel}`}
            />
            {tripVelocity.length === 0 ? (
              <EmptyState
                dark
                title="No review-ready Trip contribution yet"
                body="Trips need linked revenue and linked cost evidence before contribution velocity can be ranked."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {tripVelocity.map((trip: any) => (
                  <div
                    key={trip.id}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="break-words text-sm font-semibold text-slate-100">
                            {trip.reference || trip.truck || "Trip"}
                          </div>
                          {trip.provisional && <StatusPill tone="warning">Provisional</StatusPill>}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.08em] text-slate-500">
                          {(trip.client_name || "Client missing").toUpperCase()} |{" "}
                          {(trip.route || "Route missing").toUpperCase()}
                        </div>
                        <div className="mt-2 text-sm text-slate-300">
                          {trip.truck || "Truck missing"} | {trip.duration_label || "Duration pending"}
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm lg:min-w-[240px] lg:text-right">
                        <div className="font-bold text-emerald-100">
                          {hasNumericValue(trip.contribution_per_day)
                            ? `KES ${formatMoney(trip.contribution_per_day)} / active day`
                            : "Duration pending"}
                        </div>
                        <div className="text-slate-300">
                          Contribution: KES {formatMoney(trip.contribution_amount)}
                        </div>
                        <div className="text-xs text-slate-500">
                          {trip.estimated_trips_per_week
                            ? `${formatNumber(trip.estimated_trips_per_week)} trips/week potential`
                            : "Trips/week potential pending"}
                        </div>
                      </div>
                    </div>
                    {trip.delay_evidence_present && (
                      <div className="mt-3 rounded-md border border-amber-200/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-50">
                        Delay evidence present. Cause is shown below only where attribution is safe.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel dark className="p-5">
            <SectionTitle
              title="Client contribution velocity"
              subtitle="Contribution speed by client across reviewed Trips"
            />
            {clientVelocity.length === 0 ? (
              <EmptyState
                dark
                title="No client velocity data yet"
                body="Client contribution velocity appears after Trips have review-ready contribution and duration evidence."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {clientVelocity.map((client: any) => (
                  <div
                    key={client.name}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-slate-100">
                          {client.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {client.trip_count} Trips | Avg duration{" "}
                          {client.average_duration_days
                            ? `${formatNumber(client.average_duration_days)} days`
                            : "pending"}
                        </div>
                      </div>
                      <StatusPill tone="success">
                        {hasNumericValue(client.average_contribution_per_day)
                          ? `KES ${formatMoney(client.average_contribution_per_day)} / day`
                          : "Duration pending"}
                      </StatusPill>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-400">
                      <div>Total contribution: KES {formatMoney(client.total_contribution)}</div>
                      <div>
                        Average contribution/trip: KES{" "}
                        {formatMoney(client.average_contribution_per_trip)}
                      </div>
                      <div>
                        {client.estimated_trips_per_week
                          ? `${formatNumber(client.estimated_trips_per_week)} trips/week potential`
                          : "Trips/week potential pending"}
                        {client.provisional_trip_count
                          ? ` | ${client.provisional_trip_count} active/provisional`
                          : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Panel dark className="p-5">
            <SectionTitle
              title="Operational drag"
              subtitle="GPS-stopped evidence, provider and legacy idle markers, and delay evidence by safe attribution"
            />
            {delayCategories.length === 0 ? (
              <EmptyState
                dark
                title="No delay evidence in this period"
                body="Delay categories appear when Trip-linked provider markers or GPS-stopped evidence is available."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {delayCategories.map((category: any) => (
                  <div
                    key={category.category}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {category.label}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {category.trip_count} Trips | {category.event_count} events
                        </div>
                      </div>
                      <StatusPill tone={category.client_blame_allowed ? "warning" : "neutral"}>
                        {category.duration_hours
                          ? `${formatNumber(category.duration_hours)} hours`
                          : "Duration pending"}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      {category.client_blame_allowed
                        ? "Client waiting is shown only because explicit client/customer delay evidence exists."
                        : "Operational drag, not client blame or engine-on idle proof."}
                      {category.evidence_label ? ` ${category.evidence_label}.` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel dark className="p-5">
            <SectionTitle title="Evidence caveats" subtitle="What management can safely conclude" />
            <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-300">
              {(data.evidence_caveats || []).map((caveat: string) => (
                <div key={caveat} className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                  {caveat}
                </div>
              ))}
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
                Selected period: {periodLabel}. All rankings are company-scoped and use reviewed Trip evidence only.
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger" | "warning";
}) {
  const valueClass =
    tone === "danger"
      ? "text-rose-100"
      : tone === "warning"
        ? "text-amber-100"
        : tone === "success"
          ? "text-emerald-100"
          : "text-white";

  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={`mt-3 text-2xl font-semibold ${valueClass}`}>{value}</div>
    </Panel>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

function rangeLabel(value: string) {
  return ranges.find((range) => range.value === value)?.label || value;
}

function formatMoney(value: any) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatNumber(value: any) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function hasNumericValue(value: any) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}
