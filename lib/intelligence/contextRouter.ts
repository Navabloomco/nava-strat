// lib/intelligence/contextRouter.ts
import { supabaseAdmin } from "../supabaseAdmin";
import { analyzeTruckFuelRisk } from "./fuelRiskEngine.universal";
import {
  fetchActiveGeofences,
  matchPointToGeofence,
} from "./geofenceMatcher";
import {
  detectSupportedCountryName,
  getCurrentTrucksInCountry,
} from "./fleetLocationService";
import { getCompanyProfitability } from "./profitabilityService";
import { detectProfitSimulation, simulateProfit } from "./profitSimulator";

export type ContextIntent =
  | "fleet_health"
  | "offline_trucks"
  | "fuel_risk"
  | "truck_status"
  | "driver_activity"
  | "journey_context"
  | "country_trucks"
  | "profit_simulation"
  | "profitability"
  | "general";

export async function getCompanyBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  if (error || !data) {
    throw new Error(`Company not found for slug: ${slug}`);
  }
  return data;
}

export async function routeContext(question: string, tenantSlug: string) {
  const company = await getCompanyBySlug(tenantSlug);
  const companyId = company.id;
  const lower = question.toLowerCase();
  const detectedCountryName = detectSupportedCountryName(question);
  const intent = detectIntent(lower, detectedCountryName);
  const truckAccess = await detectTruckAccess(question, companyId);
  const truckId = truckAccess.truck_id;
  const fleetAssetCounts = await fetchFleetAssetCounts(companyId);
  const geofences = usesLocationContext(intent)
    ? await fetchActiveGeofences(supabaseAdmin, companyId)
    : [];
  const assignmentLookup = usesDriverAssignmentContext(intent)
    ? await fetchDriverAssignmentLookup(companyId)
    : null;
  const context: any = {
    company,
    intent,
    detected_truck_id: truckId,
    detected_country_name: detectedCountryName,
    asset_access_restricted: truckAccess.restricted,
    asset_access_message: truckAccess.restricted
      ? "I can only answer using assets enabled for Nava intelligence. This asset may be waiting for review."
      : null,
    fleet_asset_review_status: fleetAssetCounts,
    no_enabled_intelligence_assets:
      fleetAssetCounts.imported_assets > 0 && fleetAssetCounts.enabled_assets === 0,
    generated_at: new Date().toISOString(),
  };

  if (intent === "fleet_health") {
    context.fleet_health = await fetchFleetHealth(companyId);
  }
  if (intent === "offline_trucks") {
    context.offline_trucks = await fetchOfflineTrucks(
      companyId,
      geofences,
      assignmentLookup
    );
  }
  if (intent === "fuel_risk" && !truckAccess.restricted) {
    if (truckId) {
      context.fuel_risk = await analyzeTruckFuelRisk(truckId, 30, companyId);
    } else {
      context.recent_fuel_scores = await fetchRecentFuelRiskScores(companyId);
      context.recent_fuel_events = await fetchRecentFuelEvents(companyId);
    }
  }
  if (intent === "truck_status" && truckId && !truckAccess.restricted) {
    context.truck = await fetchTruckStatus(
      companyId,
      truckId,
      geofences,
      assignmentLookup
    );
    context.recent_events = await fetchTruckEvents(
      companyId,
      truckId,
      geofences,
      assignmentLookup
    );
    context.recent_telemetry = await fetchTruckTelemetry(companyId, truckId);
  }
  if (intent === "driver_activity") {
    context.driver_assignments = fetchRecentDriverAssignments(assignmentLookup);
    context.driver_related_events = await fetchRecentEvents(
      companyId,
      [],
      assignmentLookup
    );
  }
  if (intent === "journey_context") {
    context.possible_journey_context = truckAccess.restricted
      ? { asset_access_restricted: true }
      : await fetchJourneyLikeContext(
          companyId,
          truckId,
          geofences,
          assignmentLookup
        );
  }
  if (intent === "country_trucks" && detectedCountryName) {
    context.country_fleet_location = {
      country: detectedCountryName,
      freshness_window_minutes: 30,
      trucks: await getCurrentTrucksInCountry(companyId, detectedCountryName, {
        includeLocation: true,
      }),
    };
  }
  if (intent === "profit_simulation") {
    context.profit_simulation = simulateProfit(question);
  }
  if (intent === "profitability") {
    context.profitability = await getCompanyProfitability(companyId);
  }
  if (intent === "general") {
    context.fleet_health = await fetchFleetHealth(companyId);
    context.recent_events = await fetchRecentEvents(
      companyId,
      geofences,
      assignmentLookup
    );
  }
  return context;
}

function usesLocationContext(intent: ContextIntent) {
  return ["truck_status", "journey_context", "offline_trucks", "general"].includes(intent);
}

function usesDriverAssignmentContext(intent: ContextIntent) {
  return ["truck_status", "journey_context", "driver_activity", "offline_trucks", "general"].includes(intent);
}

function detectIntent(
  lower: string,
  detectedCountryName: string | null
): ContextIntent {
  if (detectedCountryName) {
    return "country_trucks";
  }
  if (detectProfitSimulation(lower)) {
    return "profit_simulation";
  }
  if (
    lower.includes("profit") ||
    lower.includes("profitable") ||
    lower.includes("profitability") ||
    lower.includes("margin") ||
    lower.includes("loss") ||
    lower.includes("losses") ||
    lower.includes("leakage") ||
    lower.includes("bleeding") ||
    lower.includes("renegotiate") ||
    lower.includes("ranking") ||
    (lower.includes("client") && lower.includes("least")) ||
    (lower.includes("client") && lower.includes("most")) ||
    (lower.includes("truck") && lower.includes("least")) ||
    (lower.includes("truck") && lower.includes("most"))
  ) {
    return "profitability";
  }
  if (
    lower.includes("fleet") &&
    (lower.includes("health") || lower.includes("summary") || lower.includes("status"))
  ) {
    return "fleet_health";
  }
  if (lower.includes("offline") || lower.includes("disconnected")) {
    return "offline_trucks";
  }
  if (lower.includes("fuel") || lower.includes("siphon") || lower.includes("theft")) {
    return "fuel_risk";
  }
  if (
    lower.includes("where") ||
    lower.includes("location") ||
    lower.includes("doing") ||
    lower.includes("what happened")
  ) {
    return "truck_status";
  }
  if (
    lower.includes("driver") ||
    lower.includes("behaviour") ||
    lower.includes("behavior") ||
    lower.includes("stops")
  ) {
    return "driver_activity";
  }
  if (
    lower.includes("journey") ||
    lower.includes("trip") ||
    lower.includes("kampala") ||
    lower.includes("mombasa") ||
    lower.includes("nairobi") ||
    lower.includes("returning")
  ) {
    return "journey_context";
  }
  return "general";
}

function extractTruckCandidate(question: string) {
  const truckMatch = question.match(/[A-Z]{3}\s?\d{3}[A-Z]/i);
  if (!truckMatch) return null;
  return truckMatch[0].toUpperCase();
}

async function detectTruckAccess(question: string, companyId: string) {
  const candidate = extractTruckCandidate(question);
  if (!candidate) return { truck_id: null, restricted: false };
  const compactCandidate = candidate.replace(/\s+/g, "");

  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, registration, intelligence_enabled")
    .eq("company_id", companyId)
    .eq("status", "active")
    .or(
      `truck_id.ilike.%${candidate}%,registration.ilike.%${candidate}%,truck_id.ilike.%${compactCandidate}%,registration.ilike.%${compactCandidate}%`
    )
    .limit(1);

  const asset = data?.[0];
  if (!asset) return { truck_id: null, restricted: false };

  if (!asset.intelligence_enabled) {
    return { truck_id: null, restricted: true };
  }

  return { truck_id: asset.truck_id || asset.registration || candidate, restricted: false };
}

async function fetchFleetAssetCounts(companyId: string) {
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("intelligence_enabled")
    .eq("company_id", companyId)
    .eq("status", "active");

  const assets = data || [];
  return {
    imported_assets: assets.length,
    enabled_assets: assets.filter((asset) => asset.intelligence_enabled).length,
  };
}

function normalizeTruckKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function sanitizeAssignedDriver(assignment: any) {
  if (!assignment) return null;

  return {
    id: assignment.id,
    driver_id: assignment.driver_id || null,
    driver_name: assignment.driver_name || null,
    assigned_from: assignment.assigned_from || null,
  };
}

function sanitizeDriverAssignment(assignment: any) {
  return {
    id: assignment.id,
    asset_id: assignment.asset_id || null,
    truck_id: assignment.truck_id || null,
    driver_id: assignment.driver_id || null,
    driver_name: assignment.driver_name || null,
    assigned_from: assignment.assigned_from || null,
    assigned_to: assignment.assigned_to || null,
    assignment_status: assignment.assignment_status || null,
  };
}

async function fetchDriverAssignmentLookup(companyId: string) {
  const [assetsResult, currentAssignmentsResult, recentAssignmentsResult] = await Promise.all([
    supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true),
    supabaseAdmin
      .from("asset_driver_assignments")
      .select(
        "id, asset_id, truck_id, driver_id, driver_name, assigned_from, assigned_to, assignment_status"
      )
      .eq("company_id", companyId)
      .eq("assignment_status", "active")
      .order("assigned_from", { ascending: false }),
    supabaseAdmin
      .from("asset_driver_assignments")
      .select(
        "id, asset_id, truck_id, driver_id, driver_name, assigned_from, assigned_to, assignment_status"
      )
      .eq("company_id", companyId)
      .order("assigned_from", { ascending: false })
      .limit(100),
  ]);

  if (assetsResult.error) throw assetsResult.error;
  if (currentAssignmentsResult.error) throw currentAssignmentsResult.error;
  if (recentAssignmentsResult.error) throw recentAssignmentsResult.error;

  const assets = assetsResult.data || [];
  const assetIds = new Set(assets.map((asset) => asset.id).filter(Boolean));
  const assetsByTruckKey = new Map<string, any>();

  for (const asset of assets) {
    for (const key of [
      normalizeTruckKey(asset.truck_id),
      normalizeTruckKey(asset.registration),
    ].filter(Boolean)) {
      assetsByTruckKey.set(key, asset);
    }
  }

  const assignmentMap = new Map<string, any>();
  for (const assignment of [
    ...(currentAssignmentsResult.data || []),
    ...(recentAssignmentsResult.data || []),
  ]) {
    assignmentMap.set(assignment.id, assignment);
  }

  const assignments = Array.from(assignmentMap.values()).filter((assignment) => {
    const assetId = assignment.asset_id || "";
    const truckKey = normalizeTruckKey(assignment.truck_id);
    return (
      (assetId && assetIds.has(assetId)) ||
      (truckKey && assetsByTruckKey.has(truckKey))
    );
  });

  const currentByAssetId = new Map<string, any>();
  const currentByTruckKey = new Map<string, any>();
  const now = Date.now();

  for (const assignment of assignments) {
    const assignedTo = assignment.assigned_to
      ? new Date(assignment.assigned_to).getTime()
      : null;
    const isCurrent =
      assignment.assignment_status === "active" &&
      (!assignedTo || assignedTo > now);

    if (!isCurrent) continue;

    const assetId = assignment.asset_id || "";
    const truckKey = normalizeTruckKey(assignment.truck_id);
    const asset = assetId ? assets.find((item) => item.id === assetId) : null;

    if (assetId && !currentByAssetId.has(assetId)) {
      currentByAssetId.set(assetId, assignment);
    }
    for (const key of [
      truckKey,
      normalizeTruckKey(asset?.truck_id),
      normalizeTruckKey(asset?.registration),
    ].filter(Boolean)) {
      if (!currentByTruckKey.has(key)) {
        currentByTruckKey.set(key, assignment);
      }
    }
  }

  return {
    assetsByTruckKey,
    currentByAssetId,
    currentByTruckKey,
    assignments: assignments.map(sanitizeDriverAssignment),
    rawAssignments: assignments,
  };
}

function findAssignedDriverForAsset(asset: any, lookup: any) {
  if (!asset || !lookup) return null;

  const assignment =
    (asset.id && lookup.currentByAssetId.get(asset.id)) ||
    lookup.currentByTruckKey.get(normalizeTruckKey(asset.truck_id)) ||
    lookup.currentByTruckKey.get(normalizeTruckKey(asset.registration));

  return sanitizeAssignedDriver(assignment);
}

function findAssignedDriverForTruck(truckId: string | null | undefined, lookup: any) {
  if (!truckId || !lookup) return null;

  const truckKey = normalizeTruckKey(truckId);
  const asset = lookup.assetsByTruckKey.get(truckKey);

  return (
    (asset && findAssignedDriverForAsset(asset, lookup)) ||
    sanitizeAssignedDriver(lookup.currentByTruckKey.get(truckKey))
  );
}

function findAssignedDriverForEvent(event: any, lookup: any) {
  if (!event?.truck_id || !lookup) return null;

  const eventTimestamp = new Date(event.created_at || event.started_at || 0).getTime();
  if (!Number.isFinite(eventTimestamp)) return null;

  const truckKey = normalizeTruckKey(event.truck_id);
  const asset = lookup.assetsByTruckKey.get(truckKey);
  const candidates = lookup.rawAssignments.filter((assignment: any) => {
    const sameAsset =
      asset?.id && assignment.asset_id && assignment.asset_id === asset.id;
    const sameTruck =
      normalizeTruckKey(assignment.truck_id) === truckKey ||
      normalizeTruckKey(asset?.truck_id) === truckKey ||
      normalizeTruckKey(asset?.registration) === truckKey;

    if (!sameAsset && !sameTruck) return false;

    const assignedFrom = new Date(assignment.assigned_from || 0).getTime();
    const assignedTo = assignment.assigned_to
      ? new Date(assignment.assigned_to).getTime()
      : Number.POSITIVE_INFINITY;

    return (
      Number.isFinite(assignedFrom) &&
      eventTimestamp >= assignedFrom &&
      eventTimestamp <= assignedTo
    );
  });

  return sanitizeAssignedDriver(candidates[0]);
}

async function fetchFleetHealth(companyId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [assetsResult, eventsResult] = await Promise.all([
    supabaseAdmin
      .from("fleet_assets")
      .select("truck_id, last_seen_at, latitude, longitude, category")
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true),
    supabaseAdmin
      .from("telemetry_events")
      .select("truck_id, event_type, severity, location_name, created_at")
      .eq("company_id", companyId)
      .gte("created_at", since.toISOString()),
  ]);

  const assets = assetsResult.data || [];
  const enabledTruckIds = new Set(assets.map((asset) => asset.truck_id).filter(Boolean));
  const events = (eventsResult.data || []).filter((event) =>
    enabledTruckIds.has(event.truck_id)
  );
  const now = Date.now();

  const offline = assets.filter((asset) => {
    if (!asset.last_seen_at) return true;
    const minutes = (now - new Date(asset.last_seen_at).getTime()) / 60000;
    return minutes > 30;
  });

  const critical = events.filter((e) => e.severity === "high");
  const fuelEvents = events.filter((e) =>
    ["fuel_drop_stationary", "low_fuel"].includes(e.event_type)
  );
  const idleEvents = events.filter((e) => e.event_type === "excessive_idle");

  return {
    total_trucks: assets.length,
    online_trucks: assets.length - offline.length,
    offline_trucks: offline.length,
    critical_events_24h: critical.length,
    fuel_events_24h: fuelEvents.length,
    idle_events_24h: idleEvents.length,
    offline_truck_ids: offline.map((t) => t.truck_id),
  };
}

async function fetchOfflineTrucks(
  companyId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, last_seen_at, latitude, longitude")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true);

  const now = Date.now();
  const offline =
    data?.filter((asset) => {
      if (!asset.last_seen_at) return true;
      const minutes = (now - new Date(asset.last_seen_at).getTime()) / 60000;
      return minutes > 30;
    }) || [];

  return offline.map((asset) => ({
    truck_id: asset.truck_id,
    last_seen_at: asset.last_seen_at,
    latitude: asset.latitude,
    longitude: asset.longitude,
    geofence_match: matchPointToGeofence(asset, geofences),
    assigned_driver: findAssignedDriverForAsset(asset, assignmentLookup),
  }));
}

async function fetchRecentFuelRiskScores(companyId: string) {
  const enabledTruckIds = await fetchEnabledTruckIds(companyId);
  if (enabledTruckIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("fuel_risk_scores")
    .select("*")
    .eq("company_id", companyId)
    .in("truck_id", enabledTruckIds)
    .order("created_at", { ascending: false })
    .limit(10);
  return data || [];
}

async function fetchRecentFuelEvents(companyId: string) {
  const enabledTruckIds = await fetchEnabledTruckIds(companyId);
  if (enabledTruckIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("*")
    .eq("company_id", companyId)
    .in("truck_id", enabledTruckIds)
    .in("event_type", ["fuel_drop_stationary", "low_fuel"])
    .order("created_at", { ascending: false })
    .limit(20);
  return data || [];
}

async function fetchTruckStatus(
  companyId: string,
  truckId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("*")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .eq("intelligence_enabled", true)
    .maybeSingle();
  if (!data) return data;

  return {
    ...data,
    geofence_match: matchPointToGeofence(data, geofences),
    assigned_driver: findAssignedDriverForAsset(data, assignmentLookup),
  };
}

async function fetchTruckEvents(
  companyId: string,
  truckId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("*")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data || []).map((event) => ({
    ...event,
    geofence_match: matchPointToGeofence(event, geofences),
    assigned_driver: findAssignedDriverForEvent(event, assignmentLookup),
  }));
}

async function fetchTruckTelemetry(companyId: string, truckId: string) {
  const { data } = await supabaseAdmin
    .from("telemetry_logs")
    .select("truck_id, recorded_at, latitude, longitude, speed, fuel_level, fuel_unit")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("recorded_at", { ascending: false })
    .limit(20);
  return data || [];
}

function fetchRecentDriverAssignments(assignmentLookup: any = null) {
  return (assignmentLookup?.assignments || []).slice(0, 20);
}

async function fetchRecentEvents(
  companyId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const enabledTruckIds = await fetchEnabledTruckIds(companyId);
  if (enabledTruckIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at")
    .eq("company_id", companyId)
    .in("truck_id", enabledTruckIds)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data || []).map((event) => ({
    ...event,
    geofence_match: matchPointToGeofence(event, geofences),
    assigned_driver: findAssignedDriverForEvent(event, assignmentLookup),
  }));
}

async function fetchEnabledTruckIds(companyId: string) {
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true);

  return (data || []).map((asset) => asset.truck_id).filter(Boolean);
}

async function fetchJourneyLikeContext(
  companyId: string,
  truckId: string | null,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const context: any = {};
  if (truckId) {
    context.truck = await fetchTruckStatus(
      companyId,
      truckId,
      geofences,
      assignmentLookup
    );
    context.recent_events = await fetchTruckEvents(
      companyId,
      truckId,
      geofences,
      assignmentLookup
    );
    context.recent_telemetry = await fetchTruckTelemetry(companyId, truckId);
  } else {
    context.recent_events = await fetchRecentEvents(
      companyId,
      geofences,
      assignmentLookup
    );
  }
  return context;
}
