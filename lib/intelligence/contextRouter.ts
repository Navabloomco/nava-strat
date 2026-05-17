// lib/intelligence/contextRouter.ts
import { supabaseAdmin } from "../supabaseAdmin";
import { analyzeTruckFuelRisk } from "./fuelRiskEngine.universal";
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
    context.offline_trucks = await fetchOfflineTrucks(companyId);
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
    context.truck = await fetchTruckStatus(companyId, truckId);
    context.recent_events = await fetchTruckEvents(companyId, truckId);
    context.recent_telemetry = await fetchTruckTelemetry(companyId, truckId);
  }
  if (intent === "driver_activity") {
    context.driver_assignments = await fetchRecentDriverAssignments(companyId);
    context.driver_related_events = await fetchRecentEvents(companyId);
  }
  if (intent === "journey_context") {
    context.possible_journey_context = truckAccess.restricted
      ? { asset_access_restricted: true }
      : await fetchJourneyLikeContext(companyId, truckId);
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
    context.recent_events = await fetchRecentEvents(companyId);
  }
  return context;
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

async function fetchOfflineTrucks(companyId: string) {
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

async function fetchTruckStatus(companyId: string, truckId: string) {
  const { data } = await supabaseAdmin
    .from("fleet_assets")
    .select("*")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .eq("intelligence_enabled", true)
    .maybeSingle();
  return data;
}

async function fetchTruckEvents(companyId: string, truckId: string) {
  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("*")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("created_at", { ascending: false })
    .limit(20);
  return data || [];
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

async function fetchRecentDriverAssignments(companyId: string) {
  const { data } = await supabaseAdmin
    .from("asset_driver_assignments")
    .select("*")
    .eq("company_id", companyId)
    .order("assigned_from", { ascending: false })
    .limit(20);
  return data || [];
}

async function fetchRecentEvents(companyId: string) {
  const enabledTruckIds = await fetchEnabledTruckIds(companyId);
  if (enabledTruckIds.length === 0) return [];

  const { data } = await supabaseAdmin
    .from("telemetry_events")
    .select("truck_id, event_type, severity, location_name, created_at")
    .eq("company_id", companyId)
    .in("truck_id", enabledTruckIds)
    .order("created_at", { ascending: false })
    .limit(30);
  return data || [];
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

async function fetchJourneyLikeContext(companyId: string, truckId: string | null) {
  const context: any = {};
  if (truckId) {
    context.truck = await fetchTruckStatus(companyId, truckId);
    context.recent_events = await fetchTruckEvents(companyId, truckId);
    context.recent_telemetry = await fetchTruckTelemetry(companyId, truckId);
  } else {
    context.recent_events = await fetchRecentEvents(companyId);
  }
  return context;
}
