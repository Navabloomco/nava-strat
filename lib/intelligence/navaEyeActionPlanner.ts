type NavaEyeActionPlannerInput = {
  pendingFollowup?: any;
  recentMessages?: any[];
};

type ActionPlannerContext = {
  active_topic?: any;
  active_trip?: any;
  recent_issue?: {
    distance_unavailable_today?: boolean;
    gps_estimated_distance?: boolean;
    provider_idle_marker?: boolean;
    trip_missing_proof?: boolean;
  };
};

export function buildNavaEyeActionPlannerContext(
  input: NavaEyeActionPlannerInput = {}
): ActionPlannerContext {
  const pending = input.pendingFollowup || {};
  const activeTopic = sanitizeActiveTopic(pending.active_topic);
  const activeTrip = sanitizeActiveTrip(pending.active_trip);
  const recentIssue = inferRecentIssue({
    activeTopic,
    activeTrip,
    recentMessages: input.recentMessages || [],
  });

  return {
    active_topic: activeTopic || undefined,
    active_trip: activeTrip || undefined,
    recent_issue: recentIssue,
  };
}

export function buildNavaEyeActionPlan(context: any): string | null {
  if (!isActionIntent(context)) return null;

  const planner = context.action_plan_context || {};
  const originalQuestion = String(context.conversation_followup?.original_question || "");
  const effectiveQuestion = String(context.conversation_followup?.effective_question || "");
  const structured = context.query_understanding || context.conversation_followup?.structured_intent || {};
  const subjectSpecific = isSubjectSpecificActionRequest(originalQuestion, planner) ||
    isSubjectSpecificActionRequest(effectiveQuestion, planner) ||
    (
      structured.intent_family === "management_actions" &&
      structured.scope === "explicit_subject" &&
      structured.subject_type !== "unknown"
    ) ||
    Boolean(context.conversation_followup?.action_followup);

  if (subjectSpecific) {
    const tripPlan = buildTripActionPlan(context, planner.active_trip);
    if (tripPlan) return tripPlan;

    const truckPlan = buildTruckActionPlan(context, planner.active_topic);
    if (truckPlan) return truckPlan;
  }

  return buildFleetActionPlan(context);
}

function isActionIntent(context: any) {
  const intent = context.query_understanding?.intent_family ||
    context.conversation_followup?.structured_intent?.intent_family;
  return intent === "management_actions" || Boolean(context.management_action_request);
}

function isSubjectSpecificActionRequest(question: string, planner: ActionPlannerContext) {
  const lower = normalizeActionText(question);
  if (!lower) return false;

  const hasSubject = Boolean(planner.active_topic || planner.active_trip);
  if (!hasSubject) return false;

  if (/\babout\s+(it|that|this|that truck|this truck|that trip|this trip)\b/.test(lower)) {
    return true;
  }
  if (/\b(what now|so what|what does that mean|what should i check|so what should i check)\b/.test(lower)) {
    return true;
  }
  if (/\bwhat\s+should\s+i\s+do\b/.test(lower) && !/\btoday\b/.test(lower)) {
    return true;
  }

  return false;
}

function buildFleetActionPlan(context: any) {
  const health = context.fleet_health || {};
  const actions: string[] = [];
  const offline = safeNumber(health.offline_trucks);
  const critical = safeNumber(health.critical_events_24h);
  const idle = safeNumber(health.idle_events_24h);
  const fuel = safeNumber(health.fuel_events_24h);
  const canViewFinance = Boolean(context.capabilities?.canViewFinance);

  if (offline > 0) {
    actions.push(
      `Tracking freshness: ${formatCount(offline)} enabled asset(s) are stale/offline. Start with provider sync and last-seen checks.`
    );
  }
  if (critical > 0) {
    actions.push(
      `Operational events: ${formatCount(critical)} high-severity event(s) need triage. Treat them as evidence for review, not blame.`
    );
  }
  if (idle > 0) {
    actions.push(
      `Provider idle markers: ${formatCount(idle)} marker(s) appeared in the last 24 hours. Review marker windows separately from GPS-stopped time; engine-on idle and fuel burn are not verified unless ignition/engine evidence supports it.`
    );
  }
  if (fuel > 0) {
    actions.push(
      `Fuel evidence: ${formatCount(fuel)} fuel-related event(s) need evidence review. Keep provider fuel fields, fuel issues, allocations, and receipts as separate evidence layers.`
    );
  }

  actions.push(
    "Trip review: check production Trips missing revenue, distance, expense proof, or provider distance before using contribution/per-km conclusions."
  );

  if (canViewFinance) {
    actions.push(
      "Finance review: prioritize Trips with missing rate rules, manual revenue, or contribution-review blockers."
    );
  } else {
    actions.push(
      "Finance review is restricted for this role; revenue, rates, margins, and cost amounts are hidden."
    );
  }

  return [
    "Here are the top things to act on today:",
    ...actions.slice(0, 6).map((action, index) => `${index + 1}. ${action}`),
  ].join("\n");
}

function buildTruckActionPlan(context: any, activeTopic: any) {
  if (!activeTopic?.truck_id) return null;

  const label = activeTopic.display_label || activeTopic.truck_id;
  const metricIntent = String(activeTopic.metric_intent || "");
  const result = activeTopic.metric_result || activeTopic.result_summary || {};
  const recentIssue = context.action_plan_context?.recent_issue || {};

  if (metricIntent === "distance_covered" || result.distance_source) {
    return buildTruckDistanceActionPlan(label, result, recentIssue);
  }

  if (recentIssue.provider_idle_marker || /idle|stopped|stationary/i.test(String(activeTopic.last_intent || ""))) {
    return [
      `For ${label}, review the provider idle-marker or GPS-stopped evidence before taking action.`,
      "1. Check marker windows and latest tracking freshness for this truck.",
      "2. Do not treat this as fuel burn, theft, or true engine-on idle unless ignition/engine/CAN evidence supports it.",
      "3. If the truck is on an active Trip, compare the stop window with Trip route, site, and delivery evidence before escalating.",
    ].join("\n");
  }

  return [
    `For ${label}, start with the truck-specific evidence rather than the whole-fleet summary.`,
    "1. Check latest live tracking freshness and provider sync.",
    "2. Review recent movement/stopped evidence for the selected operating period.",
    "3. If this truck is tied to an active Trip, check missing Trip links: driver, distance, revenue, fuel allocation, expenses, and proof.",
  ].join("\n");
}

function buildTruckDistanceActionPlan(label: string, result: any, recentIssue: any) {
  const source = String(result.distance_source || "unavailable");
  const distanceKm = safeNumber(result.distance_km);
  const dateLabel = result.display_date_label || result.date_label || "the selected operating day";
  const todayUnavailable = Boolean(recentIssue.distance_unavailable_today);

  if (todayUnavailable) {
    const historical =
      distanceKm > 0
        ? ` Use ${formatKm(distanceKm)} for ${dateLabel} only as historical movement evidence.`
        : "";
    return [
      `For ${label}, today's distance is not reliable yet because there is not enough valid telemetry for the current operating day.`,
      `1. Check fresh tracking/provider sync for ${label}, especially last-seen freshness and telemetry ingestion.`,
      `2. Retry the distance check once more telemetry arrives.${historical}`,
      "3. Do not treat today's distance as known until provider distance or enough valid telemetry exists.",
    ].join("\n");
  }

  if (distanceKm <= 0 || source === "unavailable") {
    return [
      `For ${label}, distance is not reliable for ${dateLabel} yet.`,
      "1. Check provider trip summaries and latest telemetry ingestion for this truck.",
      "2. If the provider feed is fresh, wait for enough valid points before using GPS-estimated movement.",
      "3. Do not use this period for per-km or productivity conclusions yet.",
    ].join("\n");
  }

  if (source === "gps_estimated_distance") {
    return [
      `For ${label}, use ${formatKm(distanceKm)} for ${dateLabel} as provisional movement evidence, not final odometer/provider distance.`,
      "1. Get provider trip/report distance or a safe odometer delta before final per-km review.",
      "2. Check telemetry coverage and filtered GPS jumps if the number looks low or high.",
      "3. Keep finance or fuel-efficiency conclusions pending until stronger distance evidence exists.",
    ].join("\n");
  }

  if (source === "provider_reported_mileage") {
    return [
      `For ${label}, provider-reported mileage is available for ${dateLabel}: ${formatKm(distanceKm)}.`,
      "1. Use it as the stronger movement source for operational review.",
      "2. If it conflicts with GPS estimates, prefer the provider report but keep the conflict noted.",
      "3. Link the distance to the active Trip before using per-km contribution.",
    ].join("\n");
  }

  return [
    `For ${label}, distance evidence is available for ${dateLabel}: ${formatKm(distanceKm)}.`,
    "1. Check the distance source and coverage before using it for per-km conclusions.",
    "2. If the source is not provider-reported, treat the result as provisional.",
    "3. Link it to the relevant Trip before management review.",
  ].join("\n");
}

function buildTripActionPlan(context: any, activeTrip: any) {
  if (!activeTrip?.journey_id && !activeTrip?.reference) return null;

  const label = activeTrip.reference || activeTrip.journey_id || "this Trip";
  const route = activeTrip.client_name || activeTrip.route_label
    ? ` (${[activeTrip.client_name, activeTrip.route_label].filter(Boolean).join(" · ")})`
    : "";
  const canViewFinance = Boolean(context.capabilities?.canViewFinance);
  const actions = [
    `Trip ${label}${route}: complete the evidence attached to the records it proves.`,
    "1. Attach expense receipts/proof to the exact expense rows, not only to general Trip evidence.",
    "2. Check distance/provider movement evidence before per-km conclusions.",
    "3. Confirm fuel allocation/carry-forward evidence without treating it as actual fuel burn.",
  ];

  if (canViewFinance) {
    actions.push(
      "4. Review revenue/rate rule, linked expenses, and contribution readiness from Finance before management review."
    );
  } else {
    actions.push(
      "4. Finance details are restricted for this role; ask finance/management to review revenue, rates, contribution, and margins."
    );
  }

  return actions.join("\n");
}

function inferRecentIssue(input: {
  activeTopic: any;
  activeTrip: any;
  recentMessages: any[];
}): ActionPlannerContext["recent_issue"] {
  const label = compactIdentifier(
    input.activeTopic?.display_label || input.activeTopic?.truck_id || input.activeTrip?.truck || ""
  );
  const issue: NonNullable<ActionPlannerContext["recent_issue"]> = {};

  for (const message of (input.recentMessages || []).slice(-8)) {
    if (String(message?.sender || "") !== "assistant") continue;
    const text = String(message?.content || "");
    const lower = normalizeActionText(text);
    if (label && !compactIdentifier(text).includes(label)) continue;

    if (
      /\btoday\b/.test(lower) &&
      /\b(mileage|distance)\b/.test(lower) &&
      /\b(not available|unavailable|not enough valid telemetry|missing)\b/.test(lower)
    ) {
      issue.distance_unavailable_today = true;
    }
    if (/\bgps[- ]estimated\b/.test(lower) && /\b(provisional|not dashboard odometer|not final)\b/.test(lower)) {
      issue.gps_estimated_distance = true;
    }
    if (/\bprovider idle marker/.test(lower)) {
      issue.provider_idle_marker = true;
    }
    if (/\bmissing proof|missing evidence|attach proof|expense proof/.test(lower)) {
      issue.trip_missing_proof = true;
    }
  }

  return issue;
}

function sanitizeActiveTopic(topic: any) {
  if (!topic || typeof topic !== "object") return null;
  const entityType = String(topic.entity_type || "").slice(0, 30);
  const truckId = String(topic.truck_id || "").trim().slice(0, 80);
  if (entityType !== "truck" && !truckId) return null;
  return {
    entity_type: entityType || "truck",
    truck_id: truckId || null,
    display_label: String(topic.display_label || truckId || "Truck").slice(0, 80),
    metric_intent: String(topic.metric_intent || "").slice(0, 80),
    last_intent: String(topic.last_intent || "").slice(0, 80),
    timeframe: sanitizeTimeframe(topic.timeframe),
    metric_result: sanitizeMetricResult(topic.metric_result || topic.result_summary),
    result_summary: sanitizeMetricResult(topic.result_summary || topic.metric_result),
  };
}

function sanitizeActiveTrip(trip: any) {
  if (!trip || typeof trip !== "object") return null;
  return {
    journey_id: String(trip.journey_id || "").slice(0, 80),
    reference: String(trip.reference || "").slice(0, 120),
    truck: String(trip.truck || "").slice(0, 80),
    client_name: String(trip.client_name || "").slice(0, 120),
    route_label: String(trip.route_label || "").slice(0, 160),
    last_intent: String(trip.last_intent || "").slice(0, 80),
  };
}

function sanitizeMetricResult(result: any) {
  if (!result || typeof result !== "object") return null;
  return {
    available: Boolean(result.available),
    distance_km: safeNullableNumber(result.distance_km),
    distance_source: sanitizeDistanceSource(result.distance_source),
    date_label: String(result.date_label || "").slice(0, 30),
    display_date_label: String(result.display_date_label || "").slice(0, 80),
    provider_summary_count: safeNullableNumber(result.provider_summary_count),
    telemetry_point_count: safeNullableNumber(result.telemetry_point_count),
    segment_count: safeNullableNumber(result.segment_count),
    rows_truncated: Boolean(result.rows_truncated),
  };
}

function sanitizeTimeframe(timeframe: any) {
  if (!timeframe || typeof timeframe !== "object") return null;
  return {
    requested: String(timeframe.requested || "").slice(0, 40),
    local_day: String(timeframe.local_day || "").slice(0, 30),
    display_date_label: String(timeframe.display_date_label || "").slice(0, 80),
  };
}

function sanitizeDistanceSource(value: any) {
  const source = String(value || "").trim().toLowerCase();
  return [
    "provider_reported_mileage",
    "gps_estimated_distance",
    "dashboard_odometer",
    "can_odometer",
    "mixed_distance_sources",
    "unavailable",
  ].includes(source)
    ? source
    : "unavailable";
}

function normalizeActionText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compactIdentifier(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeNullableNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCount(value: number) {
  return Number(value || 0).toLocaleString();
}

function formatKm(value: number) {
  const number = Number(value || 0);
  return `${number.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2,
  })} km`;
}
