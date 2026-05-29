"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ClientTrackingData = {
  company: { name: string; slug: string | null };
  client: { name: string };
  link: { expires_at: string | null; active_until_revoked: boolean };
  generated_at: string;
  journeys: ClientJourney[];
};

type ClientJourney = {
  id: string;
  reference: string;
  status: string | null;
  route: { from: string | null; to: string | null };
  truck: { registration: string | null };
  quantity: {
    loaded: number | null;
    offloaded: number | null;
    remaining: number | null;
    billing_quantity: number | null;
    billing_unit: string | null;
  };
  location: {
    label: string | null;
    coordinates: { latitude: number | null; longitude: number | null } | null;
    last_seen_at: string | null;
  };
  updated_at: string | null;
};

export default function ClientTrackingPortalPage() {
  const params = useParams();
  const tokenParam = params?.token;
  const token = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  const [data, setData] = useState<ClientTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    loadPortal();
  }, [token]);

  async function loadPortal() {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/client/track/${encodeURIComponent(token || "")}`, {
        cache: "no-store",
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "This tracking link is unavailable or has expired.");
      }

      setData(json);
    } catch (err: any) {
      setError(err.message || "This tracking link is unavailable or has expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="break-words text-xs font-bold uppercase tracking-[0.16em] text-cyan-200 sm:tracking-[0.2em]">
              Delivery visibility
            </p>
            <h1 className="mt-3 break-words text-3xl font-semibold tracking-normal sm:text-4xl">
              {data?.client.name || "Client tracking"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              A secure delivery view for active trips, current truck status, and
              quantity movement.
            </p>
          </div>

          <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-slate-300">
            <div className="break-words font-semibold text-white">
              {data?.company.name || "Nava Strat"}
            </div>
            <div className="mt-1">
              {data?.generated_at
                ? `Updated ${formatDateTime(data.generated_at)}`
                : "Secure client portal"}
            </div>
          </div>
        </header>

        {loading ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-white/[0.06] p-6 text-slate-200">
            Loading delivery visibility...
          </section>
        ) : error ? (
          <section className="mt-8 rounded-lg border border-amber-300/30 bg-amber-300/10 p-6">
            <h2 className="text-xl font-semibold text-white">
              This tracking link is unavailable or has expired.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-amber-50/80">
              Please contact the transport team for a current delivery visibility link.
            </p>
          </section>
        ) : data && data.journeys.length === 0 ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-white/[0.06] p-6">
            <h2 className="text-xl font-semibold text-white">
              No active deliveries are currently visible for this link.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              When a delivery is available for this client view, it will appear here
              with route, quantity, and location status.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-3">
              <Metric label="Visible trips" value={data?.journeys.length || 0} />
              <Metric
                label="With location"
                value={
                  data?.journeys.filter(
                    (journey) =>
                      journey.location.label || journey.location.coordinates
                  ).length || 0
                }
              />
              <Metric
                label="In progress"
                value={
                  data?.journeys.filter((journey) =>
                    ["active", "loaded", "in_transit", "offloading"].includes(
                      String(journey.status || "").toLowerCase()
                    )
                  ).length || 0
                }
              />
            </section>

            <section className="mt-8 space-y-4">
              {data?.journeys.map((journey) => (
                <JourneyCard key={journey.id} journey={journey} />
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
    </div>
  );
}

function JourneyCard({ journey }: { journey: ClientJourney }) {
  const locationText =
    journey.location.label ||
    (journey.location.coordinates
      ? "Location update available; readable place pending."
      : "Location not currently available.");

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="min-w-0 break-words text-lg font-semibold text-white">
              {journey.reference || "Delivery"}
            </h2>
            <StatusBadge status={journey.status} />
          </div>
          <p className="mt-2 text-sm text-slate-300">
            {journey.route.from || "Origin"} → {journey.route.to || "Destination"}
          </p>
        </div>
        <div className="min-w-0 text-sm text-slate-300 lg:text-right">
          <div className="break-words font-semibold text-white">
            {journey.truck.registration || "Truck pending"}
          </div>
          <div className="mt-1">
            {journey.location.last_seen_at
              ? `Last seen ${formatDateTime(journey.location.last_seen_at)}`
              : "Location not currently available."}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-md border border-white/10 bg-slate-950/40 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Current location
          </div>
          <div className="mt-2 text-sm font-medium text-white">{locationText}</div>
          {journey.location.label && (
            <div className="mt-1 text-xs text-slate-400">
              Location supplied by the delivery visibility feed.
            </div>
          )}
        </div>

        <div className="rounded-md border border-white/10 bg-slate-950/40 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Quantity
          </div>
          <div className="mt-3 grid gap-3 text-sm min-[420px]:grid-cols-3">
            <Quantity label="Loaded" value={journey.quantity.loaded} unit={journey.quantity.billing_unit} />
            <Quantity label="Offloaded" value={journey.quantity.offloaded} unit={journey.quantity.billing_unit} />
            <Quantity label="Remaining" value={journey.quantity.remaining} unit={journey.quantity.billing_unit} />
          </div>
          {journey.quantity.billing_quantity !== null && (
            <div className="mt-3 text-xs text-slate-400">
              Billing quantity: {formatNumber(journey.quantity.billing_quantity)}
              {journey.quantity.billing_unit ? ` ${journey.quantity.billing_unit}` : ""}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-500">
        Trip updated {journey.updated_at ? formatDateTime(journey.updated_at) : "not available"}
      </div>
    </article>
  );
}

function Quantity({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string | null;
}) {
  return (
    <div>
      <div className="text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-white">
        {value === null ? "—" : formatNumber(value)}
        {value !== null && unit ? ` ${unit}` : ""}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const normalized = String(status || "pending").toLowerCase();
  const tone =
    normalized.includes("complete") || normalized.includes("delivered")
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : normalized.includes("offload") || normalized.includes("arrived")
        ? "border-cyan-200/30 bg-cyan-300/10 text-cyan-100"
        : "border-slate-300/30 bg-slate-300/10 text-slate-200";

  return (
    <span className={`inline-flex max-w-full whitespace-normal break-words rounded-full border px-2.5 py-1 text-center text-xs font-semibold leading-5 ${tone}`}>
      {status || "Pending"}
    </span>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not available";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}
