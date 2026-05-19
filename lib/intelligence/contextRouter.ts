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
  let intent = detectIntent(lower, detectedCountryName);
  const vehicleMatch = await matchVehicleInFleet(question, companyId);
  if (intent === "general" && vehicleMatch.input) {
    intent = "truck_status";
  }
  const truckId = vehicleMatch.enabled_for_intelligence
    ? vehicleMatch.matched_truck_id || vehicleMatch.matched_registration || null
    : null;
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
    vehicle_match: vehicleMatch,
    asset_access_restricted:
      vehicleMatch.matched && !vehicleMatch.enabled_for_intelligence,
    asset_access_message:
      vehicleMatch.matched && !vehicleMatch.enabled_for_intelligence
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
  if (intent === "fuel_risk" && !context.asset_access_restricted) {
    if (truckId) {
      context.fuel_risk = await analyzeTruckFuelRisk(truckId, 30, companyId);
      context.fuel_investigation = await fetchFuelSuspicionInvestigation(
        companyId,
        truckId,
        geofences,
        assignmentLookup
      );
    } else {
      context.recent_fuel_scores = await fetchRecentFuelRiskScores(companyId);
      context.recent_fuel_events = await fetchRecentFuelEvents(companyId);
    }
  }
  if (intent === "truck_status" && truckId && !context.asset_access_restricted) {
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
    context.possible_journey_context = context.asset_access_restricted
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
  if (intent === "spares_context" && !context.asset_access_restricted) {
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
  return ["fuel_risk", "truck_status", "journey_context", "offline_trucks", "general"].includes(intent);
}

function usesDriverAssignmentContext(intent: ContextIntent) {
  return ["fuel_risk", "truck_status", "journey_context", "driver_activity", "offline_trucks", "general"].includes(intent);
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

function extractVehicleInputs(question: string) {
  const inputs = new Map<string, string>();
  const platePattern = /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?/gi;
  const matches = question.match(platePattern) || [];

  for (const match of matches) {
    const key = normalizeTruckKey(match);
    if (key.length >= 4) inputs.set(key, match.trim().toUpperCase());
  }

  const tokens = question
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const key = normalizeTruckKey(token);
    if (
      key.length >= 4 &&
      key.length <= 12 &&
      /[A-Z]/.test(key) &&
      /\d/.test(key)
    ) {
      inputs.set(key, token.toUpperCase());
    }
  }

  return Array.from(inputs.entries()).map(([key, input]) => ({ key, input }));
}

async function matchVehicleInFleet(question: string, companyId: string) {
  const inputs = extractVehicleInputs(question);

  const baseMatch: any = {
    input: inputs[0]?.input || null,
    matched: false,
    confidence: "none",
    match_type: "none",
    matched_truck_id: null,
    matched_registration: null,
    enabled_for_intelligence: false,
    candidates: [],
  };

  if (inputs.length === 0) return baseMatch;

  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, intelligence_enabled")
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(1000);

  if (error) throw error;

  const candidates = new Map<string, any>();
  for (const input of inputs) {
    for (const asset of data || []) {
      const best = bestVehicleMatchForAsset(input.key, asset);
      if (!best) continue;

      const candidateKey = asset.id || `${asset.truck_id}:${asset.registration}`;
      const existing = candidates.get(candidateKey);
      if (!existing || best.rank > existing.rank) {
        candidates.set(candidateKey, {
          id: asset.id,
          truck_id: asset.truck_id || null,
          registration: asset.registration || null,
          confidence: best.confidence,
          match_type: best.match_type,
          enabled_for_intelligence: Boolean(asset.intelligence_enabled),
          input: input.input,
          rank: best.rank,
        });
      }
    }
  }

  const sortedCandidates = Array.from(candidates.values())
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 5);

  if (sortedCandidates.length === 0) return baseMatch;

  const topRank = sortedCandidates[0].rank;
  const topCandidates = sortedCandidates.filter((candidate) => candidate.rank === topRank);
  const safeCandidates = sortedCandidates.map(sanitizeVehicleCandidate);

  if (topCandidates.length > 1) {
    return {
      ...baseMatch,
      input: topCandidates[0].input || baseMatch.input,
      confidence: "low",
      match_type: "multiple_candidates",
      candidates: safeCandidates,
    };
  }

  const winner = topCandidates[0];
  return {
    input: winner.input || baseMatch.input,
    matched: true,
    confidence: winner.confidence,
    match_type: winner.match_type,
    matched_truck_id: winner.truck_id,
    matched_registration: winner.registration,
    enabled_for_intelligence: winner.enabled_for_intelligence,
    candidates: safeCandidates,
  };
}

function bestVehicleMatchForAsset(inputKey: string, asset: any) {
  let best: any = null;

  for (const key of getAssetMatchKeys(asset)) {
    const match = scoreVehicleKey(inputKey, key);
    if (match && (!best || match.rank > best.rank)) {
      best = match;
    }
  }

  return best;
}

function scoreVehicleKey(inputKey: string, assetKey: string) {
  if (!inputKey || !assetKey || inputKey.length < 4 || assetKey.length < 4) {
    return null;
  }

  if (inputKey === assetKey) {
    return { confidence: "high", match_type: "exact_normalized", rank: 100 };
  }

  const missingOneTrailing =
    assetKey.length === inputKey.length + 1 && assetKey.startsWith(inputKey);
  if (missingOneTrailing) {
    return {
      confidence: "high",
      match_type: "missing_trailing_character",
      rank: 90,
    };
  }

  const distance = editDistance(inputKey, assetKey);
  if (distance === 1 && Math.max(inputKey.length, assetKey.length) >= 5) {
    return { confidence: "medium", match_type: "edit_distance_1", rank: 75 };
  }

  const strongPartial =
    inputKey.length >= 5 &&
    (assetKey.includes(inputKey) || inputKey.includes(assetKey));
  if (strongPartial) {
    return { confidence: "medium", match_type: "strong_partial", rank: 65 };
  }

  return null;
}

function sanitizeVehicleCandidate(candidate: any) {
  return {
    truck_id: candidate.truck_id || null,
    registration: candidate.registration || null,
    confidence: candidate.confidence || "low",
    match_type: candidate.match_type || "candidate",
    enabled_for_intelligence: Boolean(candidate.enabled_for_intelligence),
  };
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
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function editDistance(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
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
    .select("truck_id, risk_score, risk_level, recommendation, created_at")
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
    .select("truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at")
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
  const targetKey = normalizeTruckKey(truckId);
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, status, latitude, longitude, last_seen_at, provider_location_label, asset_category")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  const asset = (data || []).find((item) =>
    getAssetMatchKeys(item).some((key) => key === targetKey)
  );
  if (!asset) return null;

  return {
    ...asset,
    geofence_match: matchPointToGeofence(asset, geofences),
    assigned_driver: findAssignedDriverForAsset(asset, assignmentLookup),
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
    .select("truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at, context_label, context_type")
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

async function fetchFuelSuspicionInvestigation(
  companyId: string,
  truckId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const truck = await fetchTruckStatus(
    companyId,
    truckId,
    geofences,
    assignmentLookup
  );

  const [
    recentEvents,
    telemetrySummary,
    recentFuelLogs,
    recentJourneys,
    latestFuelScore,
  ] = await Promise.all([
    fetchTruckEvents(companyId, truckId, geofences, assignmentLookup),
    fetchFuelTelemetrySummary(companyId, truckId),
    fetchRecentFuelLogs(companyId, truckId, truck),
    fetchRecentTruckJourneys(companyId, truckId, truck),
    fetchLatestFuelRiskScore(companyId, truckId),
  ]);

  const fuelRelatedEvents = recentEvents.filter((event: any) =>
    ["fuel_drop_stationary", "low_fuel"].includes(event.event_type)
  );
  const idleStopEvents = recentEvents.filter((event: any) =>
    ["excessive_idle", "idle", "stopped", "long_stop"].includes(event.event_type)
  );

  return {
    truck,
    latest_fuel_score: latestFuelScore,
    telemetry_summary: telemetrySummary,
    recent_fuel_logs: recentFuelLogs,
    recent_journeys: recentJourneys,
    fuel_related_events: fuelRelatedEvents.slice(0, 8),
    idle_stop_events: idleStopEvents.slice(0, 8),
  };
}

async function fetchFuelTelemetrySummary(companyId: string, truckId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("telemetry_logs")
      .select("recorded_at, fuel_level, fuel_unit, speed, latitude, longitude")
      .eq("company_id", companyId)
      .eq("truck_id", truckId)
      .order("recorded_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const telemetry = data || [];
    const fuelReadings = telemetry.filter((point: any) =>
      Number.isFinite(Number(point.fuel_level))
    );
    const fuelValues = fuelReadings.map((point: any) => Number(point.fuel_level));
    const latestFuel = fuelReadings[0] || null;

    return {
      telemetry_points: telemetry.length,
      fuel_readings: fuelReadings.length,
      latest_fuel_level: latestFuel ? Number(latestFuel.fuel_level) : null,
      latest_fuel_unit: latestFuel?.fuel_unit || null,
      latest_fuel_at: latestFuel?.recorded_at || null,
      min_fuel_level: fuelValues.length ? Math.min(...fuelValues) : null,
      max_fuel_level: fuelValues.length ? Math.max(...fuelValues) : null,
      fuel_telemetry_available: fuelReadings.length > 0,
    };
  } catch (err: any) {
    return {
      telemetry_points: 0,
      fuel_readings: 0,
      latest_fuel_level: null,
      latest_fuel_unit: null,
      latest_fuel_at: null,
      min_fuel_level: null,
      max_fuel_level: null,
      fuel_telemetry_available: false,
      error: err.message || "Fuel telemetry summary unavailable",
    };
  }
}

async function fetchRecentFuelLogs(companyId: string, truckId: string, truck: any) {
  try {
    const keys = new Set(
      [truckId, truck?.truck_id, truck?.registration]
        .map(normalizeTruckKey)
        .filter(Boolean)
    );
    const { data, error } = await supabaseAdmin
      .from("fuel_logs")
      .select("truck_text, liters, vendor, journey_id, allocation_status, fuel_source, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return (data || [])
      .filter((log: any) => keys.has(normalizeTruckKey(log.truck_text)))
      .slice(0, 8)
      .map((log: any) => ({
        truck_text: log.truck_text || null,
        liters:
          log.liters === null || log.liters === undefined
            ? null
            : Number(log.liters),
        vendor: log.vendor || null,
        journey_id: log.journey_id || null,
        allocation_status: log.allocation_status || null,
        fuel_source: log.fuel_source || null,
        created_at: log.created_at || null,
      }));
  } catch {
    return [];
  }
}

async function fetchRecentTruckJourneys(companyId: string, truckId: string, truck: any) {
  try {
    const keys = new Set(
      [truckId, truck?.truck_id, truck?.registration]
        .map(normalizeTruckKey)
        .filter(Boolean)
    );
    const { data, error } = await supabaseAdmin
      .from("journeys")
      .select("internal_trip_id, status, client_name, from_location, to_location, truck, driver, created_at")
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return (data || [])
      .filter((journey: any) => keys.has(normalizeTruckKey(journey.truck)))
      .slice(0, 5)
      .map((journey: any) => ({
        reference: journey.internal_trip_id || null,
        status: journey.status || null,
        client_name: journey.client_name || null,
        from_location: journey.from_location || null,
        to_location: journey.to_location || null,
        truck: journey.truck || null,
        driver: journey.driver || null,
        created_at: journey.created_at || null,
      }));
  } catch {
    return [];
  }
}

async function fetchLatestFuelRiskScore(companyId: string, truckId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from("fuel_risk_scores")
      .select("truck_id, risk_score, risk_level, recommendation, created_at")
      .eq("company_id", companyId)
      .eq("truck_id", truckId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
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
