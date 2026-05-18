"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../components/ui/Primitives";

export default function FuelControlPage() {
  const [fuelLogs, setFuelLogs] = useState<any[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/fuel", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Failed to load fuel data");
      setLoading(false);
      return;
    }

    setFuelLogs(json.fuel_logs || []);
    setJourneys(json.journeys || []);
    setLoading(false);
  }

  function findJourney(journeyId: string | null) {
    if (!journeyId) return null;
    return journeys.find((j) => j.id === journeyId) || null;
  }

  function isDuplicateFuel(fuel: any) {
    return (
      fuelLogs.filter((f) => {
        const sameTruck = f.truck_text === fuel.truck_text;
        const sameLiters = f.liters === fuel.liters;

        const timeDiff =
          Math.abs(
            new Date(f.created_at).getTime() -
              new Date(fuel.created_at).getTime()
          ) < 1000 * 60 * 60;

        return sameTruck && sameLiters && timeDiff;
      }).length > 1
    );
  }

  function totalFuelForJourney(journeyId: string) {
    return fuelLogs
      .filter((f) => f.journey_id === journeyId)
      .reduce((sum, f) => sum + Number(f.liters || 0), 0);
  }

  const totalLiters = fuelLogs.reduce(
    (sum, fuel) => sum + Number(fuel.liters || 0),
    0
  );
  const totalCost = fuelLogs.reduce(
    (sum, fuel) => sum + Number(fuel.total_cost || 0),
    0
  );
  const unallocatedRecords = fuelLogs.filter((fuel) => !fuel.journey_id).length;

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Fuel Control"
          body="Allocated and unallocated fuel records, duplicate detection, and expected fuel variance."
          actions={
            <Link href="/fuel/new">
              <PrimaryButton type="button">Add fuel</PrimaryButton>
            </Link>
          }
        />

        {loading ? (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading fuel data...</div>
          </Panel>
        ) : errorDetail ? (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{errorDetail}</div>
          </Panel>
        ) : (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Fuel records" value={fuelLogs.length.toLocaleString()} />
              <SummaryCard label="Total liters" value={totalLiters.toLocaleString()} />
              <SummaryCard label="Total cost" value={totalCost.toLocaleString()} />
              <SummaryCard
                label="Unallocated"
                value={unallocatedRecords.toLocaleString()}
                warning={unallocatedRecords > 0}
              />
            </section>

            {fuelLogs.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  dark
                  title="No fuel records yet"
                  body="Add your first fuel entry and link it to an open journey when available."
                  action={
                    <Link href="/fuel/new">
                      <PrimaryButton type="button">Add first fuel entry</PrimaryButton>
                    </Link>
                  }
                />
              </div>
            ) : (
              <Panel dark className="mt-8 overflow-hidden">
                <div className="border-b border-white/10 px-5 py-4">
                  <h2 className="text-lg font-semibold">Fuel ledger</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Review allocation, duplicate risk, and journey-level fuel variance.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                    <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Truck</th>
                        <th className="px-4 py-3 font-semibold">Liters</th>
                        <th className="px-4 py-3 font-semibold">Cost</th>
                        <th className="px-4 py-3 font-semibold">Fuel Provider</th>
                        <th className="px-4 py-3 font-semibold">Client</th>
                        <th className="px-4 py-3 font-semibold">Route</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Fuel Variance</th>
                        <th className="px-4 py-3 font-semibold">Approval</th>
                        <th className="px-4 py-3 font-semibold">Notes</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/10 text-slate-200">
                      {fuelLogs.map((fuel) => {
                        const journey = findJourney(fuel.journey_id);
                        const duplicate = isDuplicateFuel(fuel);

                        const journeyFuel = journey ? totalFuelForJourney(journey.id) : 0;
                        const expected =
                          journey && journey.expected_fuel_liters !== null
                            ? Number(journey.expected_fuel_liters)
                            : null;

                        const variance =
                          expected !== null ? journeyFuel - expected : null;

                        return (
                          <tr
                            key={fuel.id}
                            className={
                              duplicate
                                ? "bg-rose-500/10"
                                : "bg-transparent hover:bg-white/[0.03]"
                            }
                          >
                            <td className="px-4 py-4 font-semibold text-white">
                              {fuel.truck_text || "—"}
                            </td>

                            <td className="px-4 py-4">{fuel.liters || "—"}</td>

                            <td className="px-4 py-4">
                              {fuel.total_cost
                                ? Number(fuel.total_cost).toLocaleString()
                                : "—"}
                            </td>

                            <td className="px-4 py-4">{fuel.vendor || "—"}</td>

                            <td className="px-4 py-4">
                              {journey ? journey.client_name || "—" : "—"}
                            </td>

                            <td className="px-4 py-4">
                              {journey
                                ? `${journey.from_location || "—"} → ${
                                    journey.to_location || "—"
                                  }`
                                : "—"}
                            </td>

                            <td className="px-4 py-4">
                              {fuel.journey_id ? (
                                <StatusPill tone="success">Allocated</StatusPill>
                              ) : (
                                <StatusPill tone="danger">UNALLOCATED</StatusPill>
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {variance !== null ? (
                                <StatusPill tone={variance > 0 ? "danger" : "success"}>
                                  {variance > 0 ? `+${variance}L` : `${variance}L`}
                                </StatusPill>
                              ) : (
                                "—"
                              )}
                            </td>

                            <td className="px-4 py-4">
                              {fuel.approved_extra_fuel ? (
                                <span className="text-cyan-100">
                                  Approved: {fuel.approval_reason || "No reason"}
                                </span>
                              ) : duplicate ? (
                                <StatusPill tone="warning">Duplicate risk</StatusPill>
                              ) : (
                                "—"
                              )}
                            </td>

                            <td className="px-4 py-4">{fuel.notes || "—"}</td>

                            <td className="px-4 py-4 text-slate-400">
                              {fuel.created_at
                                ? new Date(fuel.created_at).toLocaleString()
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <Panel dark className="p-4">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div
        className={
          warning
            ? "mt-3 text-3xl font-semibold text-amber-100"
            : "mt-3 text-3xl font-semibold text-white"
        }
      >
        {value}
      </div>
    </Panel>
  );
}
