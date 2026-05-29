"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

export default function JourneyListPage() {
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");

  async function fetchJourneys() {
    setLoading(true);
    setErrorDetail("");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setErrorDetail("You must be signed in to view trips.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/journeys", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json();

    if (!json.success) {
      setErrorDetail(json.error || "Failed to load trips");
      setLoading(false);
      return;
    }

    setJourneys(json.journeys || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchJourneys();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Operations"
          title="Trips"
          body="Plan and monitor customer trips, then connect fuel, expenses, revenue review, and proof to the right movement."
          actions={
            <Link href="/ops/journey/new">
              <PrimaryButton type="button">Create trip</PrimaryButton>
            </Link>
          }
        />

        {loading ? (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading trips...</div>
          </Panel>
        ) : errorDetail ? (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{errorDetail}</div>
          </Panel>
        ) : journeys.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No trips yet"
              body="Create your first trip to start linking fuel, expenses, revenue review, and proof."
              action={
                <Link href="/ops/journey/new">
                  <PrimaryButton type="button">Create first trip</PrimaryButton>
                </Link>
              }
            />
          </div>
        ) : (
          <section className="mt-8 grid gap-4">
            {journeys.map((journey) => (
              <Panel key={journey.id} dark className="p-5">
                <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr_auto] lg:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-lg font-semibold text-white">
                        {journey.internal_trip_id || "Trip reference pending"}
                      </h2>
                      <StatusPill tone={statusTone(journey.status)}>
                        {journey.status || "unknown"}
                      </StatusPill>
                    </div>
                    <div className="mt-2 text-sm text-slate-400">
                      {formatDate(journey.created_at)}
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <Detail label="Client" value={journey.client_name || "No client"} />
                    <Detail label="Truck" value={journey.truck || "No truck"} />
                    <Detail label="Driver" value={journey.driver || "No driver"} />
                    <Detail label="Route" value={routeLabel(journey)} />
                  </div>

                  <Link
                    href={`/ops/journey/${journey.id}`}
                    className="rounded-md border border-white/15 px-4 py-2 text-center text-sm font-semibold text-slate-100 hover:bg-white/10"
                  >
                    Open trip
                  </Link>
                </div>
              </Panel>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-slate-200">{value}</div>
    </div>
  );
}

function routeLabel(journey: any) {
  const from = journey.from_location || "Unknown origin";
  const to = journey.to_location || "Unknown destination";
  return `${from} → ${to}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Created date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Created date unavailable";
  return date.toLocaleString();
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "success";
  if (normalized === "planned" || normalized === "loading") return "info";
  if (normalized === "cancelled" || normalized === "archived") return "danger";
  if (normalized === "completed" || normalized === "delivered") return "neutral";
  return "warning";
}
