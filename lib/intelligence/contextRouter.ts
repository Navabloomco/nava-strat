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
import {
  getVehicleMatchKeys,
  matchVehicleInFleet,
  normalizeVehicleKey,
} from "./entityResolver";
import { getRoleCapabilities } from "../api/roleAccess";

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
  | "investigation_context"
  | "spares_context"
  | "dashboard_followup"
  | "general";

type RouteContextOptions = {
  roles?: string[];
  roleCapabilities?: ReturnType<typeof getRoleCapabilities>;
  dashboardContext?: any;
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
  const dashboardReference = resolveDashboardReference(
    lower,
    options.dashboardContext,
    companyId
  );
  if (dashboardReference) {
    intent = "dashboard_followup";
  }
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
  const roleCapabilities =
    options.roleCapabilities || getRoleCapabilities(options.roles || []);
  const sparesCostVisible = roleCapabilities.canViewFinance;
  const financialsVisible = roleCapabilities.canViewFinance;
  const permissionBoundary = getPermissionBoundary(lower, roleCapabilities);
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
    financials_visible: financialsVisible,
    capabilities: sanitizeCapabilities(roleCapabilities),
    permission_boundary: permissionBoundary,
    generated_at: new Date().toISOString(),
  };

  if (
    permissionBoundary &&
    !(
      intent === "investigation_context" &&
      truckId &&
      !context.asset_access_restricted
    )
  ) {
    return context;
  }

  if (intent === "fleet_health") {
    context.fleet_health = await fetchFleetHealth(companyId);
  }
  if (intent === "dashboard_followup" && dashboardReference) {
    context.dashboard_followup = await fetchDashboardFollowupContext(
      companyId,
      dashboardReference,
      geofences
    );
    return context;
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
  if (intent === "investigation_context" && !context.asset_access_restricted) {
    context.investigation_focus = detectInvestigationFocus(lower);
    if (truckId) {
      context.investigation_case_file = await fetchVehicleInvestigationCaseFile(
        companyId,
        vehicleMatch,
        context.investigation_focus,
        {
          geofences,
          assignmentLookup,
          costVisible: sparesCostVisible,
          financialsVisible,
        }
      );
    } else {
      context.fleet_health = await fetchFleetHealth(companyId);
      context.recent_events = await fetchRecentEvents(
        companyId,
        geofences,
        assignmentLookup
      );
      if (context.investigation_focus.profitability_focus && financialsVisible) {
        context.profitability = await getCompanyProfitability(companyId);
      }
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
    if (financialsVisible) {
      context.profit_simulation = simulateProfit(question);
    } else {
      context.financial_access_restricted = true;
      context.financial_access_message =
        "Financial calculations are available to owner, admin, finance, management, and platform owner roles.";
    }
  }
  if (intent === "profitability") {
    if (financialsVisible) {
      context.profitability = await getCompanyProfitability(companyId);
    } else {
      context.financial_access_restricted = true;
      context.financial_access_message =
        "Financial values are available to owner, admin, finance, management, and platform owner roles.";
    }
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
  return [
    "investigation_context",
    "fuel_risk",
    "truck_status",
    "journey_context",
    "offline_trucks",
    "dashboard_followup",
    "general",
  ].includes(intent);
}

function usesDriverAssignmentContext(intent: ContextIntent) {
  return [
    "investigation_context",
    "fuel_risk",
    "truck_status",
    "journey_context",
    "driver_activity",
    "offline_trucks",
    "general",
  ].includes(intent);
}

function resolveDashboardReference(
  lower: string,
  rawDashboardContext: any,
  companyId: string
) {
  const dashboardContext = sanitizeDashboardContext(rawDashboardContext, companyId);
  if (!dashboardContext) return null;

  const referencesVisibleDashboard =
    /\b(those|these|them|shown|show me|that list|the list|card|dashboard|top|highest)\b/.test(
      lower
    ) ||
    lower.includes("highest idle") ||
    lower.includes("highest risk") ||
    lower.includes("top idle") ||
    lower.includes("top risk");

  if (!referencesVisibleDashboard) return null;

  const requestedCount = extractRequestedCount(lower);
  const idleRequested =
    /\b(idle|idling|stopping|stopped|parked|waiting)\b/.test(lower) ||
    lower.includes("highest idle") ||
    lower.includes("top idle");
  const riskRequested =
    /\b(risk|risky|critical|event|events)\b/.test(lower) ||
    lower.includes("highest risk") ||
    lower.includes("top risk");

  if (idleRequested && dashboardContext.highest_idle_trucks.length) {
    return {
      source: "highest_idle_trucks",
      label: "highest idle trucks",
      trucks: dashboardContext.highest_idle_trucks.slice(
        0,
        requestedCount || dashboardContext.highest_idle_trucks.length
      ),
    };
  }

  if (riskRequested && dashboardContext.highest_risk_trucks.length) {
    return {
      source: "highest_risk_trucks",
      label: "highest risk trucks",
      trucks: dashboardContext.highest_risk_trucks.slice(
        0,
        requestedCount || dashboardContext.highest_risk_trucks.length
      ),
    };
  }

  const visibleTrucks = uniqueDashboardTrucks([
    ...dashboardContext.highest_idle_trucks,
    ...dashboardContext.highest_risk_trucks,
    ...dashboardContext.recent_critical_events,
  ]);

  if (!visibleTrucks.length) return null;

  return {
    source: "visible_dashboard_trucks",
    label: "trucks shown on the dashboard",
    trucks: visibleTrucks.slice(0, requestedCount || 8),
  };
}

function sanitizeDashboardContext(rawDashboardContext: any, companyId: string) {
  if (!rawDashboardContext || typeof rawDashboardContext !== "object") return null;
  const contextCompanyId = String(rawDashboardContext.active_company_id || "");
  if (contextCompanyId && contextCompanyId !== companyId) return null;

  return {
    highest_idle_trucks: sanitizeDashboardTruckList(
      rawDashboardContext.highest_idle_trucks,
      "idle"
    ),
    highest_risk_trucks: sanitizeDashboardTruckList(
      rawDashboardContext.highest_risk_trucks,
      "risk"
    ),
    recent_critical_events: sanitizeDashboardTruckList(
      rawDashboardContext.recent_critical_events,
      "critical_event"
    ),
  };
}

function sanitizeDashboardTruckList(rawList: any, source: string) {
  if (!Array.isArray(rawList)) return [];

  return rawList
    .slice(0, 10)
    .map((item: any) => {
      const truckId = String(item?.truck_id || "").trim();
      if (!truckId || truckId.length > 40) return null;

      return {
        truck_id: truckId,
        source,
        idle_minutes: finiteOrNull(item?.idle_minutes),
        idle_hours: item?.idle_hours === undefined ? null : String(item.idle_hours),
        event_count: finiteOrNull(item?.event_count),
        event_type: item?.event_type ? String(item.event_type).slice(0, 80) : null,
        severity: item?.severity ? String(item.severity).slice(0, 40) : null,
        location_name: item?.location_name
          ? String(item.location_name).slice(0, 120)
          : null,
        created_at: item?.created_at ? String(item.created_at).slice(0, 40) : null,
      };
    })
    .filter(Boolean);
}

function uniqueDashboardTrucks(trucks: any[]) {
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const truck of trucks) {
    const key = normalizeTruckKey(truck?.truck_id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(truck);
  }

  return unique;
}

function extractRequestedCount(lower: string) {
  const wordCounts: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };
  const digitMatch = lower.match(/\b([1-9]|10)\b/);
  if (digitMatch) return Number(digitMatch[1]);

  for (const [word, count] of Object.entries(wordCounts)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) return count;
  }

  return null;
}

function finiteOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeCapabilities(capabilities: ReturnType<typeof getRoleCapabilities>) {
  return {
    canViewFinance: Boolean(capabilities.canViewFinance),
    canEditFinance: Boolean(capabilities.canEditFinance),
    canViewExpenses: Boolean(capabilities.canViewExpenses),
    canViewBilling: Boolean(capabilities.canViewBilling),
    canViewPlatformBilling: Boolean(capabilities.canViewPlatformBilling),
    canViewOps: Boolean(capabilities.canViewOps),
    canViewFuel: Boolean(capabilities.canViewFuel),
    canViewJourneys: Boolean(capabilities.canViewJourneys),
    canViewSpares: Boolean(capabilities.canViewSpares),
    isPlatformOwner: Boolean(capabilities.isPlatformOwner),
  };
}

function getPermissionBoundary(
  lower: string,
  capabilities: ReturnType<typeof getRoleCapabilities>
) {
  if (asksForProviderSecrets(lower)) {
    return {
      category: "provider_secrets",
      message:
        "I can help with provider status and safe diagnostics, but I cannot expose provider credentials, tokens, auth configs, cookies, or raw payloads.",
    };
  }

  if (asksForPlatformBilling(lower) && !capabilities.canViewPlatformBilling) {
    return {
      category: "platform_billing",
      message:
        "I can help with operational context, but platform tenant billing and pilot billing data are restricted to platform owners.",
    };
  }

  if (asksForBilling(lower) && !capabilities.canViewBilling) {
    return {
      category: "billing",
      message:
        "I can help with operational context, but billing and invoice data are restricted for your role.",
    };
  }

  if (asksForExpenses(lower) && !capabilities.canViewExpenses) {
    return {
      category: "expenses",
      message:
        "I can help with operational context, but expense ledger data is restricted for your role.",
    };
  }

  if (asksForFinance(lower) && !capabilities.canViewFinance) {
    return {
      category: "finance",
      message:
        "I can help with operational context, but revenue, rates, profit, and margin data are restricted for your role.",
    };
  }

  return null;
}

function asksForProviderSecrets(lower: string) {
  return (
    /\b(password|secret|token|cookie|authorization|auth config|api key|credentials?|raw payload|raw response)\b/.test(
      lower
    ) &&
    /\b(provider|tracking|bluetrax|feed|sync|api)\b/.test(lower)
  );
}

function asksForPlatformBilling(lower: string) {
  return (
    lower.includes("tenant billing") ||
    lower.includes("platform billing") ||
    lower.includes("pilot billing") ||
    lower.includes("billing readiness") ||
    lower.includes("invoice preview") ||
    lower.includes("strict billable")
  );
}

function asksForBilling(lower: string) {
  return /\b(invoice|invoices|billing|billable|payment|paid|unpaid)\b/.test(lower);
}

function asksForExpenses(lower: string) {
  return /\b(expense|expenses|expense ledger|vendor spend|cost ledger)\b/.test(lower);
}

function asksForFinance(lower: string) {
  return /\b(revenue|profit|profits|profitable|profitability|margin|rate|rates|loss|losses|costing too much|unprofitable|financial|finance)\b/.test(
    lower
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
  if (detectInvestigationIntent(lower)) {
    return "investigation_context";
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

function detectInvestigationIntent(lower: string) {
  return (
    /\b(suspect|suspicious|why|always|problem|issue|check|investigate|compare|abnormal|siphon|siphoning|theft)\b/.test(lower) ||
    lower.includes("what happened") ||
    lower.includes("costing too much") ||
    lower.includes("unprofitable") ||
    lower.includes("repair failed") ||
    lower.includes("repair work") ||
    lower.includes("something wrong")
  );
}

function detectInvestigationFocus(lower: string) {
  return {
    fuel_focus:
      /\b(fuel|siphon|siphoning|theft|diesel|petrol|tank|receipt|dip)\b/.test(lower),
    stops_focus:
      /\b(stop|stops|stopping|idle|idling|parked|waiting|delay|always)\b/.test(lower),
    profitability_focus:
      lower.includes("costing too much") ||
      lower.includes("unprofitable") ||
      /\b(profit|loss|losses|margin|cost|costs|expensive|revenue)\b/.test(lower),
    repair_focus:
      lower.includes("repair failed") ||
      /\b(repair|repaired|fixed|maintenance|spare|part|tyre|tire|battery|brake|filter)\b/.test(lower),
    driver_focus:
      /\b(driver|driving|behaviour|behavior|assigned|responsible)\b/.test(lower),
    route_focus:
      /\b(route|trip|journey|client|mombasa|nairobi|kampala|port|yard)\b/.test(lower),
  };
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

async function fetchDashboardFollowupContext(
  companyId: string,
  reference: any,
  geofences: any[] = []
) {
  const requestedTrucks = uniqueDashboardTrucks(reference.trucks || []).slice(0, 10);
  if (!requestedTrucks.length) {
    return {
      source: reference.source,
      label: reference.label,
      checked_at: new Date().toISOString(),
      trucks: [],
      unmatched_trucks: [],
    };
  }

  const { data: assets, error: assetError } = await supabaseAdmin
    .from("fleet_assets")
    .select(
      "id, truck_id, registration, latitude, longitude, last_seen_at, provider_location_label, asset_category"
    )
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  if (assetError) throw assetError;

  const enabledAssets = assets || [];
  const checkedTrucks = await Promise.all(
    requestedTrucks.map(async (requestedTruck: any) => {
      const requestedKey = normalizeTruckKey(requestedTruck.truck_id);
      const asset = enabledAssets.find((item) =>
        getVehicleMatchKeys(item).includes(requestedKey)
      );

      if (!asset) {
        return {
          truck_id: requestedTruck.truck_id,
          dashboard_context: requestedTruck,
          enabled_for_intelligence: false,
          current_status: "unknown",
          confidence: "low",
          reason:
            "I could not safely match this dashboard truck to an enabled intelligence asset.",
        };
      }

      const [latestTelemetry, idleEvents] = await Promise.all([
        fetchLatestDashboardTelemetry(companyId, asset.truck_id),
        fetchRecentDashboardIdleEvents(companyId, asset.truck_id),
      ]);
      const assessment = assessDashboardTruckStatus(asset, latestTelemetry, idleEvents);
      const locationPoint =
        Number.isFinite(Number(latestTelemetry?.latitude)) &&
        Number.isFinite(Number(latestTelemetry?.longitude))
          ? latestTelemetry
          : asset;

      return {
        truck_id: asset.truck_id,
        registration: asset.registration || null,
        dashboard_context: requestedTruck,
        enabled_for_intelligence: true,
        last_seen_at: latestTelemetry?.recorded_at || asset.last_seen_at || null,
        latest_recorded_at: latestTelemetry?.recorded_at || null,
        latest_speed: latestTelemetry?.speed ?? null,
        provider_location_label: asset.provider_location_label || null,
        geofence_match: matchPointToGeofence(locationPoint, geofences),
        recent_idle_events_count: idleEvents.length,
        latest_idle_event: idleEvents[0]
          ? {
              event_type: idleEvents[0].event_type,
              created_at: idleEvents[0].created_at,
              started_at: idleEvents[0].started_at,
              duration_minutes: idleEvents[0].duration_minutes ?? null,
              location_name: idleEvents[0].location_name || null,
              context_label: idleEvents[0].context_label || null,
            }
          : null,
        current_status: assessment.status,
        confidence: assessment.confidence,
        freshness_minutes: assessment.freshness_minutes,
        reason: assessment.reason,
      };
    })
  );

  return {
    source: reference.source,
    label: reference.label,
    requested_truck_ids: requestedTrucks.map((truck: any) => truck.truck_id),
    checked_at: new Date().toISOString(),
    trucks: checkedTrucks,
    unmatched_trucks: checkedTrucks.filter(
      (truck: any) => !truck.enabled_for_intelligence
    ),
  };
}

async function fetchLatestDashboardTelemetry(companyId: string, truckId: string) {
  const { data, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select("truck_id, recorded_at, latitude, longitude, speed")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("recorded_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function fetchRecentDashboardIdleEvents(companyId: string, truckId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("telemetry_events")
    .select(
      "truck_id, event_type, severity, location_name, created_at, started_at, duration_minutes, context_label, context_type"
    )
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .in("event_type", ["excessive_idle", "idle", "stopped", "long_stop"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return data || [];
}

function assessDashboardTruckStatus(asset: any, latestTelemetry: any, idleEvents: any[]) {
  const latestAt = latestTelemetry?.recorded_at || asset?.last_seen_at || null;
  if (!latestAt) {
    return {
      status: "unknown",
      confidence: "low",
      freshness_minutes: null,
      reason: "No recent telemetry timestamp is available.",
    };
  }

  const freshnessMinutes = Math.floor((Date.now() - new Date(latestAt).getTime()) / 60000);
  const speed =
    latestTelemetry?.speed === null || latestTelemetry?.speed === undefined
      ? null
      : Number(latestTelemetry.speed);
  const latestIdleAt = idleEvents[0]?.created_at || idleEvents[0]?.started_at || null;
  const idleAgeMinutes = latestIdleAt
    ? Math.floor((Date.now() - new Date(latestIdleAt).getTime()) / 60000)
    : null;

  if (!Number.isFinite(freshnessMinutes) || freshnessMinutes > 60) {
    return {
      status: "stale",
      confidence: "low",
      freshness_minutes: Number.isFinite(freshnessMinutes)
        ? freshnessMinutes
        : null,
      reason:
        "The latest telemetry is stale, so I cannot say what it is doing right now.",
    };
  }

  if (Number.isFinite(speed) && Number(speed) > 5) {
    return {
      status: "moving",
      confidence: "high",
      freshness_minutes: freshnessMinutes,
      reason: "Fresh telemetry shows movement speed above idle range.",
    };
  }

  if (
    Number.isFinite(speed) &&
    Number(speed) <= 2 &&
    idleAgeMinutes !== null &&
    idleAgeMinutes <= 120
  ) {
    return {
      status: "still_idling",
      confidence: "high",
      freshness_minutes: freshnessMinutes,
      reason:
        "Fresh zero/low-speed telemetry plus a recent idle event strongly suggests it is still idle or stationary.",
    };
  }

  if (Number.isFinite(speed) && Number(speed) <= 2) {
    return {
      status: "stopped_or_idle",
      confidence: "medium",
      freshness_minutes: freshnessMinutes,
      reason:
        "Fresh low-speed telemetry suggests it is stopped or idling, but the latest idle event is not fresh enough for certainty.",
    };
  }

  return {
    status: "active_unknown",
    confidence: "medium",
    freshness_minutes: freshnessMinutes,
    reason:
      "Telemetry is fresh, but speed/status are not enough to classify it confidently.",
  };
}

function normalizeTruckKey(value: string | null | undefined) {
  return normalizeVehicleKey(value);
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
    getVehicleMatchKeys(item).some((key) => key === targetKey)
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
    fleetFuelAvailability,
  ] = await Promise.all([
    fetchTruckEvents(companyId, truckId, geofences, assignmentLookup),
    fetchFuelTelemetrySummary(companyId, truckId),
    fetchRecentFuelLogs(companyId, truckId, truck),
    fetchRecentTruckJourneys(companyId, truckId, truck),
    fetchLatestFuelRiskScore(companyId, truckId),
    fetchFleetFuelDataAvailability(companyId, truckId),
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
    fleet_fuel_data_availability: fleetFuelAvailability,
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
    const usableFuelReadings = fuelReadings.filter((point: any) =>
      isUsableFuelValue(point.fuel_level)
    );
    const usableFuelValues = usableFuelReadings.map((point: any) =>
      Number(point.fuel_level)
    );
    const latestFuel = usableFuelReadings[0] || fuelReadings[0] || null;
    const fuelTelemetryUsable = usableFuelReadings.length > 0;
    const fuelTelemetryReason = fuelTelemetryUsable
      ? "usable_recent_readings"
      : fuelReadings.length > 0
        ? "fuel_fields_all_zero_or_unknown"
        : telemetry.length > 0
          ? "no_numeric_fuel_values"
          : "no_recent_telemetry";

    return {
      telemetry_points: telemetry.length,
      fuel_readings: fuelReadings.length,
      usable_fuel_readings: usableFuelReadings.length,
      latest_fuel_level: latestFuel ? Number(latestFuel.fuel_level) : null,
      latest_fuel_unit: latestFuel?.fuel_unit || null,
      latest_fuel_at: latestFuel?.recorded_at || null,
      min_fuel_level: fuelValues.length ? Math.min(...fuelValues) : null,
      max_fuel_level: fuelValues.length ? Math.max(...fuelValues) : null,
      min_usable_fuel_level: usableFuelValues.length
        ? Math.min(...usableFuelValues)
        : null,
      max_usable_fuel_level: usableFuelValues.length
        ? Math.max(...usableFuelValues)
        : null,
      fuel_telemetry_available: fuelReadings.length > 0,
      fuel_telemetry_usable: fuelTelemetryUsable,
      fuel_telemetry_reason: fuelTelemetryReason,
    };
  } catch (err: any) {
    return {
      telemetry_points: 0,
      fuel_readings: 0,
      usable_fuel_readings: 0,
      latest_fuel_level: null,
      latest_fuel_unit: null,
      latest_fuel_at: null,
      min_fuel_level: null,
      max_fuel_level: null,
      min_usable_fuel_level: null,
      max_usable_fuel_level: null,
      fuel_telemetry_available: false,
      fuel_telemetry_usable: false,
      fuel_telemetry_reason: "fuel_telemetry_unavailable",
      error: err.message || "Fuel telemetry summary unavailable",
    };
  }
}

async function fetchFleetFuelDataAvailability(companyId: string, excludedTruckId: string) {
  const enabledTruckIds = await fetchEnabledTruckIds(companyId);
  const excludedKey = normalizeTruckKey(excludedTruckId);
  const otherTruckIds = enabledTruckIds.filter(
    (truckId) => normalizeTruckKey(truckId) !== excludedKey
  );

  if (otherTruckIds.length === 0) {
    return {
      other_enabled_assets_checked: 0,
      other_vehicles_with_usable_fuel_telemetry: 0,
      other_vehicles_with_recent_fuel_scores: 0,
      other_usable_fuel_data_available: false,
    };
  }

  const [telemetryResult, scoreResult] = await Promise.all([
    supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, fuel_level, recorded_at")
      .eq("company_id", companyId)
      .in("truck_id", otherTruckIds)
      .order("recorded_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("fuel_risk_scores")
      .select("truck_id, risk_score, created_at")
      .eq("company_id", companyId)
      .in("truck_id", otherTruckIds)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const trucksWithUsableTelemetry = new Set<string>();
  for (const point of telemetryResult.data || []) {
    if (isUsableFuelValue(point.fuel_level) && point.truck_id) {
      trucksWithUsableTelemetry.add(point.truck_id);
    }
  }

  const trucksWithRecentScores = new Set(
    (scoreResult.data || [])
      .filter((score: any) => score.truck_id)
      .map((score: any) => score.truck_id)
  );

  return {
    other_enabled_assets_checked: otherTruckIds.length,
    other_vehicles_with_usable_fuel_telemetry: trucksWithUsableTelemetry.size,
    other_vehicles_with_recent_fuel_scores: trucksWithRecentScores.size,
    other_usable_fuel_data_available:
      trucksWithUsableTelemetry.size > 0 || trucksWithRecentScores.size > 0,
  };
}

function isUsableFuelValue(value: any) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

async function fetchVehicleInvestigationCaseFile(
  companyId: string,
  vehicleMatch: any,
  focus: any,
  options: {
    geofences?: any[];
    assignmentLookup?: any;
    costVisible?: boolean;
    financialsVisible?: boolean;
  } = {}
) {
  const truckId =
    vehicleMatch.matched_truck_id || vehicleMatch.matched_registration || null;
  if (!truckId || !vehicleMatch.enabled_for_intelligence) return null;

  const geofences = options.geofences || [];
  const assignmentLookup = options.assignmentLookup || null;
  const costVisible = Boolean(options.costVisible);
  const financialsVisible = Boolean(options.financialsVisible);
  const enabledAssetLookup = await fetchEnabledAssetLookup(companyId);

  const [
    assetStatus,
    recentEvents,
    telemetrySummary,
    fuelSummary,
    journeys,
    sparesHistory,
    financialSummary,
  ] = await Promise.all([
    fetchTruckStatus(companyId, truckId, geofences, assignmentLookup),
    fetchTruckEvents(companyId, truckId, geofences, assignmentLookup),
    fetchInvestigationTelemetrySummary(companyId, truckId),
    fetchInvestigationFuelSummary(companyId, truckId, geofences, assignmentLookup),
    fetchRecentTruckJourneys(companyId, truckId, null),
    fetchTruckSpareHistory(companyId, truckId, costVisible, enabledAssetLookup),
    financialsVisible
      ? fetchTruckFinancialSummary(companyId, truckId)
      : Promise.resolve({ visible: false }),
  ]);

  const stopLikeEvents = recentEvents.filter((event: any) =>
    ["excessive_idle", "idle", "stopped", "long_stop"].includes(event.event_type)
  );
  const fuelEvents = recentEvents.filter((event: any) =>
    ["fuel_drop_stationary", "low_fuel"].includes(event.event_type)
  );
  const latestJourney = journeys[0] || null;

  return {
    entity_match: vehicleMatch,
    focus,
    asset_status: assetStatus,
    latest_location: assetStatus
      ? {
          provider_location_label: assetStatus.provider_location_label || null,
          geofence_match: assetStatus.geofence_match || null,
          last_seen_at: assetStatus.last_seen_at || null,
        }
      : null,
    assigned_driver: assetStatus?.assigned_driver || null,
    recent_telemetry_summary: telemetrySummary,
    fuel_summary: fuelSummary,
    events_alerts_summary: {
      recent_event_count: recentEvents.length,
      stop_like_events: stopLikeEvents.slice(0, 8),
      fuel_events: fuelEvents.slice(0, 8),
      context_labels: Array.from(
        new Set(
          recentEvents
            .map((event: any) => event.context_label)
            .filter(Boolean)
        )
      ).slice(0, 5),
    },
    journey_summary: {
      recent_journeys: journeys,
      active_or_latest_journey: latestJourney,
      has_recent_journey: journeys.length > 0,
    },
    spares_repair_summary: {
      recent_events: sparesHistory.slice(0, 8),
      event_count: sparesHistory.length,
      has_repair_history: sparesHistory.length > 0,
    },
    financial_summary: financialSummary,
    data_quality_summary: buildInvestigationDataQualitySummary({
      assetStatus,
      telemetrySummary,
      fuelSummary,
      journeys,
      sparesHistory,
    }),
  };
}

async function fetchInvestigationTelemetrySummary(companyId: string, truckId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select("recorded_at, speed, latitude, longitude")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const points = data || [];
  const latest = points[0] || null;
  const stationaryPoints = points.filter((point: any) => Number(point.speed || 0) <= 1);
  const movingPoints = points.filter((point: any) => Number(point.speed || 0) > 1);
  const staleMinutes = latest?.recorded_at
    ? Math.floor((Date.now() - new Date(latest.recorded_at).getTime()) / 60000)
    : null;

  return {
    window_days: 7,
    telemetry_points: points.length,
    latest_recorded_at: latest?.recorded_at || null,
    stale_minutes: staleMinutes,
    is_stale: staleMinutes === null || staleMinutes > 60,
    stationary_points: stationaryPoints.length,
    moving_points: movingPoints.length,
  };
}

async function fetchInvestigationFuelSummary(
  companyId: string,
  truckId: string,
  geofences: any[] = [],
  assignmentLookup: any = null
) {
  const [telemetrySummary, fuelLogs, latestFuelScore, recentEvents] =
    await Promise.all([
      fetchFuelTelemetrySummary(companyId, truckId),
      fetchRecentFuelLogs(companyId, truckId, null),
      fetchLatestFuelRiskScore(companyId, truckId),
      fetchTruckEvents(companyId, truckId, geofences, assignmentLookup),
    ]);

  return {
    telemetry: telemetrySummary,
    manual_entries: fuelLogs,
    latest_score: latestFuelScore,
    fuel_events: recentEvents.filter((event: any) =>
      ["fuel_drop_stationary", "low_fuel"].includes(event.event_type)
    ),
  };
}

async function fetchTruckFinancialSummary(companyId: string, truckId: string) {
  const keys = new Set([normalizeTruckKey(truckId)].filter(Boolean));
  const [journeysResult, fuelResult, expensesResult] = await Promise.all([
    supabaseAdmin
      .from("journeys")
      .select("id, internal_trip_id, truck, status, revenue_kes, client_name, from_location, to_location, created_at")
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("fuel_logs")
      .select("journey_id, truck_text, total_cost, liters, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("expenses")
      .select("journey_id, truck, amount, expense_type, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (journeysResult.error) throw journeysResult.error;
  if (fuelResult.error) throw fuelResult.error;
  if (expensesResult.error) throw expensesResult.error;

  const journeys = (journeysResult.data || [])
    .filter((journey: any) => keys.has(normalizeTruckKey(journey.truck)))
    .slice(0, 20);
  const journeyIds = new Set(journeys.map((journey: any) => journey.id));
  const fuelLogs = (fuelResult.data || []).filter(
    (fuel: any) =>
      (fuel.journey_id && journeyIds.has(fuel.journey_id)) ||
      keys.has(normalizeTruckKey(fuel.truck_text))
  );
  const expenses = (expensesResult.data || []).filter(
    (expense: any) =>
      (expense.journey_id && journeyIds.has(expense.journey_id)) ||
      keys.has(normalizeTruckKey(expense.truck))
  );

  const revenue = journeys.reduce(
    (sum: number, journey: any) => sum + Number(journey.revenue_kes || 0),
    0
  );
  const fuelCost = fuelLogs.reduce(
    (sum: number, fuel: any) => sum + Number(fuel.total_cost || 0),
    0
  );
  const expenseCost = expenses.reduce(
    (sum: number, expense: any) => sum + Number(expense.amount || 0),
    0
  );

  return {
    visible: true,
    journey_count: journeys.length,
    fuel_log_count: fuelLogs.length,
    expense_count: expenses.length,
    revenue_kes: revenue,
    fuel_cost_kes: fuelCost,
    expense_cost_kes: expenseCost,
    estimated_profit_kes: revenue - fuelCost - expenseCost,
    latest_journeys: journeys.slice(0, 5).map((journey: any) => ({
      reference: journey.internal_trip_id || null,
      status: journey.status || null,
      client_name: journey.client_name || null,
      from_location: journey.from_location || null,
      to_location: journey.to_location || null,
      revenue_kes: Number(journey.revenue_kes || 0),
      created_at: journey.created_at || null,
    })),
  };
}

function buildInvestigationDataQualitySummary(input: any) {
  const flags: string[] = [];
  const telemetry = input.telemetrySummary || {};
  const fuelTelemetry = input.fuelSummary?.telemetry || {};

  if (!input.assetStatus?.last_seen_at || telemetry.is_stale) {
    flags.push("stale_telemetry");
  }
  if (!input.journeys?.length) {
    flags.push("missing_journeys");
  }
  if (
    fuelTelemetry.fuel_readings > 0 &&
    fuelTelemetry.fuel_telemetry_usable === false
  ) {
    flags.push("all_zero_or_unusable_fuel_sensor_fields");
  }
  if (!input.fuelSummary?.manual_entries?.length) {
    flags.push("no_manual_fuel_entries");
  }
  if (!input.sparesHistory?.length) {
    flags.push("thin_repair_spares_history");
  }

  return {
    flags,
    history_window_days: 7,
    notes: flags.map(formatDataQualityFlag),
  };
}

function formatDataQualityFlag(flag: string) {
  const labels: Record<string, string> = {
    stale_telemetry: "Telemetry is stale or missing recently.",
    missing_journeys: "No recent journey record was found for this vehicle.",
    all_zero_or_unusable_fuel_sensor_fields:
      "Fuel fields exist but are all zero/unknown, so they are not useful yet.",
    no_manual_fuel_entries: "No recent manual fuel entries were found.",
    thin_repair_spares_history:
      "Repair/spares history is thin, so lifespan conclusions would be weak.",
  };

  return labels[flag] || flag;
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
    for (const key of getVehicleMatchKeys(asset)) {
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

  return getVehicleMatchKeys(asset).some((key) => key === eventKey) ||
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
