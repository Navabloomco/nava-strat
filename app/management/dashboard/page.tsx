"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatusPill,
} from "../../components/ui/Primitives";

export default function ManagementDashboard() {
  const [data, setData] = useState<any>({
    summary: {
      total_revenue: 0,
      total_fuel_cost: 0,
      total_expenses: 0,
      estimated_profit: 0,
      active_journeys: 0,
      completed_journeys: 0,
      loss_making_journeys: 0,
    },
    journey_ranking: [],
    profit_by_client: [],
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setMessage("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/management/dashboard", {
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
      <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading Intelligence...</div>
        </Panel>
      </main>
    );
  }

  const stats = data.summary || {};
  const sortedJourneys = data.journey_ranking || [];
  const clientPerformance = data.profit_by_client || [];

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Management"
          title="Management Intelligence Center"
          body="Strategy and profitability view for journeys, clients, routes, and operating leakage."
        />

        {message && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <pre className="whitespace-pre-wrap text-sm text-rose-100">{message}</pre>
          </Panel>
        )}

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Total revenue"
            value={`${Number(stats.total_revenue || 0).toLocaleString()} KES`}
          />
          <MetricCard
            label="Net margin"
            value={`${Number(stats.estimated_profit || 0).toLocaleString()} KES`}
            tone={Number(stats.estimated_profit || 0) < 0 ? "danger" : "success"}
          />
          <MetricCard
            label="Leakage"
            value={`${stats.loss_making_journeys || 0} Journeys`}
            tone="danger"
          />
        </section>

        <section className="mt-8 grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <Panel dark className="p-5">
            <SectionTitle title="Journey ranking" subtitle="Worst first" />
            {sortedJourneys.length === 0 ? (
              <EmptyState
                dark
                title="No journey revenue data yet"
                body="Journey revenue data will appear here once rates and quantities are saved."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {sortedJourneys.map((journey: any) => (
                  <div
                    key={journey.id}
                    className={`grid gap-4 rounded-md border px-4 py-3 md:grid-cols-[1fr_auto] md:items-center ${
                      Number(journey.margin || 0) < 0
                        ? "border-rose-300/30 bg-rose-500/10"
                        : "border-emerald-300/20 bg-white/[0.04]"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-100">
                        {(journey.truck || "N/A").toUpperCase()} -{" "}
                        {(journey.client_name || "NO CLIENT").toUpperCase()}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.08em] text-slate-500">
                        {(journey.from_location || "UNKNOWN").toUpperCase()} →{" "}
                        {(journey.to_location || "UNKNOWN").toUpperCase()}
                      </div>
                    </div>
                    <div className="md:text-right">
                      <div
                        className={
                          Number(journey.margin || 0) < 0
                            ? "text-sm font-bold text-rose-100"
                            : "text-sm font-bold text-emerald-100"
                        }
                      >
                        {Number(journey.margin || 0).toLocaleString()} KES
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        REV: {Number(journey.revenue || 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel dark className="p-5">
            <SectionTitle title="Top clients by profit" />
            {clientPerformance.length === 0 ? (
              <EmptyState
                dark
                title="No client profitability data yet"
                body="Client profitability will appear once journey revenue and costs are available."
              />
            ) : (
              <div className="mt-4 grid gap-3">
                {clientPerformance.map((c: any) => (
                  <div
                    key={c.name}
                    className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">
                          {c.name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {c.count} Journeys | Total Rev:{" "}
                          {Number(c.revenue || 0).toLocaleString()}
                        </div>
                      </div>
                      <StatusPill tone={Number(c.margin || 0) < 0 ? "danger" : "success"}>
                        {Number(c.margin || 0).toLocaleString()} KES
                      </StatusPill>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
  tone?: "neutral" | "success" | "danger";
}) {
  const valueClass =
    tone === "danger"
      ? "text-rose-100"
      : tone === "success"
        ? "text-emerald-100"
        : "text-white";

  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div className={`mt-3 text-3xl font-semibold ${valueClass}`}>
        {value}
      </div>
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
