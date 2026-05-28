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
import {
  operationalTimeZoneLabel,
  resolveOperationalDayRange,
  resolveOperationalTimeZone,
} from "../timeFormatting";
import { resolveOperationalLocation } from "../location/resolveOperationalLocation";
import { buildTruckTimelineIntelligence } from "./truckTimelineService";
import {
  buildBusinessMetricContext,
  detectBusinessMetricIntent,
  resolveBusinessMetricTimeframe,
} from "./metricEngine";
import { buildTripIntelligenceSummary } from "./tripIntelligence";
import {
  IDLE_COMPATIBILITY_EVENT_TYPES,
  isProviderIdleMarkerEvent,
} from "../providers/providerIdleMarkers";
import { buildSafeProviderTestSummary } from "../providers/testSummary";
import {
  parseNavaEyeQuery,
  type NavaEyeStructuredQuery,
  type NavaEyePeriod,
} from "./queryUnderstanding";

export type ContextIntent =
  | "fleet_health"
  | "fleet_movement"
  | "offline_trucks"
  | "fuel_risk"
  | "truck_status"
  | "driver_activity"
  | "journey_context"
  | "country_trucks"
  | "profit_simulation"
  | "profitability"
  | "trip_performance"
  | "evidence_review"
  | "finance_review"
  | "provider_capability"
  | "metric_comparison"
  | "business_metrics"
  | "investigation_context"
  | "spares_context"
  | "dashboard_followup"
  | "truck_compound"
  | "general";

type RouteContextOptions = {
  roles?: string[];
  roleCapabilities?: ReturnType<typeof getRoleCapabilities>;
  dashboardContext?: any;
  structuredQuery?: NavaEyeStructuredQuery;
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
  const operationalTimeZone = resolveOperationalTimeZone(company);
  const structuredQuery =
    options.structuredQuery || parseNavaEyeQuery(question);
  const queryText = structuredQuery.normalized_text || question;
  const lower = queryText.toLowerCase();
  const detectedCountryName = detectSupportedCountryName(queryText);
  const tripPerformanceRequest = detectTripPerformanceIntent(lower);
  const parsedBusinessMetricIntent =
    structuredQuery.intent_family === "distance" ||
    (structuredQuery.intent_family === "compare_metric" && structuredQuery.metric === "distance")
      ? "distance_covered"
      : null;
  const businessMetricIntent = tripPerformanceRequest
    ? null
    : parsedBusinessMetricIntent || detectBusinessMetricIntent(lower);
  const businessMetricTimeframe = businessMetricIntent
    ? resolveBusinessMetricTimeframe(queryText, company)
    : null;
  let intent = detectIntent(
    lower,
    detectedCountryName,
    businessMetricIntent,
    tripPerformanceRequest,
    structuredQuery
  );
  const locationEvidenceRequest = detectLocationEvidenceRequest(lower);
  const answerDetailRequest = detectAnswerDetailRequest(lower);
  const providerIdleMarkerRequest = detectProviderIdleMarkerRequest(lower);
  const dashboardReference = resolveDashboardReference(
    lower,
    options.dashboardContext,
    companyId
  );
  if (dashboardReference) {
    intent = "dashboard_followup";
  }
  const vehicleMatch = await matchVehicleInFleet(queryText, companyId);
  const timelineHistoryRequest =
    detectTimelineHistoryRequest(lower) || locationEvidenceRequest;
  const compoundTruckRequest = vehicleMatch.input
    ? detectCompoundTruckRequest(lower)
    : null;
  if (compoundTruckRequest) {
    intent = "truck_compound";
  }
  if (
    vehicleMatch.input &&
    timelineHistoryRequest &&
    ["general", "truck_status", "driver_activity", "journey_context", "fleet_movement"].includes(intent)
  ) {
    intent = "truck_status";
  }
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
  const rawCoordinateRequested =
    detectCoordinateRequest(lower) || detectLocationPinRequest(lower);
  const permissionBoundary =
    getPermissionBoundary(lower, roleCapabilities, {
      allowTripPerformanceSummary: intent === "trip_performance",
    }) ||
    getIntentPermissionBoundary(intent, roleCapabilities);
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
      ? buildAssetAccessRestrictedMessage(vehicleMatch)
      : null,
    fleet_asset_review_status: fleetAssetCounts,
    no_enabled_intelligence_assets:
      fleetAssetCounts.imported_assets > 0 && fleetAssetCounts.enabled_assets === 0,
    spares_cost_visible: sparesCostVisible,
    financials_visible: financialsVisible,
    coordinate_request:
      rawCoordinateRequested && Boolean((roleCapabilities as any).canViewRawCoordinates),
    raw_coordinate_request_restricted:
      rawCoordinateRequested && !Boolean((roleCapabilities as any).canViewRawCoordinates),
    location_evidence_requested: locationEvidenceRequest,
    location_pin_requested:
      detectLocationPinRequest(lower) && Boolean((roleCapabilities as any).canViewRawCoordinates),
    live_status_idle_focus: /\b(idle|idling|excessive idle|stopped|stationary)\b/.test(lower),
    timeline_detail_requested: detectDetailedTimelineRequest(lower),
    raw_idle_markers_requested: detectRawIdleMarkerRequest(lower),
    answer_detail_requested: answerDetailRequest,
    provider_idle_marker_request: providerIdleMarkerRequest,
    timeline_history_requested: timelineHistoryRequest,
    timeline_timeframe: resolveTruckTimelineTimeframe(lower),
    management_action_request: detectManagementActionRequest(lower),
    business_metric_intent: businessMetricIntent,
    business_metric_timeframe: businessMetricTimeframe,
    compound_truck_request: compoundTruckRequest,
    query_understanding: sanitizeStructuredQuery(structuredQuery),
    capabilities: sanitizeCapabilities(roleCapabilities),
    permission_boundary: permissionBoundary,
    display_timezone: {
      time_zone: operationalTimeZone,
      label: operationalTimeZoneLabel(operationalTimeZone),
    },
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
  if (intent === "metric_comparison") {
    context.metric_comparison = await fetchMetricComparisonContext(
      companyId,
      company,
      truckId,
      null,
      structuredQuery
    );
    return context;
  }
  if (intent === "evidence_review") {
    context.evidence_review = await fetchEvidenceReviewContext(
      companyId,
      queryText,
      financialsVisible
    );
    return context;
  }
  if (intent === "finance_review") {
    context.finance_review = await fetchFinanceReviewContext(companyId);
    return context;
  }
  if (intent === "provider_capability") {
    context.provider_capability = await fetchProviderCapabilityContext(companyId, queryText);
    return context;
  }
  if (intent === "fleet_movement") {
    context.fleet_movement_summary = await fetchFleetMovementSummary(
      companyId,
      company,
      context.timeline_timeframe
    );
    return context;
  }
  if (intent === "dashboard_followup" && dashboardReference) {
    context.dashboard_followup = await fetchDashboardFollowupContext(
      companyId,
      dashboardReference,
      geofences
    );
    return context;
  }
  if (intent === "truck_compound" && truckId && !context.asset_access_restricted) {
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

    const timelineSections = (compoundTruckRequest?.sections || []).filter((section: any) =>
      ["movement_timeline", "detailed_timeline"].includes(section.type)
    );
    const timelines: Record<string, any> = {};
    for (const section of timelineSections) {
      const key = timelineRequestKey(section.timeframe);
      if (!timelines[key]) {
        timelines[key] = await fetchTruckStopMotionTimelineComparison(
          companyId,
          truckId,
          geofences,
          company,
          section.timeframe
        );
      }
      section.timeline_key = key;
    }
    context.truck_timelines = timelines;
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
      if (timelineHistoryRequest) {
        context.truck_timeline_comparison = await fetchTruckStopMotionTimelineComparison(
          companyId,
          truckId,
          geofences,
          company,
          context.timeline_timeframe
        );
      }
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
    context.recent_journeys = await fetchRecentTruckJourneys(
      companyId,
      truckId,
      context.truck
    );
    if (timelineHistoryRequest) {
      context.truck_timeline_comparison = await fetchTruckStopMotionTimelineComparison(
        companyId,
        truckId,
        geofences,
        company,
        context.timeline_timeframe
      );
    }
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
    const countryTrucks = await getCurrentTrucksInCountry(companyId, detectedCountryName, {
      includeLocation: false,
    });
    context.country_fleet_location = {
      country: detectedCountryName,
      freshness_window_minutes: 30,
      trucks: await Promise.all(
        countryTrucks.map(async (truck: any) => ({
          ...truck,
          location_resolution: await resolveOperationalLocation({
            company_id: companyId,
            latitude: truck.latitude,
            longitude: truck.longitude,
            provider_location_label: truck.provider_location_label || truck.location,
            truck_id: truck.truck_id,
            geofences,
          }),
        }))
      ),
    };
  }
  if (intent === "profit_simulation") {
    if (financialsVisible) {
      context.profit_simulation = simulateProfit(queryText);
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
  if (intent === "trip_performance") {
    context.trip_performance = await fetchTripPerformanceContext({
      companyId,
      company,
      question: queryText,
      vehicleMatch,
      financeVisible: financialsVisible,
    });
    if (
      !context.trip_performance?.matched_trip &&
      truckId &&
      !context.asset_access_restricted
    ) {
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
    return context;
  }
  if (intent === "business_metrics" && businessMetricIntent && !context.asset_access_restricted) {
    context.business_metric = await buildBusinessMetricContext({
      companyId,
      company,
      intent: businessMetricIntent,
      truckId,
      timeframe: businessMetricTimeframe,
    });
    return context;
  }
  if (intent === "spares_context" && !context.asset_access_restricted) {
    context.spares = await fetchSparesContext(
      companyId,
      queryText,
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

function buildAssetAccessRestrictedMessage(vehicleMatch: any) {
  const providerLabel =
    vehicleMatch?.provider_label ||
    vehicleMatch?.matched_display_label ||
    vehicleMatch?.matched_registration ||
    vehicleMatch?.matched_truck_id ||
    vehicleMatch?.input ||
    "This provider asset";
  const inputLabel = vehicleMatch?.input || providerLabel;
  const askedTrailer =
    vehicleMatch?.match_type === "attached_trailer_context" ||
    Boolean(vehicleMatch?.trailer_context);

  if (askedTrailer && vehicleMatch?.provider_label) {
    const trailer = vehicleMatch?.attached_trailer_plate || inputLabel;
    return `${trailer} appears in the provider asset name ${vehicleMatch.provider_label}. That provider asset is present in Asset Review but is not enabled for Nava intelligence yet. Enable ${vehicleMatch.provider_label} before Nava Eye can answer live status. The location/status would come from the tracked provider asset, not independent trailer tracking.`;
  }

  if (
    vehicleMatch?.provider_label &&
    normalizeVehicleKey(inputLabel) !== normalizeVehicleKey(vehicleMatch.provider_label)
  ) {
    return `${inputLabel} matches provider asset ${vehicleMatch.provider_label}. ${vehicleMatch.provider_label} is present in Asset Review but is not enabled for Nava intelligence yet. Enable ${vehicleMatch.provider_label} before Nava Eye can answer live status.`;
  }

  return `${providerLabel} is present in Asset Review but is not enabled for Nava intelligence yet. Enable ${providerLabel} before Nava Eye can answer live status.`;
}

function getIntentPermissionBoundary(
  intent: ContextIntent,
  capabilities: ReturnType<typeof getRoleCapabilities>
) {
  const opsIntents: ContextIntent[] = [
    "fleet_health",
    "fleet_movement",
    "offline_trucks",
    "truck_status",
    "driver_activity",
    "journey_context",
    "country_trucks",
    "investigation_context",
    "truck_compound",
    "metric_comparison",
  ];
  if (opsIntents.includes(intent) && !capabilities.canViewOps) {
    return {
      category: "operations",
      message:
        "I can help within your role, but live tracking, movement, stopped/idle evidence, and operational telemetry are restricted for this role.",
    };
  }

  if (intent === "fuel_risk" && !capabilities.canViewFuel) {
    return {
      category: "fuel",
      message:
        "I can help within your role, but fuel ledger, allocation, and fuel-risk evidence are restricted for this role.",
    };
  }

  if (intent === "evidence_review" && !(capabilities as any).canViewEvidence) {
    return {
      category: "evidence",
      message:
        "I can help within your role, but evidence, receipts, and proof attachments are restricted for this role.",
    };
  }

  if (intent === "finance_review" && !capabilities.canViewFinance) {
    return {
      category: "finance",
      message:
        "I can help with operational context, but revenue review, rate rules, and finance amounts are restricted for your role.",
    };
  }

  if (
    intent === "provider_capability" &&
    !capabilities.canViewOps &&
    !capabilities.canViewFinance &&
    !(capabilities as any).canReviewAssets
  ) {
    return {
      category: "provider_capability",
      message:
        "I can help within your role, but provider capability diagnostics are restricted to operations, finance/management, and elevated support roles.",
    };
  }

  if (intent === "dashboard_followup" && !capabilities.canViewOps) {
    return {
      category: "operations",
      message:
        "I can help within your role, but dashboard truck follow-ups, live status, idle/stops, and operational telemetry are restricted for this role.",
    };
  }

  return null;
}

function usesLocationContext(intent: ContextIntent) {
  return [
    "investigation_context",
    "fuel_risk",
    "truck_status",
    "journey_context",
    "offline_trucks",
    "dashboard_followup",
    "truck_compound",
    "country_trucks",
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
    "truck_compound",
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
      label: "highest stopped/provider-idle-marker trucks",
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

async function fetchTripPerformanceContext(input: {
  companyId: string;
  company: any;
  question: string;
  vehicleMatch: any;
  financeVisible: boolean;
}) {
  const range = resolveTripPerformanceRange(input.question);
  const summary = await buildTripIntelligenceSummary({
    companyId: input.companyId,
    company: input.company,
    range,
    includeFinance: true,
  });
  const trips = Array.isArray(summary.trips) ? summary.trips : [];
  const match = selectTripPerformanceMatch(trips, input.question, input.vehicleMatch);
  const matchedTrip = match?.status === "matched" ? match.trip : null;
  const ambiguousTrips = match?.status === "ambiguous" ? match.candidates : [];

  return {
    source: "trip_intelligence",
    range,
    timeframe: sanitizeTripPerformanceTimeframe(summary.timeframe),
    finance_values_visible: input.financeVisible,
    matched_trip: matchedTrip
      ? sanitizeTripPerformanceRecord(matchedTrip, input.financeVisible)
      : null,
    ambiguous_trip: match?.status === "ambiguous",
    ambiguity_label: match?.status === "ambiguous" ? match.label : null,
    match: matchedTrip
      ? {
          score: match.score,
          reason: match.reason,
        }
      : null,
    candidate_trips: matchedTrip
      ? []
      : (ambiguousTrips.length ? ambiguousTrips : trips.slice(0, 5)).map((trip: any) =>
          sanitizeTripCandidate(trip, input.financeVisible)
        ),
    trip_count: trips.length,
  };
}

function resolveTripPerformanceRange(question: string) {
  const lower = String(question || "").toLowerCase();
  if (
    lower.includes("today") ||
    lower.includes("current day") ||
    lower.includes("same day")
  ) {
    return "today";
  }
  if (
    lower.includes("yesterday") ||
    lower.includes("previous day") ||
    lower.includes("last operating day")
  ) {
    return "yesterday";
  }
  return "7d";
}

function selectTripPerformanceMatch(trips: any[], question: string, vehicleMatch: any): any {
  if (!trips.length) return null;
  const sortedTrips = [...trips].sort((a, b) => tripSortTimeMs(b) - tripSortTimeMs(a));
  const criteria = buildTripPerformanceMatchCriteria(question, vehicleMatch);

  const exactReferenceMatches = sortedTrips.filter((trip) =>
    tripMatchesInternalReference(trip, criteria)
  );
  if (exactReferenceMatches.length) {
    return {
      status: "matched",
      trip: exactReferenceMatches[0],
      score: 120,
      reason: "internal_trip_id",
    };
  }

  const truckClientMatches = sortedTrips.filter(
    (trip) => tripMatchesTruck(trip, criteria) && tripMatchesClient(trip, criteria)
  );
  const truckClientResult = selectUniqueTripMatch(
    truckClientMatches,
    "truck+client",
    buildTripAmbiguityLabel(truckClientMatches, "matching truck/client")
  );
  if (truckClientResult) return truckClientResult;

  const truckRouteMatches = sortedTrips.filter(
    (trip) => tripMatchesTruck(trip, criteria) && tripMatchesRoute(trip, criteria)
  );
  const truckRouteResult = selectUniqueTripMatch(
    truckRouteMatches,
    "truck+route",
    buildTripAmbiguityLabel(truckRouteMatches, "matching truck/route")
  );
  if (truckRouteResult) return truckRouteResult;

  const clientOnlyMatches = sortedTrips.filter((trip) => tripMatchesClient(trip, criteria));
  const clientOnlyResult = selectUniqueTripMatch(
    clientOnlyMatches,
    "client",
    buildTripAmbiguityLabel(clientOnlyMatches, "matching client")
  );
  if (clientOnlyResult) return clientOnlyResult;

  const truckOnlyMatches = sortedTrips.filter((trip) => tripMatchesTruck(trip, criteria));
  const truckOnlyResult = selectUniqueTripMatch(
    truckOnlyMatches,
    "truck",
    buildTripAmbiguityLabel(truckOnlyMatches, "matching truck")
  );
  if (truckOnlyResult) return truckOnlyResult;

  if (sortedTrips.length === 1) {
    return {
      status: "matched",
      trip: sortedTrips[0],
      score: 20,
      reason: "only projected trip in range",
    };
  }

  return null;
}

function buildTripPerformanceMatchCriteria(question: string, vehicleMatch: any) {
  const questionText = normalizeTripText(question);
  const questionKey = normalizeVehicleKey(question);
  const vehicleKeys = [
    vehicleMatch?.input,
    vehicleMatch?.matched_truck_id,
    vehicleMatch?.matched_registration,
    vehicleMatch?.matched_display_label,
    vehicleMatch?.provider_label,
  ]
    .map((value) => normalizeVehicleKey(value))
    .filter(Boolean);

  return {
    questionText,
    questionKey,
    vehicleKeys,
  };
}

function selectUniqueTripMatch(matches: any[], reason: string, label: string) {
  if (!matches.length) return null;
  if (matches.length === 1) {
    return {
      status: "matched",
      trip: matches[0],
      score: reason === "truck+client" || reason === "truck+route" ? 85 : 55,
      reason,
    };
  }

  return {
    status: "ambiguous",
    candidates: matches.slice(0, 8),
    reason,
    label,
  };
}

function tripMatchesInternalReference(trip: any, criteria: any) {
  const identity = trip.trip_identity || {};
  const reference = identity.reference || identity.internal_trip_id;
  const referenceKey = normalizeVehicleKey(reference);
  return Boolean(referenceKey && criteria.questionKey.includes(referenceKey));
}

function tripMatchesTruck(trip: any, criteria: any) {
  const identity = trip.trip_identity || {};
  const truckKey = normalizeVehicleKey(identity.truck);
  if (!truckKey) return false;
  return criteria.questionKey.includes(truckKey) || criteria.vehicleKeys.includes(truckKey);
}

function tripMatchesClient(trip: any, criteria: any) {
  const identity = trip.trip_identity || {};
  const client = normalizeTripText(identity.client_name);
  return Boolean(client && criteria.questionText.includes(client));
}

function tripMatchesRoute(trip: any, criteria: any) {
  const identity = trip.trip_identity || {};
  const route = identity.route || {};
  for (const [label, value] of [
    ["origin", route.from_location],
    ["destination", route.to_location],
    ["route", route.route_label || route.route_name],
  ]) {
    const normalized = normalizeTripText(value);
    if (normalized && criteria.questionText.includes(normalized)) return true;
  }
  return false;
}

function buildTripAmbiguityLabel(matches: any[], fallback: string) {
  const first = matches[0]?.trip_identity || {};
  const parts = [first.truck, first.client_name].filter(Boolean);
  return parts.length ? parts.join(" ") : fallback;
}

function sanitizeTripPerformanceRecord(trip: any, financeVisible: boolean) {
  const identity = trip.trip_identity || {};
  const readiness = trip.profitability_readiness || {};
  const contribution = readiness.contribution_summary || {};
  const finance = trip.finance_evidence || {};
  const movement = trip.movement_evidence || {};
  const driver = trip.driver_evidence || {};
  const flags = Array.isArray(trip.management_flags) ? trip.management_flags : [];

  return {
    trip_id: identity.journey_id || null,
    reference: identity.reference || identity.internal_trip_id || "Trip",
    status: identity.status || null,
    truck: identity.truck || null,
    client_name: identity.client_name || null,
    route_label: identity.route?.route_label || null,
    driver_name: driver.driver_name || null,
    driver_evidence_label: driver.evidence_label || null,
    readiness_label:
      readiness.label || readiness.customer_label || profitabilityStatusLabel(readiness.status),
    readiness_status: readiness.status || null,
    finance_values_visible: financeVisible,
    revenue_present: Number(contribution.revenue_amount || finance.revenue_kes || 0) > 0,
    fuel_allocation_linked:
      finance.fuel_cost_source === "fuel_allocations" ||
      Number(contribution.linked_fuel_cost || 0) > 0,
    extra_expenses_linked: Boolean(contribution.extra_expenses_linked),
    linked_expense_count: Number(finance.linked_expense_count || 0),
    revenue_amount: financeVisible ? contribution.revenue_amount : null,
    linked_fuel_cost: financeVisible ? contribution.linked_fuel_cost : null,
    linked_expense_cost: financeVisible ? contribution.linked_expense_cost : null,
    linked_variable_cost: financeVisible ? contribution.linked_variable_cost : null,
    contribution_amount: financeVisible ? contribution.contribution_amount : null,
    contribution_margin_percent: financeVisible
      ? contribution.contribution_margin_percent
      : null,
    per_tonne_contribution: financeVisible ? contribution.per_tonne_contribution : null,
    per_km_contribution: financeVisible ? contribution.per_km_contribution : null,
    distance_based_metrics_available: Boolean(contribution.distance_based_metrics_available),
    per_km_distance_source: contribution.per_km_distance_source || movement.distance_source || "unavailable",
    per_km_metrics_provisional: Boolean(contribution.per_km_metrics_provisional),
    provider_distance_needed_for_final_per_km: Boolean(
      contribution.provider_distance_needed_for_final_per_km
    ),
    distance_source: movement.distance_source || "unavailable",
    missing_data: Array.isArray(trip.missing_data) ? trip.missing_data : [],
    caveats: Array.isArray(contribution.caveats)
      ? contribution.caveats
      : Array.isArray(readiness.supporting_notes)
        ? readiness.supporting_notes
        : [],
    flags: flags.filter((flag: string) =>
      [
        "revenue_without_movement_evidence",
        "stale_tracking",
        "needs_provider_distance",
        "delay_evidence_present",
      ].includes(flag)
    ),
  };
}

function sanitizeTripCandidate(trip: any, financeVisible = false) {
  const identity = trip.trip_identity || {};
  const readiness = trip.profitability_readiness || {};
  const contribution = readiness.contribution_summary || {};
  return {
    reference: identity.reference || identity.internal_trip_id || "Trip",
    date_label: formatTripCandidateDate(
      identity.start_time || identity.date_window?.start_utc || identity.created_at
    ),
    truck: identity.truck || null,
    client_name: identity.client_name || null,
    route_label: identity.route?.route_label || null,
    readiness_label:
      readiness.label || readiness.customer_label || profitabilityStatusLabel(readiness.status),
    contribution_amount: financeVisible ? contribution.contribution_amount : null,
    status: identity.status || null,
  };
}

function formatTripCandidateDate(value: any) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
}

function sanitizeTripPerformanceTimeframe(timeframe: any) {
  if (!timeframe || typeof timeframe !== "object") return null;
  return {
    requested: timeframe.requested || null,
    display_label: timeframe.display_label || null,
    local_start_date: timeframe.local_start_date || null,
    local_end_date: timeframe.local_end_date || null,
  };
}

function normalizeTripText(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tripSortTimeMs(trip: any) {
  const identity = trip.trip_identity || {};
  const value =
    identity.start_time ||
    identity.end_time ||
    identity.created_at ||
    trip.generated_at ||
    null;
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function profitabilityStatusLabel(status: any) {
  if (status === "calculable") return "Contribution review ready";
  if (status === "partially_linked") return "Partially linked";
  return "Not enough linked data";
}

function sanitizeCapabilities(capabilities: ReturnType<typeof getRoleCapabilities>) {
  return {
    canViewLiveTracking: Boolean((capabilities as any).canViewLiveTracking),
    canEditOps: Boolean((capabilities as any).canEditOps),
    canViewFinance: Boolean(capabilities.canViewFinance),
    canEditFinance: Boolean(capabilities.canEditFinance),
    canViewManagement: Boolean((capabilities as any).canViewManagement),
    canViewExpenses: Boolean(capabilities.canViewExpenses),
    canViewBilling: Boolean(capabilities.canViewBilling),
    canViewPlatformBilling: Boolean(capabilities.canViewPlatformBilling),
    canViewOps: Boolean(capabilities.canViewOps),
    canViewFuel: Boolean(capabilities.canViewFuel),
    canViewFuelCost: Boolean((capabilities as any).canViewFuelCost),
    canViewEvidence: Boolean((capabilities as any).canViewEvidence),
    canViewRawCoordinates: Boolean((capabilities as any).canViewRawCoordinates),
    canViewJourneys: Boolean(capabilities.canViewJourneys),
    canViewSpares: Boolean(capabilities.canViewSpares),
    isElevated: Boolean((capabilities as any).isElevated),
    isPlatformOwner: Boolean(capabilities.isPlatformOwner),
    canReviewAssets: Boolean((capabilities as any).canReviewAssets),
  };
}

function sanitizeStructuredQuery(query: NavaEyeStructuredQuery | null | undefined) {
  if (!query) return null;
  return {
    original_text: String(query.original_text || "").slice(0, 500),
    normalized_text: String(query.normalized_text || "").slice(0, 500),
    replacements: Array.isArray(query.replacements)
      ? query.replacements.slice(0, 20)
      : [],
    intent_family: query.intent_family,
    subject_type: query.subject_type,
    subject_label: query.subject_label ? String(query.subject_label).slice(0, 160) : null,
    detected_entities: {
      vehicles: (query.detected_entities?.vehicles || []).slice(0, 6),
      providers: (query.detected_entities?.providers || []).slice(0, 6),
      trip_references: (query.detected_entities?.trip_references || []).slice(0, 6),
    },
    detected_periods: (query.detected_periods || []).slice(0, 4),
    comparison: query.comparison
      ? {
          metric: query.comparison.metric,
          periods: query.comparison.periods.slice(0, 2),
        }
      : null,
    metric: query.metric,
    follow_up: Boolean(query.follow_up),
    answer_mode: query.answer_mode,
  };
}

function getPermissionBoundary(
  lower: string,
  capabilities: ReturnType<typeof getRoleCapabilities>,
  options: { allowTripPerformanceSummary?: boolean } = {}
) {
  if (asksForProviderSecrets(lower)) {
    return {
      category: "provider_secrets",
      message:
        "Provider status and safe diagnostics are available, but provider credentials, tokens, auth configs, cookies, and raw payloads are restricted.",
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

  if (
    asksForExpenses(lower) &&
    !capabilities.canViewExpenses &&
    !capabilities.canViewTripExpenses &&
    !(capabilities as any).canViewEvidence &&
    !options.allowTripPerformanceSummary
  ) {
    return {
      category: "expenses",
      message:
        "I can help with operational context, but expense ledger data is restricted for your role.",
    };
  }

  if (
    asksForFinance(lower) &&
    !capabilities.canViewFinance &&
    !options.allowTripPerformanceSummary
  ) {
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
  detectedCountryName: string | null,
  businessMetricIntent: ReturnType<typeof detectBusinessMetricIntent> = null,
  tripPerformanceRequest = false,
  structuredQuery: NavaEyeStructuredQuery | null = null
): ContextIntent {
  if (detectedCountryName) {
    return "country_trucks";
  }
  if (structuredQuery?.intent_family === "compare_metric") {
    return "metric_comparison";
  }
  if (structuredQuery?.intent_family === "management_actions") {
    return "fleet_health";
  }
  if (structuredQuery?.intent_family === "provider_capability") {
    return "provider_capability";
  }
  if (structuredQuery?.intent_family === "finance_revenue") {
    return "finance_review";
  }
  if (structuredQuery?.intent_family === "expense_evidence") {
    return "evidence_review";
  }
  if (
    structuredQuery?.intent_family === "live_status" &&
    /\b(which|what|show|list)\b.*\b(trucks|assets|vehicles)\b.*\blive\b|\blive\s+(trucks|assets|vehicles)\b/.test(
      lower
    )
  ) {
    return "fleet_health";
  }
  if (structuredQuery?.intent_family === "live_status") {
    return "truck_status";
  }
  if (structuredQuery?.intent_family === "idle_or_stopped") {
    return "truck_status";
  }
  if (tripPerformanceRequest) {
    return "trip_performance";
  }
  if (businessMetricIntent && !detectHypotheticalProfitSimulation(lower)) {
    return "business_metrics";
  }
  if (detectEvidenceReviewRequest(lower)) {
    return "evidence_review";
  }
  if (detectFinanceReviewRequest(lower)) {
    return "finance_review";
  }
  if (detectProviderCapabilityRequest(lower)) {
    return "provider_capability";
  }
  if (detectProviderIdleMarkerRequest(lower)) {
    return "fleet_health";
  }
  if (detectProfitSimulation(lower)) {
    return "profit_simulation";
  }
  if (businessMetricIntent) {
    return "business_metrics";
  }
  if (asksForFleetMovement(lower)) {
    return "fleet_movement";
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
  if (detectManagementActionRequest(lower)) {
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

function detectTripPerformanceIntent(lower: string) {
  const text = String(lower || "").toLowerCase().replace(/[’]/g, "'");
  const mentionsTrip = /\b(trip|journey)\b/.test(text);
  const asksPerformance = /\b(perform|performance|make money|made money|contribution|contribute|contributed|profitability|profit|margin|ready for profit review|profit review)\b/.test(
    text
  );
  const asksTripContribution =
    /\b(contribution|contribute|contributed|margin|ready for profit review|profit review)\b/.test(
      text
    );
  const asksProfitOrMake =
    /\b(make money|made money|profitability|profit)\b/.test(text);
  const asksTripOutcome = mentionsTrip && /\b(do|did|done|perform|performance)\b/.test(text);
  const asksMakeAmount = /\b(what|how much)\b.*\b(make|made)\b/.test(text);
  const asksPerKmMetric = /\b(per\s*km|per\s*kilomet(?:er|re)|\/\s*km)\b/.test(text);
  const hasVehicleToken = /[a-z]{2,4}[\s\-/.]*\d{2,4}[\s\-/.]*[a-z]?/i.test(text);
  const hasVehicleDescriptor = hasVehicleTripDescriptor(text);
  const asksVehicleOutcome =
    hasVehicleToken && /\bhow\s+did\b.*\b(do|perform|performing)\b/.test(text);

  if (asksPerKmMetric && !mentionsTrip) return false;
  return (mentionsTrip && (asksPerformance || asksTripOutcome || asksMakeAmount)) ||
    asksVehicleOutcome ||
    (hasVehicleToken && asksTripContribution) ||
    (hasVehicleToken && hasVehicleDescriptor && (asksProfitOrMake || asksMakeAmount));
}

function detectManagementActionRequest(lower: string) {
  return (
    /\bwhat\s+should\s+i\s+act\s+on\b/.test(lower) ||
    /\bwhat\s+needs\s+attention\b/.test(lower) ||
    /\baction\s+items?\b/.test(lower) ||
    /\bmanagement\s+actions?\b/.test(lower)
  );
}

function detectEvidenceReviewRequest(lower: string) {
  const mentionsEvidence =
    /\b(evidence|proof|receipt|receipts|attachment|attachments|document|documents|screenshot|screenshots|m[-\s]?pesa|mpesa)\b/.test(
      lower
    );
  if (!mentionsEvidence) return false;
  return /\b(expense|expenses|trip|journey|per\s+diem|allowance|supported|missing|show|attached)\b/.test(
    lower
  );
}

function detectFinanceReviewRequest(lower: string) {
  return (
    /\b(revenue\s+review|trips?\s+need(?:ing)?\s+revenue|missing\s+revenue|no\s+rate\s+rule|rate\s+rule|matched\s+rate|apply\s+rate|configured\s+rate)\b/.test(
      lower
    ) ||
    /\bwhat\s+rate\s+applies\b/.test(lower)
  );
}

function detectProviderCapabilityRequest(lower: string) {
  const mentionsProvider =
    /\b(provider|tracking|feed|sync|capability|capabilities|fleettrack|bluetrax)\b/.test(
      lower
    );
  const mentionsSignal =
    /\b(expose|exposes|provide|provides|detected|mapped|fuel|engine|ignition|odometer|mileage|distance|idle|diagnostic|fault|driver|geofence)\b/.test(
      lower
    );
  return (
    (mentionsProvider && mentionsSignal) ||
    /\bwhy\s+is\b.*\b(distance|mileage)\b.*\bgps[-\s]?estimated\b/.test(lower)
  );
}

function detectProviderIdleMarkerRequest(lower: string) {
  return /\b(provider\s+idle\s+markers?|idle\s+markers?|idle\s+alerts?|which\s+trucks\s+.*\bidl(?:e|ing))\b/.test(
    lower
  );
}

function detectAnswerDetailRequest(lower: string) {
  return /\b(how\s+did\s+you\s+calculate|how\s+was\s+.*calculated|why\s+is\s+it\s+different|why\s+different|why\s+so\s+low|why\s+low|why\s+is\s+.*\s+low|show\s+evidence|show\s+the\s+evidence|what\s+data\s+did\s+you\s+use|data\s+used|source\s+hierarchy|why\s+should\s+i\s+trust|audit|details?|explain\s+the\s+source)\b/.test(
    lower
  );
}

function hasVehicleTripDescriptor(text: string) {
  const withoutVehicle = String(text || "").replace(
    /[a-z]{2,4}[\s\-/.]*\d{2,4}[\s\-/.]*[a-z]?/gi,
    " "
  );
  const remaining = withoutVehicle.replace(
    /\b(what|was|were|is|are|the|a|an|on|for|show|me|how|much|did|do|done|make|made|money|contribution|contribute|contributed|profit|profitability|margin|ready|review|perform|performance|trip|journey|today|yesterday|this|that|current|latest)\b/g,
    " "
  );
  return /\b[a-z]{3,}\b/i.test(remaining);
}

function detectHypotheticalProfitSimulation(lower: string) {
  return (
    lower.includes("what if") ||
    lower.includes("if i get paid") ||
    lower.includes("if we get paid") ||
    lower.includes("if i charge") ||
    lower.includes("if we charge") ||
    lower.includes("would i make") ||
    lower.includes("would we make") ||
    lower.includes("simulate") ||
    /\bper\s+(tonne|ton)\b/.test(lower) ||
    /\/\s*(tonne|ton)\b/.test(lower)
  );
}

function asksForFleetMovement(lower: string) {
  const explicitFleet =
    /\b(fleet|all trucks|all vehicles|whole fleet|every truck|every vehicle|all assets|company-wide)\b/.test(
      lower
    );
  if (!explicitFleet) return false;

  return (
    /\b(movements?|moved|moving|route|timeline|history|stops?|stopped)\b/.test(lower) ||
    lower.includes("where did")
  );
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

function detectCoordinateRequest(lower: string) {
  return /\b(coordinate|coordinates|gps|latitude|longitude|lat\/long|lat long|map|map pin|exact point|exact location|map link)\b/.test(
    lower
  );
}

function detectLocationPinRequest(lower: string) {
  return /\b(map|pin|exact|exactly|coordinates?|gps|map link|map pin)\b/.test(lower);
}

function detectLocationEvidenceRequest(lower: string) {
  const normalized = String(lower || "").toLowerCase().replace(/[’]/g, "'");
  return (
    /\boperational\s+location\s+evidence\b/.test(normalized) ||
    /\blocation\s+evidence\b/.test(normalized) ||
    /\bwhere\s+exactly\s+(?:was|is)\b/.test(normalized) ||
    /\bshow\s+me\s+where\b/.test(normalized) ||
    /\bshow\s+me\s+on\s+the\s+map\b/.test(normalized) ||
    /\bwhere\s+was\b.*\b(today|yesterday|previous day|last operating day)\b/.test(normalized) ||
    /\bwhere\s+did\b.*\bspend\b/.test(normalized) ||
    /\bspend\s+(?:most\s+of\s+)?(?:today|yesterday|the day)\b/.test(normalized) ||
    /\bwhere\s+was\b.*\b(parked|stopped)\b/.test(normalized) ||
    /^map\b/.test(normalized.trim()) ||
    /\bmap\s+pin\b/.test(normalized)
  );
}

function detectStopMotionTimelineComparison(lower: string) {
  return detectTimelineHistoryRequest(lower);
}

function detectTimelineHistoryRequest(lower: string) {
  const hasDetailedEvidenceRequest =
    lower.includes("stop/motion") ||
    lower.includes("stop motion") ||
    lower.includes("detailed timeline") ||
    lower.includes("full evidence") ||
    lower.includes("all blocks") ||
    lower.includes("raw timeline") ||
    lower.includes("expand the timeline") ||
    lower.includes("expand timeline") ||
    lower.includes("show the log blocks") ||
    lower.includes("log blocks") ||
    detectRawIdleMarkerRequest(lower);
  const hasTimeframe =
    lower.includes("today") ||
    lower.includes("yesterday") ||
    lower.includes("previous day") ||
    lower.includes("previous-day") ||
    lower.includes("last operating day") ||
    lower.includes("last full route") ||
    lower.includes("all-day") ||
    lower.includes("all day");
  const hasExplicitHistoryTerm =
    /\b(movements?|moved|route|timeline|history)\b/.test(lower) ||
    /\bwhere\s+did\b/.test(lower);
  const hasStopOrMotionTerm =
    /\b(moving|motion|stops?|stopped|idle|idling)\b/.test(
      lower
    );

  return Boolean(
    hasDetailedEvidenceRequest ||
      lower.includes("compare today's stop/motion timeline") ||
      hasExplicitHistoryTerm ||
      (hasStopOrMotionTerm && hasTimeframe) ||
      lower.includes("movement for")
  );
}

export function resolveTruckTimelineTimeframe(input: string, fallback: any = null) {
  const lower = String(input || "")
    .toLowerCase()
    .replace(/[’]/g, "'");
  if (
    lower.includes("yesterday") ||
    lower.includes("previous day") ||
    lower.includes("previous-day") ||
    lower.includes("last operating day") ||
    lower.includes("last full route")
  ) {
    return {
      requested: "yesterday",
      dayOffset: -1,
    };
  }

  if (
    lower.includes("today") ||
    lower.includes("same day") ||
    lower.includes("same-day") ||
    lower.includes("current day")
  ) {
    return {
      requested: "today",
      dayOffset: 0,
    };
  }

  return fallback || {
    requested: "today",
    dayOffset: 0,
  };
}

function detectCompoundTruckRequest(lower: string) {
  const sections: any[] = [];
  const normalized = lower.replace(/[’]/g, "'");

  addCompoundSection(sections, normalized, "current_status", [
    /\bwhere\s+is\b/,
    /\bwhere's\b/,
    /\bcurrent\s+(location|status)\b/,
    /\blive\s+status\b/,
  ]);
  addCompoundSection(sections, normalized, "idle_status", [
    /\bis\s+(?:it|[a-z0-9\s-]{2,30})\s+idling\b/,
    /\bidle\s+risk\b/,
    /\bcurrently\s+idling\b/,
  ]);
  addCompoundSection(sections, normalized, "movement_timeline", [
    /\byesterday'?s\s+movements?\b/,
    /\btoday'?s\s+movements?\b/,
    /\bmovements?\s+(?:for|of)?\s*(?:today|yesterday)\b/,
    /\bwhat\s+are\s+.*\bmovements?\b/,
    /\bshow\s+(?:today|yesterday)'?s\s+movement\b/,
    /\bwhere\s+did\b/,
    /\broute\b/,
    /\bstopped\s+all\s+day\b/,
  ]);
  addCompoundSection(sections, normalized, "detailed_timeline", [
    /\bshow\s+detailed\s+timeline\b/,
    /\bdetailed\s+timeline\b/,
    /\bshow\s+all\s+blocks\b/,
    /\bfull\s+evidence\b/,
    /\bshow\s+log\s+blocks\b/,
    /\bshow\s+the\s+log\s+blocks\b/,
  ]);

  const ordered = sections
    .sort((a, b) => a.order - b.order)
    .filter(
      (section, index, list) =>
        list.findIndex((item) => item.type === section.type) === index
    );

  if (ordered.length < 2) return null;

  let lastMovementTimeframe: any = null;
  const hydratedSections = ordered.map((section) => {
    if (section.type === "movement_timeline") {
      const timeframe = detectTimelineTimeframeNear(normalized, section.order);
      lastMovementTimeframe = timeframe;
      return { ...section, timeframe };
    }
    if (section.type === "detailed_timeline") {
      const nearbyTimeframe = detectTimelineTimeframeNear(normalized, section.order);
      const timeframe =
        nearbyTimeframe.requested !== "today" || !lastMovementTimeframe
          ? nearbyTimeframe
          : lastMovementTimeframe;
      return { ...section, timeframe };
    }
    return section;
  });

  return {
    type: "truck_compound",
    answer_in_order: normalized.includes("answer these") && normalized.includes("order"),
    sections: hydratedSections,
  };
}

function addCompoundSection(
  sections: any[],
  lower: string,
  type: string,
  patterns: RegExp[]
) {
  for (const pattern of patterns) {
    const match = pattern.exec(lower);
    if (match?.index !== undefined) {
      sections.push({ type, order: match.index });
      return;
    }
  }
}

function detectTimelineTimeframeNear(lower: string, index: number) {
  const start = Math.max(0, index - 100);
  const end = Math.min(lower.length, index + 140);
  const nearby = lower.slice(start, end);
  return resolveTruckTimelineTimeframe(nearby);
}

function timelineRequestKey(timeframe: any) {
  return timeframe?.requested === "yesterday" ? "yesterday" : "today";
}

function detectDetailedTimelineRequest(lower: string) {
  return (
    lower.includes("show detailed timeline") ||
    lower.includes("detailed timeline") ||
    lower.includes("show all blocks") ||
    lower.includes("all blocks") ||
    lower.includes("full evidence") ||
    lower.includes("raw timeline") ||
    lower.includes("expand the timeline") ||
    lower.includes("expand timeline") ||
    lower.includes("show the log blocks") ||
    lower.includes("log blocks") ||
    detectRawIdleMarkerRequest(lower)
  );
}

function detectRawIdleMarkerRequest(lower: string) {
  return (
    lower.includes("show every idle marker") ||
    lower.includes("list every idle marker") ||
    lower.includes("list all idle markers") ||
    lower.includes("list all idle alerts") ||
    lower.includes("show all idle alerts") ||
    lower.includes("raw idle markers") ||
    lower.includes("raw idle alerts")
  );
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
            "This dashboard truck could not be safely matched to an enabled intelligence asset.",
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
      const locationResolution = await resolveOperationalLocation({
        company_id: companyId,
        latitude: locationPoint.latitude,
        longitude: locationPoint.longitude,
        provider_location_label: asset.provider_location_label,
        truck_id: asset.truck_id,
        geofences,
      });

      return {
        truck_id: asset.truck_id,
        registration: asset.registration || null,
        dashboard_context: requestedTruck,
        enabled_for_intelligence: true,
        last_seen_at: latestTelemetry?.recorded_at || asset.last_seen_at || null,
        latest_recorded_at: latestTelemetry?.recorded_at || null,
        latest_speed: latestTelemetry?.speed ?? null,
        timestamp_warnings: latestTelemetry?.validation?.warnings || [],
        provider_location_label: asset.provider_location_label || null,
        geofence_match: matchPointToGeofence(locationPoint, geofences),
        location_resolution: locationResolution,
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
    .select("truck_id, recorded_at, latitude, longitude, speed, validation")
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
      "truck_id, event_type, severity, location_name, created_at, started_at, duration_minutes, context_label, context_type, metadata"
    )
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .in("event_type", Array.from(IDLE_COMPATIBILITY_EVENT_TYPES))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  return (data || []).filter((event) => isProviderIdleMarkerEvent(event));
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
        "The latest telemetry is stale, so the current live state is unknown.",
    };
  }

  if (Number.isFinite(speed) && Number(speed) > 5) {
    return {
      status: "moving",
      confidence: "high",
      freshness_minutes: freshnessMinutes,
      reason: "Fresh telemetry shows movement speed above the stopped threshold.",
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
        "Fresh zero/low-speed telemetry plus a recent provider idle marker strongly supports a current stationary/idle-marker read; engine-on idle is not verified without ignition or engine data.",
    };
  }

  if (Number.isFinite(speed) && Number(speed) <= 2) {
    return {
      status: "stopped_or_idle",
      confidence: "medium",
      freshness_minutes: freshnessMinutes,
      reason:
        "Fresh low-speed telemetry suggests it is GPS-stopped, but recent provider idle-marker evidence is not strong enough for an engine-on idle conclusion.",
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

function isStopOrProviderIdleMarkerEvent(event: any) {
  if (isProviderIdleMarkerEvent(event)) return true;
  const type = String(event?.event_type || "").trim().toLowerCase();
  return ["stopped", "long_stop"].includes(type);
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
      .select("truck_id, event_type, severity, location_name, created_at, started_at, context_label, context_type, metadata")
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
  const idleEvents = events.filter((e) => isProviderIdleMarkerEvent(e));
  const idleByTruck = new Map<string, { truck_id: string; marker_count: number; latest_at: string | null }>();
  for (const event of idleEvents) {
    const truckId = String(event.truck_id || "").trim();
    if (!truckId) continue;
    const current = idleByTruck.get(truckId) || {
      truck_id: truckId,
      marker_count: 0,
      latest_at: null,
    };
    current.marker_count += 1;
    const eventAt = event.created_at || event.started_at || null;
    if (
      eventAt &&
      (!current.latest_at || new Date(eventAt).getTime() > new Date(current.latest_at).getTime())
    ) {
      current.latest_at = eventAt;
    }
    idleByTruck.set(truckId, current);
  }

  return {
    total_trucks: assets.length,
    online_trucks: assets.length - offline.length,
    offline_trucks: offline.length,
    critical_events_24h: critical.length,
    fuel_events_24h: fuelEvents.length,
    idle_events_24h: idleEvents.length,
    offline_truck_ids: offline.map((t) => t.truck_id),
    top_idle_marker_trucks: Array.from(idleByTruck.values())
      .sort((a, b) => b.marker_count - a.marker_count)
      .slice(0, 8),
  };
}

async function fetchEvidenceReviewContext(
  companyId: string,
  question: string,
  financeVisible: boolean
) {
  const journeysResult = await supabaseAdmin
    .from("journeys")
    .select("id, internal_trip_id, client_name, truck, from_location, to_location, status, created_at, start_time")
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .order("created_at", { ascending: false })
    .limit(100);

  if (journeysResult.error) {
    return {
      source: "expenses + evidence_attachments",
      status: "unavailable",
      message: "Trip records are unavailable, so expense proof cannot be checked safely.",
    };
  }

  const journeys = journeysResult.data || [];
  const matchedJourney = matchJourneyFromQuestion(journeys, question);
  let expenseQuery = supabaseAdmin
    .from("expenses")
    .select("id, journey_id, truck, expense_type, amount, vendor, payment_method, reference_number, trip_reference, notes, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(matchedJourney ? 200 : 100);

  if (matchedJourney?.id) {
    expenseQuery = expenseQuery.eq("journey_id", matchedJourney.id);
  }

  const expensesResult = await expenseQuery;
  if (expensesResult.error) {
    return {
      source: "expenses + evidence_attachments",
      status: "unavailable",
      message: "Expense records are unavailable, so proof cannot be checked safely.",
      matched_trip: sanitizeEvidenceJourney(matchedJourney),
    };
  }

  const expenses = expensesResult.data || [];
  const expenseIds = expenses.map((expense: any) => expense.id).filter(Boolean);
  const proofCounts = new Map<string, number>();
  if (expenseIds.length) {
    const evidenceResult = await supabaseAdmin
      .from("evidence_attachments")
      .select("id, related_id, evidence_type, verification_status")
      .eq("company_id", companyId)
      .eq("related_type", "expense")
      .in("related_id", expenseIds)
      .limit(1000);

    if (!evidenceResult.error) {
      for (const row of evidenceResult.data || []) {
        const key = String(row.related_id || "");
        proofCounts.set(key, (proofCounts.get(key) || 0) + 1);
      }
    }
  }

  let tripEvidenceCount = 0;
  if (matchedJourney?.id) {
    const tripEvidenceResult = await supabaseAdmin
      .from("evidence_attachments")
      .select("id")
      .eq("company_id", companyId)
      .eq("related_type", "trip")
      .eq("related_id", matchedJourney.id)
      .limit(1000);
    if (!tripEvidenceResult.error) {
      tripEvidenceCount = (tripEvidenceResult.data || []).length;
    }
  }

  const rows = expenses.map((expense: any) => ({
    id: expense.id,
    journey_id: expense.journey_id || null,
    truck: expense.truck || null,
    expense_type: expense.expense_type || "expense",
    vendor: expense.vendor || null,
    payment_method: expense.payment_method || null,
    reference_number: expense.reference_number || null,
    amount: financeVisible ? Number(expense.amount || 0) : null,
    amount_visible: financeVisible,
    created_at: expense.created_at || null,
    proof_count: proofCounts.get(String(expense.id)) || 0,
  }));
  const missingProof = rows.filter((row) => row.proof_count === 0);

  return {
    source: "expenses + evidence_attachments",
    status: "available",
    matched_trip: sanitizeEvidenceJourney(matchedJourney),
    expense_count: rows.length,
    expenses_with_proof: rows.length - missingProof.length,
    expenses_missing_proof: missingProof.length,
    trip_evidence_count: tripEvidenceCount,
    finance_values_visible: financeVisible,
    missing_proof_expenses: missingProof.slice(0, 8),
    sample_expenses: rows.slice(0, 8),
  };
}

async function fetchFinanceReviewContext(companyId: string) {
  const journeysResult = await supabaseAdmin
    .from("journeys")
    .select("id, internal_trip_id, client_name, truck, from_location, to_location, status, billing_quantity, billing_unit, revenue_kes, revenue_status, created_at")
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (journeysResult.error) {
    return {
      source: "journeys + journey_revenue_entries + client_rate_rules",
      status: "unavailable",
      message: "Trip revenue records are unavailable.",
    };
  }

  const journeys = journeysResult.data || [];
  const journeyIds = journeys.map((journey: any) => journey.id).filter(Boolean);
  const latestEntryByJourney = new Map<string, any>();
  let revenueEntryStatus = "available";

  if (journeyIds.length) {
    const entriesResult = await supabaseAdmin
      .from("journey_revenue_entries")
      .select("id, journey_id, revenue_source, revenue_kes, applied_at")
      .eq("company_id", companyId)
      .in("journey_id", journeyIds)
      .order("applied_at", { ascending: false })
      .limit(1000);

    if (entriesResult.error) {
      revenueEntryStatus = isMissingSchemaLikeError(entriesResult.error) ? "schema_missing" : "unavailable";
    } else {
      for (const entry of entriesResult.data || []) {
        if (entry.journey_id && !latestEntryByJourney.has(entry.journey_id)) {
          latestEntryByJourney.set(entry.journey_id, entry);
        }
      }
    }
  }

  const rows = journeys.map((journey: any) => {
    const entry = latestEntryByJourney.get(journey.id) || null;
    const snapshotRevenue = Number(journey.revenue_kes || 0);
    const source = entry?.revenue_source || (snapshotRevenue > 0 ? "journey_snapshot" : "missing");
    return {
      id: journey.id,
      reference: journey.internal_trip_id || "Trip",
      client_name: journey.client_name || null,
      truck: journey.truck || null,
      route_label: [journey.from_location, journey.to_location].filter(Boolean).join(" → ") || null,
      status: journey.status || null,
      billing_quantity: journey.billing_quantity ?? null,
      billing_unit: journey.billing_unit || null,
      revenue_source: source,
      needs_revenue_review: source === "missing" || source === "manual_finance_entry",
      latest_entry_applied_at: entry?.applied_at || null,
      created_at: journey.created_at || null,
    };
  });

  const missingRevenue = rows.filter((row) => row.revenue_source === "missing");
  const manualRevenue = rows.filter((row) => row.revenue_source === "manual_finance_entry");
  const configuredRevenue = rows.filter((row) => row.revenue_source === "configured_rate");

  return {
    source: "journeys + journey_revenue_entries + client_rate_rules",
    status: "available",
    revenue_entry_status: revenueEntryStatus,
    trip_count: rows.length,
    missing_revenue_count: missingRevenue.length,
    manual_revenue_count: manualRevenue.length,
    configured_revenue_count: configuredRevenue.length,
    trips_needing_review: rows.filter((row) => row.needs_revenue_review).slice(0, 8),
    sample_trips: rows.slice(0, 8),
  };
}

async function fetchProviderCapabilityContext(companyId: string, question: string) {
  const { data, error } = await supabaseAdmin
    .from("tracking_providers")
    .select("id, provider_name, provider_slug, is_active, last_test_status, last_test_message, fleet_config")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return {
      source: "Provider Vault test summaries",
      status: "unavailable",
      message: "Provider capability summaries are unavailable.",
    };
  }

  const lower = String(question || "").toLowerCase();
  const requestedSignals = {
    fuel: /\bfuel\b/.test(lower),
    engine: /\b(engine|ignition|idle)\b/.test(lower),
    distance: /\b(distance|mileage|odometer)\b/.test(lower),
  };
  const providers = (data || []).map((provider: any) => {
    const summary = buildSafeProviderTestSummary(provider);
    const discovery = summary?.capability_discovery || null;
    return {
      id: provider.id,
      provider_name: provider.provider_name || provider.provider_slug || "Provider",
      provider_slug: provider.provider_slug || null,
      is_active: Boolean(provider.is_active),
      test_status: summary?.status || provider.last_test_status || null,
      tested_at: summary?.tested_at || null,
      capability_discovery: discovery,
      capability_status: summarizeProviderCapabilities(discovery),
      mapped_fields_observed: discovery?.mapped_fields_observed || [],
      useful_unmapped_fields: discovery?.useful_unmapped_fields || [],
    };
  });

  const matchedProviders = providers.filter((provider: any) => {
    const name = String(provider.provider_name || "").toLowerCase();
    const slug = String(provider.provider_slug || "").toLowerCase();
    return (name && lower.includes(name)) || (slug && lower.includes(slug));
  });

  return {
    source: "Provider Vault capability discovery summaries",
    status: "available",
    provider_count: providers.length,
    providers: (matchedProviders.length ? matchedProviders : providers).slice(0, 8),
    matched_provider_count: matchedProviders.length,
    requested_signals: requestedSignals,
    safety_note:
      "Provider capability fields are provider-reported evidence, not audited truth. Nava does not infer fuel burn, theft, diagnostics, or true engine-on idle from detection alone.",
  };
}

async function fetchMetricComparisonContext(
  companyId: string,
  company: any,
  truckId: string | null,
  assetId: string | null,
  structuredQuery: NavaEyeStructuredQuery
) {
  const metric = structuredQuery.comparison?.metric || structuredQuery.metric;
  const periods = resolveComparisonPeriods(structuredQuery);
  const supportedPeriods = periods.filter(
    (period) => period === "today" || period === "yesterday"
  );

  if (metric !== "distance" || supportedPeriods.length < 2) {
    return {
      source: "query understanding + metric engine",
      status: "unsupported",
      metric,
      message:
        "I can compare today and yesterday distance now. Other comparison types need more linked evidence before Nava Eye can answer safely.",
    };
  }

  const [leftPeriod, rightPeriod] = supportedPeriods.slice(0, 2);
  const [leftMetric, rightMetric] = await Promise.all([
    buildBusinessMetricContext({
      companyId,
      company,
      intent: "distance_covered",
      truckId,
      assetId,
      timeframe: resolveBusinessMetricTimeframe(leftPeriod, company),
    }),
    buildBusinessMetricContext({
      companyId,
      company,
      intent: "distance_covered",
      truckId,
      assetId,
      timeframe: resolveBusinessMetricTimeframe(rightPeriod, company),
    }),
  ]);
  const left = summarizeComparisonDistance(leftPeriod, leftMetric);
  const right = summarizeComparisonDistance(rightPeriod, rightMetric);
  const leftKm = Number(left.distance_km || 0);
  const rightKm = Number(right.distance_km || 0);
  const bothAvailable = leftKm > 0 && rightKm > 0;
  const deltaKm = bothAvailable ? roundComparisonKm(rightKm - leftKm) : null;

  return {
    source: "metricEngine distance_covered",
    status: "available",
    metric: "distance",
    subject_type: truckId ? "truck" : "fleet",
    truck_id: truckId,
    label: truckId || company?.name || "This fleet",
    periods: [leftPeriod, rightPeriod],
    left,
    right,
    delta_km: deltaKm,
    direction:
      deltaKm === null
        ? "unavailable"
        : deltaKm > 0
          ? "higher"
          : deltaKm < 0
            ? "lower"
            : "same",
    provisional:
      left.distance_source === "gps_estimated_distance" ||
      right.distance_source === "gps_estimated_distance" ||
      Boolean(left.rows_truncated || right.rows_truncated),
  };
}

function resolveComparisonPeriods(query: NavaEyeStructuredQuery): NavaEyePeriod[] {
  const periods = query.comparison?.periods?.length
    ? query.comparison.periods
    : query.detected_periods;
  const supported = periods.filter(
    (period) => period === "today" || period === "yesterday" || period === "7d" || period === "30d"
  );
  if (supported.includes("yesterday") && supported.includes("today")) {
    return ["yesterday", "today"];
  }
  return supported.slice(0, 2);
}

function summarizeComparisonDistance(period: NavaEyePeriod, metric: any) {
  const distance = metric.distance || {};
  const gpsFallback = distance.gps_fallback || {};
  return {
    period,
    display_label: metric.timeframe?.display_label || period,
    local_day: metric.timeframe?.local_day || null,
    distance_km: Number.isFinite(Number(distance.distance_km))
      ? Number(distance.distance_km)
      : null,
    distance_source: normalizeComparisonDistanceSource(distance),
    provider_summary_count: safeComparisonNumber(distance.provider_summary_count),
    telemetry_point_count: safeComparisonNumber(
      distance.telemetry_point_count || gpsFallback.point_count
    ),
    segment_count: safeComparisonNumber(gpsFallback.segment_count),
    rows_truncated: Boolean(gpsFallback.rows_truncated),
    skipped_invalid_points: safeComparisonNumber(gpsFallback.skipped_invalid_points),
    skipped_unrealistic_segments: safeComparisonNumber(
      gpsFallback.skipped_unrealistic_segments
    ),
    skipped_stationary_jitter_segments: safeComparisonNumber(
      gpsFallback.skipped_stationary_jitter_segments
    ),
    missing: Array.isArray(distance.missing) ? distance.missing.slice(0, 5) : [],
  };
}

function normalizeComparisonDistanceSource(distance: any) {
  const source = String(distance.primary_distance_source || distance.distance_source || "");
  if (source === "provider_mileage") return "provider_reported_mileage";
  if (source === "gps_estimated") return "gps_estimated_distance";
  if (source === "physical_odometer") return "dashboard_odometer";
  if (source === "can_odometer") return "can_odometer";
  if (source === "mixed") return "mixed_distance_sources";
  return "unavailable";
}

function roundComparisonKm(value: number) {
  return Math.round(value * 100) / 100;
}

function safeComparisonNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function matchJourneyFromQuestion(journeys: any[], question: string) {
  const text = normalizeTripText(question);
  if (!text) return null;

  const exact = journeys.find((journey: any) => {
    const reference = normalizeTripText(journey.internal_trip_id);
    return reference && text.includes(reference);
  });
  if (exact) return exact;

  const scored = journeys
    .map((journey: any) => {
      const parts = [
        journey.internal_trip_id,
        journey.client_name,
        journey.truck,
        journey.from_location,
        journey.to_location,
      ]
        .map(normalizeTripText)
        .filter(Boolean);
      const score = parts.reduce(
        (sum: number, part: string) => sum + (text.includes(part) ? 1 : 0),
        0
      );
      return { journey, score };
    })
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.journey || null;
}

function sanitizeEvidenceJourney(journey: any) {
  if (!journey) return null;
  return {
    id: journey.id || null,
    reference: journey.internal_trip_id || "Trip",
    client_name: journey.client_name || null,
    truck: journey.truck || null,
    route_label: [journey.from_location, journey.to_location].filter(Boolean).join(" → ") || null,
    status: journey.status || null,
  };
}

function summarizeProviderCapabilities(discovery: any) {
  const details = Array.isArray(discovery?.capability_details)
    ? discovery.capability_details
    : [];
  const byKey = new Map(details.map((detail: any) => [detail.key, detail]));
  const statusFor = (key: string) => {
    const detail: any = byKey.get(key);
    if (!detail) return { status: "not_detected", evidence: "not-detected", label: key };
    return {
      status: detail.status || "not_detected",
      evidence: detail.evidence || "not-detected",
      label: detail.label || key,
      row_count: detail.row_count || 0,
    };
  };

  return {
    gps: statusFor("has_gps"),
    speed: statusFor("has_speed"),
    provider_idle_markers: statusFor("has_provider_idle_markers"),
    odometer_or_mileage: statusFor("has_odometer"),
    engine_hours: statusFor("has_engine_hours"),
    ignition_or_engine_state: statusFor("has_ignition_or_engine_state"),
    fuel_level_or_fuel_used: statusFor("has_fuel_level_or_fuel_used"),
    driver: statusFor("has_driver"),
    geofence_or_site: statusFor("has_geofence_or_site"),
    diagnostics_or_faults: statusFor("has_diagnostics_or_faults"),
  };
}

function isMissingSchemaLikeError(error: any) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("column")
  );
}

async function fetchFleetMovementSummary(
  companyId: string,
  company: any = {},
  timeframe: any = { requested: "today", dayOffset: 0 }
) {
  const operationalTimeZone = resolveOperationalTimeZone(company);
  const resolvedTimeframe = resolveTruckTimelineTimeframe(
    String(timeframe?.requested || ""),
    timeframe
  );
  const dayOffset = Number.isFinite(Number(resolvedTimeframe?.dayOffset))
    ? Number(resolvedTimeframe.dayOffset)
    : resolvedTimeframe?.requested === "yesterday"
      ? -1
      : 0;
  const dayRange = resolveOperationalDayRange(operationalTimeZone, dayOffset);

  const { data: assets, error: assetError } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, registration")
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  if (assetError) throw assetError;

  const enabledAssets = assets || [];
  const enabledTruckIds = enabledAssets.map((asset) => asset.truck_id).filter(Boolean);

  if (enabledTruckIds.length === 0) {
    return {
      type: "fleet_movement_summary",
      timeframe: {
        requested: resolvedTimeframe.requested || "today",
        dayOffset,
        local_day: dayRange.localDate,
        day_start_utc: dayRange.startUtc,
        day_end_utc: dayRange.endUtc,
      },
      timezone: {
        time_zone: operationalTimeZone,
        label: operationalTimeZoneLabel(operationalTimeZone),
      },
      enabled_asset_count: 0,
      telemetry_points: 0,
      trucks_with_telemetry: 0,
      moving_truck_count: 0,
      stationary_truck_count: 0,
      no_telemetry_truck_count: 0,
      sample_trucks: [],
    };
  }

  const { data: telemetryRows, error: telemetryError } = await supabaseAdmin
    .from("telemetry_logs")
    .select("truck_id, recorded_at, speed")
    .eq("company_id", companyId)
    .in("truck_id", enabledTruckIds)
    .gte("recorded_at", dayRange.startUtc)
    .lt("recorded_at", dayRange.endUtc)
    .order("recorded_at", { ascending: true })
    .limit(5000);

  if (telemetryError) throw telemetryError;

  const assetsByTruck = new Map(enabledAssets.map((asset) => [asset.truck_id, asset]));
  const rowsByTruck = new Map<string, any[]>();
  for (const row of telemetryRows || []) {
    if (!row.truck_id) continue;
    const list = rowsByTruck.get(row.truck_id) || [];
    list.push(row);
    rowsByTruck.set(row.truck_id, list);
  }

  const truckSummaries = Array.from(rowsByTruck.entries()).map(([truckId, rows]) => {
    const movingPoints = rows.filter((row) => Number(row.speed || 0) > 5).length;
    const latest = rows[rows.length - 1] || null;
    const asset: any = assetsByTruck.get(truckId) || {};
    const latestSpeed = finiteOrNull(latest?.speed);
    return {
      truck_id: truckId,
      registration: asset.registration || null,
      points_found: rows.length,
      first_recorded_at: rows[0]?.recorded_at || null,
      latest_recorded_at: latest?.recorded_at || null,
      latest_speed: latestSpeed,
      movement_points: movingPoints,
      showed_movement: movingPoints > 0,
      latest_state:
        latestSpeed === null
          ? "unknown"
          : latestSpeed > 5
            ? "moving"
            : "stationary",
    };
  });

  const movingTruckCount = truckSummaries.filter((truck) => truck.showed_movement).length;
  const stationaryTruckCount = truckSummaries.filter(
    (truck) => truck.latest_state === "stationary"
  ).length;

  return {
    type: "fleet_movement_summary",
    timeframe: {
      requested: resolvedTimeframe.requested || "today",
      dayOffset,
      local_day: dayRange.localDate,
      day_start_utc: dayRange.startUtc,
      day_end_utc: dayRange.endUtc,
    },
    timezone: {
      time_zone: operationalTimeZone,
      label: operationalTimeZoneLabel(operationalTimeZone),
    },
    enabled_asset_count: enabledAssets.length,
    telemetry_points: (telemetryRows || []).length,
    trucks_with_telemetry: truckSummaries.length,
    moving_truck_count: movingTruckCount,
    stationary_truck_count: stationaryTruckCount,
    no_telemetry_truck_count: Math.max(enabledAssets.length - truckSummaries.length, 0),
    sample_trucks: truckSummaries
      .sort((a, b) => {
        if (a.showed_movement !== b.showed_movement) return a.showed_movement ? -1 : 1;
        return Number(b.points_found || 0) - Number(a.points_found || 0);
      })
      .slice(0, 8),
    truncated: (telemetryRows || []).length >= 5000,
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
    .select("truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at, metadata")
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
  const capabilitySelect =
    "id, truck_id, registration, status, latitude, longitude, last_seen_at, provider_location_label, asset_category, telemetry_capability, telemetry_capabilities, telemetry_capability_source, canbus_enabled, fuel_rod_installed, fuel_rod_calibration_status";
  const baseSelect =
    "id, truck_id, registration, status, latitude, longitude, last_seen_at, provider_location_label, asset_category";
  let { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select(capabilitySelect)
    .eq("company_id", companyId)
    .eq("status", "active")
    .eq("intelligence_enabled", true)
    .limit(1000);

  if (isMissingOptionalTelemetryColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select(baseSelect)
      .eq("company_id", companyId)
      .eq("status", "active")
      .eq("intelligence_enabled", true)
      .limit(1000);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) throw error;

  const asset = (data || []).find((item) =>
    getVehicleMatchKeys(item).some((key) => key === targetKey)
  );
  if (!asset) return null;

  return {
    ...asset,
    geofence_match: matchPointToGeofence(asset, geofences),
    location_resolution: await resolveOperationalLocation({
      company_id: companyId,
      latitude: asset.latitude,
      longitude: asset.longitude,
      provider_location_label: asset.provider_location_label,
      truck_id: asset.truck_id,
      geofences,
    }),
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
    .select("truck_id, event_type, severity, location_name, latitude, longitude, created_at, started_at, context_label, context_type, metadata")
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("created_at", { ascending: false })
    .limit(20);
  return Promise.all(
    (data || []).map(async (event) => ({
      ...event,
      geofence_match: matchPointToGeofence(event, geofences),
      location_resolution: await resolveOperationalLocation({
        company_id: companyId,
        latitude: event.latitude,
        longitude: event.longitude,
        provider_location_label: event.location_name,
        truck_id: event.truck_id,
        geofences,
      }),
      assigned_driver: findAssignedDriverForEvent(event, assignmentLookup),
    }))
  );
}

async function fetchTruckTelemetry(companyId: string, truckId: string) {
  const capabilitySelect =
    "truck_id, recorded_at, latitude, longitude, speed, fuel_level, fuel_unit, provider_location_label, validation, engine_rpm, engine_on, ignition_on, fuel_rate, lifetime_fuel_used, engine_hours, fuel_raw, fuel_volume_liters, telemetry_capability, signal_quality, provider_signal_flags";
  const baseSelect =
    "truck_id, recorded_at, latitude, longitude, speed, fuel_level, fuel_unit, provider_location_label, validation";
  let { data, error } = await supabaseAdmin
    .from("telemetry_logs")
    .select(capabilitySelect)
    .eq("company_id", companyId)
    .eq("truck_id", truckId)
    .order("recorded_at", { ascending: false })
    .limit(20);

  if (isMissingOptionalTelemetryColumnError(error)) {
    const retry = await supabaseAdmin
      .from("telemetry_logs")
      .select(baseSelect)
      .eq("company_id", companyId)
      .eq("truck_id", truckId)
      .order("recorded_at", { ascending: false })
      .limit(20);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) throw error;
  return data || [];
}

function isMissingOptionalTelemetryColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

async function fetchTruckStopMotionTimelineComparison(
  companyId: string,
  truckId: string,
  geofences: any[] = [],
  company: any = {},
  timeframe: any = { requested: "today", dayOffset: 0 }
) {
  const operationalTimeZone = resolveOperationalTimeZone(company);
  return buildTruckTimelineIntelligence({
    companyId,
    truckId,
    timeZone: operationalTimeZone,
    dayOffset: Number.isFinite(Number(timeframe?.dayOffset)) ? Number(timeframe.dayOffset) : 0,
    timeframe: timeframe?.requested === "yesterday" ? "yesterday" : "today",
    geofences,
    maxRows: 2000,
    maxBlocks: 12,
  });
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
  const idleStopEvents = recentEvents.filter((event: any) => isStopOrProviderIdleMarkerEvent(event));

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

  const stopLikeEvents = recentEvents.filter((event: any) => isStopOrProviderIdleMarkerEvent(event));
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
