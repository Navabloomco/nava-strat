"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../components/ui/Primitives";

type SpareEvent = {
  id: string;
  event_type: string | null;
  event_at: string | null;
  part_name: string | null;
  quantity: number | null;
  asset_id: string | null;
  truck_id: string | null;
  journey_id: string | null;
  vendor_name: string | null;
  mechanic_name: string | null;
  condition_before: string | null;
  condition_after: string | null;
  odometer: number | null;
  engine_hours: number | null;
  cost: number | null;
  notes: string | null;
  from_asset_id: string | null;
  to_asset_id: string | null;
  created_at: string | null;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function SparesPage() {
  const [events, setEvents] = useState<SpareEvent[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadEvents();
  }, []);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  async function loadEvents() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/spares/usage", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load spare records.");
      }

      setEvents(json.events || []);
      setCompany(json.company || null);
    } catch (err: any) {
      setError(err.message || "Failed to load spare records.");
    } finally {
      setLoading(false);
    }
  }

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;

    return events.filter((event) =>
      [
        event.part_name,
        event.truck_id,
        event.vendor_name,
        event.mechanic_name,
        event.event_type,
        event.notes,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [events, search]);

  const summary = useMemo(() => {
    const totalCost = events.reduce((sum, event) => sum + Number(event.cost || 0), 0);
    const installedRepaired = events.filter((event) =>
      ["installed", "repaired"].includes(String(event.event_type || ""))
    ).length;
    const transfersRetreads = events.filter((event) =>
      ["transferred", "retreaded"].includes(String(event.event_type || ""))
    ).length;

    return {
      totalEvents: events.length,
      totalCost,
      installedRepaired,
      transfersRetreads,
    };
  }, [events]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow={`Lifecycle ledger · ${company?.name || "Company workspace"}`}
          title="Spares & Repairs"
          body="Record what was fitted, repaired, transferred, retreaded, or removed so Nava can build each spare's life history over time."
          actions={
            <Link href="/spares/usage/new">
              <PrimaryButton type="button" className="w-full sm:w-auto">
                Record spare usage
              </PrimaryButton>
            </Link>
          }
        />

        {loading && (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading spare records...</div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {!loading && !error && (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Metric label="Total events" value={summary.totalEvents.toLocaleString()} />
              <Metric label="Total cost" value={`KES ${summary.totalCost.toLocaleString()}`} />
              <Metric label="Installed / repaired" value={summary.installedRepaired.toLocaleString()} />
              <Metric label="Transfers / retreads" value={summary.transfersRetreads.toLocaleString()} />
            </section>

            <Panel dark className="mt-8 p-5">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by part, vehicle, vendor, mechanic, event type, or notes"
                className={inputClass}
              />
            </Panel>

            {events.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  dark
                  title="No spare records yet"
                  body="Record what was fitted, repaired, transferred, or removed so Nava can build the life history of every spare."
                  action={
                    <Link href="/spares/usage/new">
                      <PrimaryButton type="button">Record spare usage</PrimaryButton>
                    </Link>
                  }
                />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  dark
                  title="No matching spare records"
                  body="Try another part name, vehicle, vendor, mechanic, event type, or note."
                />
              </div>
            ) : (
              <section className="mt-8 grid gap-4">
                {filteredEvents.map((event) => (
                  <Panel key={event.id} dark className="p-5">
                    <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr_1fr] xl:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="min-w-0 break-words text-lg font-semibold text-white">
                            {event.part_name || "Spare part"}
                          </h2>
                          <StatusPill tone={eventTone(event.event_type)}>
                            {eventLabel(event.event_type)}
                          </StatusPill>
                        </div>
                        <div className="mt-2 text-sm text-slate-400">
                          {formatDateTime(event.event_at)}
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300">
                        <Detail label="Quantity" value={formatNumber(event.quantity)} />
                        <Detail label="Vehicle" value={event.truck_id || "Not linked"} />
                        <Detail label="Cost" value={formatMoney(event.cost)} />
                      </div>

                      <div className="grid gap-2 text-sm text-slate-300">
                        <Detail label="Vendor" value={event.vendor_name || "—"} />
                        <Detail label="Mechanic" value={event.mechanic_name || "—"} />
                        <Detail
                          label="Condition"
                          value={formatCondition(event.condition_before, event.condition_after)}
                        />
                      </div>

                      <div className="text-sm text-slate-300">
                        <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                          Notes
                        </div>
                        <div className="mt-1 break-words text-slate-200">
                          {event.notes || "—"}
                        </div>
                      </div>
                    </div>
                  </Panel>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </Panel>
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

function eventLabel(value?: string | null) {
  return String(value || "event")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventTone(value?: string | null): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "installed") return "success";
  if (value === "repaired" || value === "retreaded") return "info";
  if (value === "removed" || value === "transferred") return "warning";
  if (value === "scrapped") return "danger";
  return "neutral";
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString();
}

function formatMoney(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `KES ${Number(value).toLocaleString()}`;
}

function formatCondition(before?: string | null, after?: string | null) {
  if (!before && !after) return "—";
  if (before && after) return `${before} → ${after}`;
  return before || after || "—";
}
