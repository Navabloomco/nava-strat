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
  | "spares_context"
  | "general";

type RouteContextOptions = {
  roles?: string[];
};

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

export async function routeContext(
  question: string,
  tenantSlug: string,
  options: RouteContextOptions = {}
) {
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
  const sparesCostVisible = canViewSparesCost(options.roles || []);
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
    spares_cost_visible: sparesCostVisible,
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
  if (intent === "spares_context" && !truckAccess.restricted) {
    context.spares = await fetchSparesContext(
      companyId,
      question,
      truckId,
      sparesCostVisible
    );
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

function canViewSparesCost(roles: string[]) {
  const normalizedRoles = new Set(
    roles.map((role) => String(role || "").toLowerCase())
  );

  return (
    normalizedRoles.has("platform_owner") ||
    normalizedRoles.has("owner") ||
    normalizedRoles.has("admin") ||
    normalizedRoles.has("finance") ||
    normalizedRoles.has("management")
  );
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
  if (detectSparesIntent(lower)) {
    return "spares_context";
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

function detectSparesIntent(lower: string) {
  return /\b(spare|spares|part|parts|maintenance|repair|repaired|fixed|fitted|installed|removed|replaced|tyre|tire|retread|battery|brake|filter|mechanic|workshop|vendor|supplier)\b/.test(lower);
}

function extractTruckCandidate(question: string) {
  const truckMatch = question.match(/[A-Z]{3}\s?\d{3}[A-Z]/i);
  if (!truckMatch) return null;
  return truckMatch[0].toUpperCase();
}

async function detectTruckAccess(question: string, companyId: string) {
  const candidate = extractTruckCandidate(question);
  const compactCandidate = candidate ? normalizeTruckKey(candidate) : null;
  const compactQuestion = normalizeTruckKey(question);

  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, intelligence_enabled")
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(500);

  const assets = data || [];
  const asset = assets.find((item) =>
    getAssetMatchKeys(item).some((key) => {
      if (compactCandidate && key.includes(compactCandidate)) return true;
      return compactQuestion.includes(key);
    })
  );

  if (!asset) return { truck_id: null, restricted: false };

  if (!asset.intelligence_enabled) {
    return { truck_id: null, restricted: true };
  }

  return { truck_id: asset.truck_id || asset.registration || candidate, restricted: false };
}

function getAssetMatchKeys(asset: any) {
  return [normalizeTruckKey(asset?.truck_id), normalizeTruckKey(asset?.registration)]
    .filter((key) => key.length >= 4);
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

async function fetchSparesContext(
  companyId: string,
  question: string,
  truckId: string | null,
  costVisible: boolean
) {
  const enabledAssetLookup = await fetchEnabledAssetLookup(companyId);

  const [
    recentSpareEvents,
    truckSpareHistory,
    partCatalogMatches,
    vendorMechanicSummary,
    retreadSummary,
  ] = await Promise.all([
    fetchRecentSpareEvents(companyId, costVisible, enabledAssetLookup),
    truckId
      ? fetchTruckSpareHistory(companyId, truckId, costVisible, enabledAssetLookup)
      : Promise.resolve([]),
    fetchPartCatalogMatches(companyId, question),
    fetchVendorMechanicSummary(companyId, costVisible),
    fetchRetreadSummary(companyId, costVisible, enabledAssetLookup),
  ]);

  return {
    cost_visible: costVisible,
    unsupported_lifespan_question: asksForUnsupportedSparesAnalytics(question),
    recent_spare_events: recentSpareEvents,
    truck_spare_history: truckSpareHistory,
    part_catalog_matches: partCatalogMatches,
    vendor_mechanic_summary: vendorMechanicSummary,
    retread_summary: retreadSummary,
  };
}

async function fetchEnabledAssetLookup(companyId: string) {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true);

  if (error) throw error;

  const assets = data || [];
  const assetIds = new Set(assets.map((asset) => asset.id).filter(Boolean));
  const byTruckKey = new Map<string, any>();

  for (const asset of assets) {
    for (const key of getAssetMatchKeys(asset)) {
      byTruckKey.set(key, asset);
    }
  }

  return { assets, assetIds, byTruckKey };
}

async function fetchRecentSpareEvents(
  companyId: string,
  costVisible: boolean,
  enabledAssetLookup: any
) {
  const { data, error } = await supabaseAdmin
    .from("spare_lifecycle_events")
    .select(spareEventSelect())
    .eq("company_id", companyId)
    .order("event_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data || []).map((event) =>
    sanitizeSpareEvent(event, costVisible, enabledAssetLookup)
  );
}

async function fetchTruckSpareHistory(
  companyId: string,
  truckId: string,
  costVisible: boolean,
  enabledAssetLookup: any
) {
  const truckKey = normalizeTruckKey(truckId);
  const asset = enabledAssetLookup.byTruckKey.get(truckKey);
  if (!asset) return [];

  const { data, error } = await supabaseAdmin
    .from("spare_lifecycle_events")
    .select(spareEventSelect())
    .eq("company_id", companyId)
    .order("event_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  return (data || [])
    .filter((event) => spareEventMatchesEnabledAsset(event, asset, enabledAssetLookup))
    .slice(0, 20)
    .map((event) => sanitizeSpareEvent(event, costVisible, enabledAssetLookup));
}

async function fetchPartCatalogMatches(companyId: string, question: string) {
  const { data, error } = await supabaseAdmin
    .from("spare_catalog_parts")
    .select(
      "name, category, brand, model, part_number, expected_life_km, expected_life_days, retreadable, max_retreads, is_active"
    )
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(100);

  if (error) throw error;

  const lowerQuestion = question.toLowerCase();
  return (data || [])
    .filter((part) =>
      [
        part.name,
        part.category,
        part.brand,
        part.model,
        part.part_number,
      ]
        .filter(Boolean)
        .some((value) => {
          const text = String(value).toLowerCase();
          return text.length >= 3 && lowerQuestion.includes(text);
        })
    )
    .slice(0, 8)
    .map(sanitizeCatalogPart);
}

async function fetchVendorMechanicSummary(companyId: string, costVisible: boolean) {
  const { data, error } = await supabaseAdmin
    .from("spare_lifecycle_events")
    .select("event_type, event_at, vendor_name, mechanic_name, cost")
    .eq("company_id", companyId)
    .order("event_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  return {
    vendors: summarizeSpareNameCounts(data || [], "vendor_name", costVisible),
    mechanics: summarizeSpareNameCounts(data || [], "mechanic_name", costVisible),
  };
}

async function fetchRetreadSummary(
  companyId: string,
  costVisible: boolean,
  enabledAssetLookup: any
) {
  const [eventsResult, catalogResult] = await Promise.all([
    supabaseAdmin
      .from("spare_lifecycle_events")
      .select(spareEventSelect())
      .eq("company_id", companyId)
      .eq("event_type", "retreaded")
      .order("event_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("spare_catalog_parts")
      .select(
        "name, category, brand, model, part_number, expected_life_km, expected_life_days, retreadable, max_retreads, is_active"
      )
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("retreadable", true)
      .order("name", { ascending: true })
      .limit(20),
  ]);

  if (eventsResult.error) throw eventsResult.error;
  if (catalogResult.error) throw catalogResult.error;

  const retreadEvents = (eventsResult.data || []).map((event) =>
    sanitizeSpareEvent(event, costVisible, enabledAssetLookup)
  );

  return {
    event_count: retreadEvents.length,
    events: retreadEvents.slice(0, 10),
    by_part: summarizeRetreadsByPart(retreadEvents),
    catalog_reference: (catalogResult.data || []).map(sanitizeCatalogPart),
  };
}

function spareEventSelect() {
  return "event_type, event_at, part_name, quantity, asset_id, truck_id, vendor_name, mechanic_name, condition_before, condition_after, odometer, engine_hours, cost, from_asset_id, to_asset_id, created_at";
}

function sanitizeSpareEvent(
  event: any,
  costVisible: boolean,
  enabledAssetLookup: any
) {
  const safeEvent: any = {
    event_type: event.event_type || null,
    event_at: event.event_at || null,
    part_name: event.part_name || null,
    quantity:
      event.quantity === null || event.quantity === undefined
        ? null
        : Number(event.quantity),
    truck_id: resolveEnabledTruckLabel(event, enabledAssetLookup),
    vendor_name: event.vendor_name || null,
    mechanic_name: event.mechanic_name || null,
    condition_before: event.condition_before || null,
    condition_after: event.condition_after || null,
    odometer:
      event.odometer === null || event.odometer === undefined
        ? null
        : Number(event.odometer),
    engine_hours:
      event.engine_hours === null || event.engine_hours === undefined
        ? null
        : Number(event.engine_hours),
    created_at: event.created_at || null,
  };

  if (costVisible) {
    safeEvent.cost =
      event.cost === null || event.cost === undefined ? null : Number(event.cost);
  }

  return safeEvent;
}

function sanitizeCatalogPart(part: any) {
  return {
    name: part.name || null,
    category: part.category || null,
    brand: part.brand || null,
    model: part.model || null,
    part_number: part.part_number || null,
    expected_life_km:
      part.expected_life_km === null || part.expected_life_km === undefined
        ? null
        : Number(part.expected_life_km),
    expected_life_days:
      part.expected_life_days === null || part.expected_life_days === undefined
        ? null
        : Number(part.expected_life_days),
    retreadable: Boolean(part.retreadable),
    max_retreads:
      part.max_retreads === null || part.max_retreads === undefined
        ? null
        : Number(part.max_retreads),
    is_active: part.is_active !== false,
  };
}

function spareEventMatchesEnabledAsset(event: any, asset: any, lookup: any) {
  if (event.asset_id && asset.id && event.asset_id === asset.id) return true;

  const eventKey = normalizeTruckKey(event.truck_id);
  if (!eventKey) return false;

  return getAssetMatchKeys(asset).some((key) => key === eventKey) ||
    lookup.byTruckKey.get(eventKey)?.id === asset.id;
}

function resolveEnabledTruckLabel(event: any, lookup: any) {
  if (event.asset_id && lookup.assetIds.has(event.asset_id)) {
    const asset = lookup.assets.find((item: any) => item.id === event.asset_id);
    return asset?.registration || asset?.truck_id || null;
  }

  const eventKey = normalizeTruckKey(event.truck_id);
  if (!eventKey) return null;

  const asset = lookup.byTruckKey.get(eventKey);
  return asset?.registration || asset?.truck_id || null;
}

function summarizeSpareNameCounts(
  events: any[],
  field: "vendor_name" | "mechanic_name",
  costVisible: boolean
) {
  const summary = new Map<string, any>();

  for (const event of events) {
    const name = String(event[field] || "").trim();
    if (!name) continue;

    const current =
      summary.get(name) ||
      {
        name,
        event_count: 0,
        last_event_at: null,
        event_types: {},
        total_cost: 0,
      };

    current.event_count += 1;
    current.last_event_at = current.last_event_at || event.event_at || null;
    current.event_types[event.event_type || "event"] =
      (current.event_types[event.event_type || "event"] || 0) + 1;
    if (costVisible && event.cost !== null && event.cost !== undefined) {
      current.total_cost += Number(event.cost || 0);
    }
    summary.set(name, current);
  }

  return Array.from(summary.values())
    .sort((a, b) => b.event_count - a.event_count)
    .slice(0, 8)
    .map((item) => {
      const formatted: any = {
        name: item.name,
        event_count: item.event_count,
        last_event_at: item.last_event_at,
        event_types: item.event_types,
      };
      if (costVisible) formatted.total_cost = item.total_cost;
      return formatted;
    });
}

function summarizeRetreadsByPart(events: any[]) {
  const summary = new Map<string, any>();

  for (const event of events) {
    const partName = event.part_name || "Unknown part";
    const current =
      summary.get(partName) ||
      {
        part_name: partName,
        retread_count: 0,
        latest_event_at: null,
      };

    current.retread_count += 1;
    current.latest_event_at = current.latest_event_at || event.event_at || null;
    summary.set(partName, current);
  }

  return Array.from(summary.values())
    .sort((a, b) => b.retread_count - a.retread_count)
    .slice(0, 10);
}

function asksForUnsupportedSparesAnalytics(question: string) {
  const lower = question.toLowerCase();
  return [
    "lifespan",
    "life span",
    "how long",
    "last longer",
    "lasts longer",
    "fail faster",
    "fails faster",
    "better",
    "worse",
    "perform better",
    "performance",
    "recommend replacement",
    "replacement recommendation",
  ].some((phrase) => lower.includes(phrase));
}
