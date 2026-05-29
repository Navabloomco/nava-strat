import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicleKey } from "../intelligence/entityResolver";

export const ASSET_AVAILABILITY_STATUSES = [
  "available",
  "on_trip",
  "grounded",
  "under_repair",
  "breakdown_reported",
  "out_of_service",
  "at_client_site",
  "loading",
  "offloading",
  "waiting",
  "unknown_stopped_time",
] as const;

export const ASSET_AVAILABILITY_SOURCES = ["manual", "provider", "inferred"] as const;

export type AssetAvailabilityStatus = (typeof ASSET_AVAILABILITY_STATUSES)[number];
export type AssetAvailabilitySource = (typeof ASSET_AVAILABILITY_SOURCES)[number];

export type AssetAvailabilityEvent = {
  id: string;
  company_id: string;
  asset_id: string | null;
  truck_id: string | null;
  journey_id: string | null;
  status: AssetAvailabilityStatus;
  source: AssetAvailabilitySource;
  started_at: string | null;
  ended_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const ASSET_AVAILABILITY_FIELDS =
  "id, company_id, asset_id, truck_id, journey_id, status, source, started_at, ended_at, note, created_by, created_at, updated_at";

const KNOWN_UNAVAILABLE_STATUSES = new Set([
  "grounded",
  "under_repair",
  "breakdown_reported",
  "out_of_service",
]);

const SITE_CONTEXT_STATUSES = new Set([
  "at_client_site",
  "loading",
  "offloading",
  "waiting",
]);

export function normalizeAssetAvailabilityStatus(
  value: unknown
): AssetAvailabilityStatus | null {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (ASSET_AVAILABILITY_STATUSES as readonly string[]).includes(text)
    ? (text as AssetAvailabilityStatus)
    : null;
}

export function normalizeAssetAvailabilitySource(value: unknown): AssetAvailabilitySource {
  const text = String(value || "").trim().toLowerCase();
  return (ASSET_AVAILABILITY_SOURCES as readonly string[]).includes(text)
    ? (text as AssetAvailabilitySource)
    : "manual";
}

export function isKnownUnavailableAvailability(status: unknown) {
  return KNOWN_UNAVAILABLE_STATUSES.has(String(status || "").trim().toLowerCase());
}

export function isSiteContextAvailability(status: unknown) {
  return SITE_CONTEXT_STATUSES.has(String(status || "").trim().toLowerCase());
}

export function labelAssetAvailabilityStatus(status: unknown) {
  const normalized = normalizeAssetAvailabilityStatus(status);
  const labels: Record<AssetAvailabilityStatus, string> = {
    available: "Available",
    on_trip: "On trip",
    grounded: "Grounded",
    under_repair: "Under repair",
    breakdown_reported: "Breakdown reported",
    out_of_service: "Out of service",
    at_client_site: "At client/site",
    loading: "Loading",
    offloading: "Offloading",
    waiting: "Waiting",
    unknown_stopped_time: "Unknown stopped time",
  };
  return normalized ? labels[normalized] : "Availability unknown";
}

export function assetAvailabilityTone(status: unknown) {
  const normalized = normalizeAssetAvailabilityStatus(status);
  if (!normalized || normalized === "available") return "neutral";
  if (normalized === "on_trip" || normalized === "loading" || normalized === "offloading") {
    return "info";
  }
  if (normalized === "at_client_site" || normalized === "waiting" || normalized === "unknown_stopped_time") {
    return "warning";
  }
  return "danger";
}

export function availabilityContextNote(event: any) {
  const status = normalizeAssetAvailabilityStatus(event?.status);
  if (!status) return "";
  if (isKnownUnavailableAvailability(status)) {
    return `${labelAssetAvailabilityStatus(status)} is recorded operational context. Treat stopped time as known downtime, not normal low-productivity or engine-on idle proof.`;
  }
  if (isSiteContextAvailability(status)) {
    return `${labelAssetAvailabilityStatus(status)} is recorded operational context. Do not turn site dwell into client delay or blame without stronger evidence.`;
  }
  if (status === "on_trip") {
    return "On trip is route context, not proof of arrival or offload.";
  }
  return "Availability status is operational context for interpreting movement and stopped-time evidence.";
}

export function toSafeAssetAvailabilityEvent(row: any): AssetAvailabilityEvent | null {
  const status = normalizeAssetAvailabilityStatus(row?.status);
  if (!row?.id || !status) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    asset_id: row.asset_id || null,
    truck_id: row.truck_id || null,
    journey_id: row.journey_id || null,
    status,
    source: normalizeAssetAvailabilitySource(row.source),
    started_at: row.started_at || row.created_at || null,
    ended_at: row.ended_at || null,
    note: safeNote(row.note),
    created_by: row.created_by || null,
    created_at: row.created_at || row.started_at || null,
    updated_at: row.updated_at || row.created_at || null,
  };
}

export async function fetchActiveAssetAvailabilityEvents(companyId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("asset_availability_events")
      .select(ASSET_AVAILABILITY_FIELDS)
      .eq("company_id", companyId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(5000);

    if (error) {
      if (isAssetAvailabilitySchemaMissing(error)) {
        return { rows: [], missing: true, error: safeErrorMessage(error) };
      }
      throw error;
    }

    return {
      rows: (data || []).map(toSafeAssetAvailabilityEvent).filter(Boolean) as AssetAvailabilityEvent[],
      missing: false,
      error: null,
    };
  } catch (err: any) {
    if (isAssetAvailabilitySchemaMissing(err)) {
      return { rows: [], missing: true, error: safeErrorMessage(err) };
    }
    throw err;
  }
}

export function buildAssetAvailabilityLookup(events: any[]) {
  const byAssetId = new Map<string, AssetAvailabilityEvent>();
  const byTruckKey = new Map<string, AssetAvailabilityEvent>();

  for (const event of events || []) {
    const safe = toSafeAssetAvailabilityEvent(event);
    if (!safe) continue;
    if (safe.asset_id && !byAssetId.has(safe.asset_id)) {
      byAssetId.set(safe.asset_id, safe);
    }
    const key = normalizeVehicleKey(safe.truck_id || "");
    if (key && !byTruckKey.has(key)) byTruckKey.set(key, safe);
  }

  return { byAssetId, byTruckKey };
}

export function findAssetAvailabilityForTarget(
  lookup: ReturnType<typeof buildAssetAvailabilityLookup>,
  target: { id?: string | null; asset_id?: string | null; truck_id?: string | null; registration?: string | null; truck?: string | null }
) {
  const assetId = target.asset_id || target.id || null;
  if (assetId && lookup.byAssetId.has(assetId)) return lookup.byAssetId.get(assetId) || null;

  for (const candidate of [target.truck_id, target.registration, target.truck]) {
    const key = normalizeVehicleKey(candidate || "");
    if (key && lookup.byTruckKey.has(key)) return lookup.byTruckKey.get(key) || null;
  }

  return null;
}

export function isAssetAvailabilitySchemaMissing(error: any) {
  const text = safeErrorMessage(error).toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    text.includes("asset_availability_events") ||
    (text.includes("schema cache") && text.includes("asset"))
  );
}

function safeNote(value: any) {
  const text = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : null;
}

function safeErrorMessage(error: any) {
  return String(error?.message || error?.details || error?.hint || error || "");
}
