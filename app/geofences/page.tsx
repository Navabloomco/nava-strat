"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../components/ui/Primitives";

type Geofence = {
  id: string;
  name: string;
  type: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const typeLabels: Record<string, string> = {
  depot: "Depot",
  yard: "Yard",
  port: "Port",
  customer_site: "Customer site",
  loading_zone: "Loading zone",
  offloading_zone: "Offloading zone",
  border_point: "Border point",
  restricted_area: "Restricted area",
  risk_zone: "Risk zone",
  service_area: "Service area",
  other: "Other",
};

export default function GeofencesPage() {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [company, setCompany] = useState<any>(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadGeofences();
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

  async function loadGeofences() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/geofences", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load geofences.");
      }

      setCompany(json.company || null);
      setCanManage(Boolean(json.capabilities?.can_manage_geofences));
      setGeofences(json.geofences || []);
    } catch (err: any) {
      setError(err.message || "Failed to load geofences.");
    } finally {
      setLoading(false);
    }
  }

  async function archiveGeofence(geofence: Geofence) {
    const confirmed = window.confirm(`Archive ${geofence.name}?`);
    if (!confirmed) return;

    setActionId(geofence.id);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/geofences/${geofence.id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "archive" }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to archive geofence.");
      }

      setMessage("Geofence archived.");
      setGeofences((current) =>
        current.filter((item) => item.id !== geofence.id)
      );
    } catch (err: any) {
      setError(err.message || "Failed to archive geofence.");
    } finally {
      setActionId("");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading geofences...</div>
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
          title="Geofences"
          body="Create operational places Nava can use to understand depots, customer sites, loading zones, ports, and risk areas."
          actions={
            canManage ? (
              <Link href="/geofences/new">
                <PrimaryButton type="button" className="w-full sm:w-auto">
                  Create geofence
                </PrimaryButton>
              </Link>
            ) : null
          }
        />

        {company && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">
              Showing active geofences for {company.name || "this workspace"}.
            </div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {geofences.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              dark
              title="No geofences yet"
              body="Create depots, customer sites, loading zones, ports, and risk zones so Nava can understand where work happens."
              action={
                canManage ? (
                  <Link href="/geofences/new">
                    <PrimaryButton type="button">Create geofence</PrimaryButton>
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {geofences.map((geofence) => (
              <Panel key={geofence.id} dark className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-lg font-semibold text-white">
                        {geofence.name}
                      </h2>
                      <StatusPill tone="info">
                        {typeLabels[geofence.type] || geofence.type || "Other"}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      Created {formatDate(geofence.created_at)}
                    </p>
                  </div>

                  {canManage && (
                    <SecondaryButton
                      type="button"
                      onClick={() => archiveGeofence(geofence)}
                      disabled={actionId === geofence.id}
                      className="w-full py-2 sm:w-auto"
                    >
                      {actionId === geofence.id ? "Archiving..." : "Archive"}
                    </SecondaryButton>
                  )}
                </div>

                <div className="mt-5 grid gap-3 text-sm">
                  <Detail
                    label="Coordinates"
                    value={`${formatCoordinate(geofence.latitude)}, ${formatCoordinate(
                      geofence.longitude
                    )}`}
                  />
                  <Detail
                    label="Radius"
                    value={
                      geofence.radius_meters
                        ? `${Number(geofence.radius_meters).toLocaleString()} m`
                        : "Not set"
                    }
                  />
                  <Detail
                    label="Last updated"
                    value={formatDate(geofence.updated_at || geofence.created_at)}
                  />
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
    <div className="rounded-md border border-white/10 bg-slate-950/40 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 break-words text-slate-200">{value}</div>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not available";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCoordinate(value?: number | null) {
  if (value === null || value === undefined) return "not available";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "not available";
  return numeric.toFixed(5);
}
