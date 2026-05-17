"use client";

import { useMemo, useState } from "react";
import { StatusPill } from "./ui/Primitives";

type JourneyPickerProps = {
  journeys: any[];
  value: string;
  onChange: (journeyId: string, journey: any | null) => void;
  allowUnallocated?: boolean;
  placeholder?: string;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

export default function JourneyPicker({
  journeys,
  value,
  onChange,
  allowUnallocated = false,
  placeholder = "Search by trip, truck, client, route, or status",
}: JourneyPickerProps) {
  const [search, setSearch] = useState("");

  const selectedJourney = useMemo(
    () => journeys.find((journey) => journey.id === value) || null,
    [journeys, value]
  );

  const filteredJourneys = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return journeys;

    return journeys.filter((journey) =>
      [
        journey.internal_trip_id,
        journey.truck,
        journey.client_name,
        journey.from_location,
        journey.to_location,
        journey.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [journeys, search]);

  return (
    <div className="grid gap-3">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />

      {selectedJourney && (
        <div className="rounded-lg border border-cyan-200/25 bg-cyan-300/10 p-3 text-sm text-cyan-50">
          Selected: {journeyTitle(selectedJourney)}
        </div>
      )}

      <div className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1">
        {allowUnallocated && (
          <button
            type="button"
            onClick={() => onChange("", null)}
            className={
              value
                ? "rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left hover:border-cyan-200/40 hover:bg-cyan-300/10"
                : "rounded-lg border border-cyan-200/40 bg-cyan-300/10 p-4 text-left"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-white">
                Leave unallocated
              </span>
              {!value && <StatusPill tone="info">Selected</StatusPill>}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Save this entry without linking it to an open trip.
            </p>
          </button>
        )}

        {filteredJourneys.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
            No open trips match that search.
          </div>
        ) : (
          filteredJourneys.map((journey) => (
            <button
              key={journey.id}
              type="button"
              onClick={() => onChange(journey.id, journey)}
              className={
                value === journey.id
                  ? "rounded-lg border border-cyan-200/40 bg-cyan-300/10 p-4 text-left"
                  : "rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left hover:border-cyan-200/40 hover:bg-cyan-300/10"
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-semibold text-white">
                  {journeyTitle(journey)}
                </span>
                <StatusPill tone={statusTone(journey.status)}>
                  {journey.status || "open"}
                </StatusPill>
              </div>
              <div className="mt-2 grid gap-1 text-sm text-slate-300 sm:grid-cols-2">
                <span>{journey.client_name || "No client"}</span>
                <span>{routeLabel(journey)}</span>
                <span>{quantityLabel(journey)}</span>
                <span>{createdLabel(journey.created_at)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function journeyTitle(journey: any) {
  const reference = journey.internal_trip_id || "Open trip";
  const truck = journey.truck || "No truck";
  return `${reference} • ${truck}`;
}

function routeLabel(journey: any) {
  const from = journey.from_location || "Origin";
  const to = journey.to_location || "Destination";
  return `${from} → ${to}`;
}

function quantityLabel(journey: any) {
  const loaded = valueOrNull(journey.loaded_quantity);
  const offloaded = valueOrNull(journey.offloaded_quantity);
  const billing = valueOrNull(journey.billing_quantity);
  const unit = journey.billing_unit || "";

  if (loaded !== null || offloaded !== null) {
    return `Loaded ${loaded ?? "—"} / Offloaded ${offloaded ?? "—"} ${unit}`.trim();
  }

  if (billing !== null) {
    return `Billing ${billing} ${unit}`.trim();
  }

  return "Quantity not captured";
}

function valueOrNull(value: any) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function createdLabel(value?: string | null) {
  if (!value) return "Created date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Created date unavailable";
  return `Created ${date.toLocaleDateString()}`;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return "success";
  if (normalized === "planned" || normalized === "loading") return "info";
  if (normalized === "cancelled" || normalized === "archived") return "danger";
  if (normalized === "completed" || normalized === "delivered") return "neutral";
  return "warning";
}
