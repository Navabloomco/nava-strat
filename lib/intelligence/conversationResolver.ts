import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicleKey } from "./entityResolver";
import { resolveTruckTimelineTimeframe } from "./contextRouter";
import { readStoredVehicleIdentityContext } from "../providers/vehicleIdentity";
import {
  parseNavaEyeQuery,
  type NavaEyeStructuredQuery,
} from "./queryUnderstanding";

type ConversationResolverInput = {
  question: string;
  structuredQuery?: NavaEyeStructuredQuery;
  pendingFollowup: any;
  companyId: string;
};

type VehicleResolution = {
  input: string | null;
  input_key: string | null;
  selected: any | null;
  closest: any | null;
  ambiguous: any[];
};

const FINANCE_METRIC_INTENTS = [
  "contribution_per_km",
  "profit_readiness",
  "missing_profit_data",
  "moved_without_revenue",
];

export async function resolveNavaEyeConversationFollowup(
  input: ConversationResolverInput
) {
  const pending = sanitizeResolverMetadata(input.pendingFollowup || {});
  const activeTopic = getActiveTruckTopic(pending, input.companyId);
  const activeMetricTopic = getActiveMetricTopic(pending, input.companyId);
  const activeMetricFollowupTopic =
    activeMetricTopic || buildMetricTopicFromActiveTruckTopic(activeTopic);
  const activeTripTopic = getActiveTripTopic(pending, input.companyId);
  const prompt = typeof pending.prompt === "string" ? pending.prompt.trim() : "";
  const parsedQuery =
    input.structuredQuery ||
    parseNavaEyeQuery(input.question, { pendingFollowup: input.pendingFollowup });
  const question = String(parsedQuery.normalized_text || input.question || "");
  const normalizedQuestion = normalizeQuestion(question);
  const pendingClarification = getPendingVehicleClarification(pending, input.companyId);
  if (pendingClarification) {
    if (isNegativeClarificationReply(normalizedQuestion)) {
      return {
        question,
        usedPendingFollowup: true,
        usedActiveTopic: false,
        usedMetricTopic: false,
        pendingType: "vehicle_clarification",
        needsClarification: true,
        clarificationReason: "vehicle_clarification_rejected",
        clarification: "Which truck should I check?",
        nextPendingFollowup: {},
      };
    }
    if (isAffirmativeClarificationReply(normalizedQuestion)) {
      return {
        question: buildClarifiedVehicleQuestion(pendingClarification),
        usedPendingFollowup: true,
        usedActiveTopic: true,
        usedMetricTopic: false,
        pendingType: "vehicle_clarification",
        acceptedClarification: true,
        entityResolution: {
          input: pendingClarification.original_input || null,
          matched_truck_id: pendingClarification.candidate_truck_id || null,
          matched_registration: pendingClarification.candidate_registration || null,
          matched_display_label: pendingClarification.candidate_label || null,
          match_type: "accepted_close_match",
        },
        nextPendingFollowup: {},
      };
    }
  }
  const explicitFleetScope = asksForExplicitFleetScope(question);
  const vehicleResolution = await resolvePromptVehicle(question, input.companyId);
  const explicitVehicleInput = Boolean(vehicleResolution.input);
  const selectedVehicle = vehicleResolution.selected;
  const explicitTimeframe = questionHasExplicitTimeframe(normalizedQuestion);
  const metricFollowupType = detectMetricFollowupType(question);
  const detailedTimelineRequest = isDetailedTimelineRequest(question);
  const rawIdleMarkerRequest = isRawIdleMarkerRequest(question);
  const locationEvidenceRequest = isLocationEvidenceRequest(question);
  const ellipticalTruckQuestion = isEllipticalTruckQuestion(question);

  if (vehicleResolution.ambiguous.length) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: "ambiguous_vehicle_match",
      clarification: buildAmbiguousVehicleClarification(vehicleResolution),
    };
  }

  if (explicitVehicleInput && !selectedVehicle) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: vehicleResolution.closest
        ? "vehicle_close_match"
        : "vehicle_not_found",
      clarification: buildVehicleNotFoundClarification(vehicleResolution),
      nextPendingFollowup: vehicleResolution.closest
        ? buildVehicleClarificationPendingFollowup({
            companyId: input.companyId,
            originalQuestion: question,
            resolution: vehicleResolution,
          })
        : {},
    };
  }

  if (selectedVehicle && shouldInheritIntent(question)) {
    return {
      question: buildInheritedEntityQuestion({
        question,
        vehicleLabel: selectedVehicle.display_label,
        activeTopic,
        activeMetricTopic,
        pending,
      }),
      usedPendingFollowup: false,
      usedActiveTopic: Boolean(activeTopic || activeMetricTopic),
      usedMetricTopic: Boolean(activeMetricTopic?.metric_intent),
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "conversation_resolver",
      entityResolution: {
        input: vehicleResolution.input,
        matched_truck_id: selectedVehicle.truck_id,
        matched_registration: selectedVehicle.registration,
        matched_display_label: selectedVehicle.display_label,
        match_type: selectedVehicle.match_type,
        attached_trailer_plate: selectedVehicle.attached_trailer_plate || null,
        provider_label: selectedVehicle.provider_label || null,
        trailer_context: Boolean(selectedVehicle.trailer_context),
      },
    };
  }

  if (explicitFleetScope && shouldInheritIntent(question)) {
    return {
      question: buildInheritedFleetQuestion({
        question,
        activeTopic,
        activeMetricTopic,
        pending,
      }),
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: Boolean(activeMetricTopic?.metric_intent),
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "conversation_resolver",
    };
  }

  if (
    activeMetricFollowupTopic &&
    isMetricComparisonFollowup(parsedQuery, normalizedQuestion) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: buildActiveMetricComparisonQuestion(activeMetricFollowupTopic, parsedQuery),
      usedPendingFollowup: false,
      usedActiveTopic: activeMetricFollowupTopic.entity_type === "truck",
      usedMetricTopic: true,
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "business_metric_followup",
    };
  }

  if (
    activeTopic &&
    isMetricComparisonFollowup(parsedQuery, normalizedQuestion) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: buildActiveTruckComparisonQuestion(activeTopic, parsedQuery),
      usedPendingFollowup: false,
      usedActiveTopic: true,
      usedMetricTopic: false,
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
    };
  }

  if (
    activeMetricFollowupTopic &&
    isMetricPeriodChangeFollowup(normalizedQuestion) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: buildActiveMetricPeriodQuestion(normalizedQuestion, activeMetricFollowupTopic),
      usedPendingFollowup: false,
      usedActiveTopic: activeMetricFollowupTopic.entity_type === "truck",
      usedMetricTopic: true,
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "business_metric_followup",
    };
  }

  if (metricFollowupType && activeMetricFollowupTopic && !explicitVehicleInput && !explicitFleetScope) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: activeMetricFollowupTopic.entity_type === "truck",
      usedMetricTopic: true,
      metricFollowup: true,
      metricFollowupType,
      metricTopic: activeMetricFollowupTopic,
      pendingType: typeof pending.type === "string" ? pending.type : "business_metric_followup",
    };
  }

  if (metricFollowupType && !activeMetricFollowupTopic && !explicitVehicleInput && !explicitFleetScope) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: "missing_metric_topic",
      clarification: "Which mileage figure should I check?",
    };
  }

  if (
    activeTripTopic &&
    isTripPerformanceFollowup(normalizedQuestion) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: buildActiveTripPerformanceQuestion(activeTripTopic),
      usedPendingFollowup: true,
      usedActiveTopic: false,
      usedMetricTopic: false,
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "active_trip_topic",
    };
  }

  if (
    activeTripTopic &&
    isTripEvidenceFollowup(normalizedQuestion) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: buildActiveTripEvidenceQuestion(normalizedQuestion, activeTripTopic),
      usedPendingFollowup: true,
      usedActiveTopic: false,
      usedMetricTopic: false,
      inheritedIntent: true,
      pendingType: typeof pending.type === "string" ? pending.type : "active_trip_topic",
    };
  }

  if (detailedTimelineRequest && activeTopic && !explicitVehicleInput && !explicitFleetScope) {
    const timeframe = explicitTimeframe
      ? resolveTruckTimelineTimeframe(normalizedQuestion, activeTopic.timeframe)
      : activeTopic.timeframe;

    if (!timeframe?.requested) {
      return {
        question,
        usedPendingFollowup: false,
        usedActiveTopic: true,
        usedMetricTopic: false,
        pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
        needsClarification: true,
        clarificationReason: "missing_active_truck_timeframe",
        clarification: `Should I show today's or yesterday's detailed timeline for ${activeTopic.truck_id}?`,
      };
    }

    return {
      question: `Show detailed timeline for ${activeTopic.truck_id}${formatTimeframeQuestionSuffix(
        timeframe
      )}.${rawIdleMarkerRequest ? " Show every idle marker." : ""}`,
      usedPendingFollowup: true,
      usedActiveTopic: true,
      usedMetricTopic: false,
      pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
    };
  }

  if (locationEvidenceRequest && activeTopic && !explicitVehicleInput && !explicitFleetScope) {
    const timeframe = explicitTimeframe
      ? resolveTruckTimelineTimeframe(normalizedQuestion, activeTopic.timeframe)
      : sanitizeTopicTimeframe(activeTopic.timeframe) || resolveTruckTimelineTimeframe(normalizedQuestion);

    return {
      question: buildLocationEvidenceQuestion(question, activeTopic, timeframe),
      usedPendingFollowup: false,
      usedActiveTopic: true,
      usedMetricTopic: false,
      pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
    };
  }

  if (
    locationEvidenceRequest &&
    !activeTopic &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: "missing_active_truck_location_topic",
      clarification: "Which truck should I check for location evidence?",
    };
  }

  if (
    detailedTimelineRequest &&
    prompt &&
    isTimelinePendingFollowup(pending) &&
    !explicitVehicleInput &&
    !explicitFleetScope
  ) {
    return {
      question: `${prompt} Show the detailed timeline evidence with movement and stationary blocks.`.slice(
        0,
        500
      ),
      usedPendingFollowup: true,
      usedActiveTopic: Boolean(activeTopic),
      usedMetricTopic: false,
      pendingType: typeof pending.type === "string" ? pending.type : null,
    };
  }

  if (ellipticalTruckQuestion && activeTopic && !explicitFleetScope && !explicitVehicleInput) {
    return {
      question: buildTruckScopedFollowupQuestion(question, activeTopic),
      usedPendingFollowup: false,
      usedActiveTopic: true,
      usedMetricTopic: Boolean(activeTopic.metric_intent),
      pendingType: typeof pending.type === "string" ? pending.type : "active_truck_topic",
    };
  }

  if (
    ellipticalTruckQuestion &&
    !activeTopic &&
    !explicitFleetScope &&
    !explicitVehicleInput
  ) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
      needsClarification: true,
      clarificationReason: "missing_active_truck_topic",
      clarification: "Which truck should I check?",
    };
  }

  if (!isShortFollowupCommand(question) || !prompt) {
    return {
      question,
      usedPendingFollowup: false,
      usedActiveTopic: false,
      usedMetricTopic: false,
      pendingType: null,
    };
  }

  return {
    question: prompt.slice(0, 500),
    usedPendingFollowup: true,
    usedActiveTopic: Boolean(activeTopic),
    usedMetricTopic: Boolean(activeMetricTopic),
    pendingType: typeof pending.type === "string" ? pending.type : null,
  };
}

function buildInheritedEntityQuestion(input: {
  question: string;
  vehicleLabel: string;
  activeTopic: any;
  activeMetricTopic: any;
  pending: any;
}) {
  const normalized = normalizeQuestion(input.question);
  const timeframe = resolveInheritedTimeframe(
    normalized,
    input.activeMetricTopic?.timeframe || input.activeTopic?.timeframe
  );
  const timeframeSuffix = formatTimeframeQuestionSuffix(timeframe);
  const metricTimeframeSuffix = formatMetricTimeframeQuestionSuffix(timeframe);
  const metricIntent = sanitizeMetricIntent(
    input.activeMetricTopic?.metric_intent || input.activeTopic?.metric_intent
  );
  const lastIntent = String(input.activeTopic?.last_intent || input.pending?.last_intent || "");
  const pendingType = String(input.pending?.type || "");

  if (metricIntent === "distance_covered") {
    return `How much mileage has ${input.vehicleLabel} covered${metricTimeframeSuffix}?`;
  }
  if (metricIntent === "odometer_reliability" || metricIntent === "distance_status") {
    return `Can we trust ${input.vehicleLabel} odometer?`;
  }
  if (metricIntent === "contribution_per_km") {
    return `What is contribution per km for ${input.vehicleLabel}${metricTimeframeSuffix}?`;
  }
  if (metricIntent === "profit_readiness" || metricIntent === "missing_profit_data") {
    return `Did ${input.vehicleLabel} make money${metricTimeframeSuffix}?`;
  }
  if (metricIntent === "moved_without_revenue") {
    return `Did ${input.vehicleLabel} move without revenue${metricTimeframeSuffix}?`;
  }

  if (lastIntent === "truck_timeline" || isTimelinePendingFollowup(input.pending)) {
    return `Show ${timeframe?.requested === "yesterday" ? "yesterday's" : "today's"} movement for ${input.vehicleLabel}.`;
  }

  if (lastIntent === "fuel_risk" || pendingType === "fuel_investigation_next_checks") {
    return `Is ${input.vehicleLabel} showing fuel or idle risk?`;
  }

  return `Where is ${input.vehicleLabel}?`;
}

function buildInheritedFleetQuestion(input: {
  question: string;
  activeTopic: any;
  activeMetricTopic: any;
  pending: any;
}) {
  const normalized = normalizeQuestion(input.question);
  const timeframe = resolveInheritedTimeframe(
    normalized,
    input.activeMetricTopic?.timeframe || input.activeTopic?.timeframe
  );
  const timeframeSuffix = formatTimeframeQuestionSuffix(timeframe);
  const metricTimeframeSuffix = formatMetricTimeframeQuestionSuffix(timeframe);
  const metricIntent = sanitizeMetricIntent(
    input.activeMetricTopic?.metric_intent || input.activeTopic?.metric_intent
  );
  const lastIntent = String(input.activeTopic?.last_intent || input.pending?.last_intent || "");

  if (metricIntent === "distance_covered") {
    return `How much mileage has the fleet covered${metricTimeframeSuffix}?`;
  }
  if (FINANCE_METRIC_INTENTS.includes(metricIntent || "")) {
    return `Did the fleet make money${metricTimeframeSuffix}?`;
  }
  if (lastIntent === "truck_timeline" || isTimelinePendingFollowup(input.pending)) {
    return `What are ${timeframe?.requested === "yesterday" ? "yesterday's" : "today's"} fleet movements?`;
  }

  return "Which trucks are live?";
}

function getPendingVehicleClarification(pending: any, companyId?: string | null) {
  const clarification = pending?.pending_clarification;
  if (!clarification || typeof clarification !== "object") return null;
  if (String(clarification.type || "") !== "vehicle_close_match") return null;
  const clarificationCompanyId = String(clarification.company_id || "").trim();
  if (companyId && clarificationCompanyId && clarificationCompanyId !== companyId) return null;
  const candidateLabel = String(clarification.candidate_label || "").trim();
  const originalQuestion = String(clarification.original_question || "").trim();
  if (!candidateLabel || !originalQuestion) return null;
  return {
    type: "vehicle_close_match",
    company_id: clarificationCompanyId || companyId || null,
    original_question: originalQuestion.slice(0, 500),
    original_input: String(clarification.original_input || "").trim().slice(0, 80),
    candidate_label: candidateLabel.slice(0, 80),
    candidate_truck_id: String(clarification.candidate_truck_id || "").trim().slice(0, 80),
    candidate_registration: String(clarification.candidate_registration || "").trim().slice(0, 80),
  };
}

function buildVehicleClarificationPendingFollowup(input: {
  companyId: string;
  originalQuestion: string;
  resolution: VehicleResolution;
}) {
  const closest = input.resolution.closest || {};
  return {
    type: "vehicle_clarification",
    pending_clarification: {
      type: "vehicle_close_match",
      company_id: input.companyId,
      original_question: String(input.originalQuestion || "").slice(0, 500),
      original_input: String(input.resolution.input || "").slice(0, 80),
      candidate_label: String(closest.display_label || "").slice(0, 80),
      candidate_truck_id: String(closest.truck_id || "").slice(0, 80),
      candidate_registration: String(closest.registration || "").slice(0, 80),
    },
  };
}

function buildClarifiedVehicleQuestion(clarification: any) {
  const originalQuestion = String(clarification.original_question || "").slice(0, 500);
  const originalInput = String(clarification.original_input || "").trim();
  const candidateLabel = String(clarification.candidate_label || "").trim();
  if (!originalQuestion || !candidateLabel) return `Where is ${candidateLabel}?`;
  if (!originalInput) return `${originalQuestion} ${candidateLabel}`.slice(0, 500);

  const escapedInput = originalInput.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = new RegExp(escapedInput, "i");
  if (direct.test(originalQuestion)) {
    return originalQuestion.replace(direct, candidateLabel).slice(0, 500);
  }

  const compactInput = normalizeVehicleKey(originalInput);
  const compactPattern = compactInput
    .split("")
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\-/.]*");
  const compactRegex = new RegExp(compactPattern, "i");
  if (compactRegex.test(originalQuestion)) {
    return originalQuestion.replace(compactRegex, candidateLabel).slice(0, 500);
  }

  return `${originalQuestion} ${candidateLabel}`.slice(0, 500);
}

function isAffirmativeClarificationReply(normalizedQuestion: string) {
  return /^(yes|y|yeah|yep|correct|right|that truck|that one|yes that one|yes that truck|please|please do)$/i.test(
    normalizedQuestion
  );
}

function isNegativeClarificationReply(normalizedQuestion: string) {
  return /^(no|nope|not that one|wrong|incorrect)$/i.test(normalizedQuestion);
}

function isMetricPeriodChangeFollowup(normalizedQuestion: string) {
  return /^(what about|how about|and)?\s*(today|yesterday|previous day|day before yesterday|the day before yesterday|day before|the day before|two days ago)\??$/.test(
    normalizedQuestion.replace(/[.!]+$/g, "")
  );
}

function buildActiveMetricPeriodQuestion(normalizedQuestion: string, activeMetricTopic: any) {
  const timeframe = normalizedQuestion.includes("day before") || normalizedQuestion.includes("two days ago")
    ? "day before yesterday"
    : normalizedQuestion.includes("yesterday") || normalizedQuestion.includes("previous day")
      ? "yesterday"
      : "today";
  const label =
    activeMetricTopic.entity_type === "fleet"
      ? "the fleet"
      : activeMetricTopic.display_label || activeMetricTopic.truck_id || "that truck";
  const metricIntent = sanitizeMetricIntent(activeMetricTopic.metric_intent);

  if (metricIntent === "distance_covered") {
    return `How much mileage has ${label} covered ${timeframe}?`;
  }
  if (metricIntent === "odometer_reliability" || metricIntent === "distance_status") {
    return `Can we trust ${label} odometer ${timeframe}?`;
  }
  if (metricIntent === "contribution_per_km") {
    return `What is contribution per km for ${label} ${timeframe}?`;
  }
  if (metricIntent === "profit_readiness" || metricIntent === "missing_profit_data") {
    return `Did ${label} make money ${timeframe}?`;
  }
  if (metricIntent === "moved_without_revenue") {
    return `Did ${label} move without revenue ${timeframe}?`;
  }
  return `What about ${label} ${timeframe}?`;
}

function isMetricComparisonFollowup(
  parsedQuery: NavaEyeStructuredQuery,
  normalizedQuestion: string
) {
  if (parsedQuery.intent_family === "compare_metric" && parsedQuery.metric === "distance") {
    return true;
  }
  return (
    /\b(compare|difference|between|versus|vs|more than|less than|how much more|how much less)\b/.test(
      normalizedQuestion
    ) &&
    /\btoday\b/.test(normalizedQuestion) &&
    /\byesterday\b/.test(normalizedQuestion)
  );
}

function buildActiveMetricComparisonQuestion(
  activeMetricTopic: any,
  parsedQuery: NavaEyeStructuredQuery
) {
  const label =
    activeMetricTopic.entity_type === "fleet"
      ? "the fleet"
      : activeMetricTopic.display_label || activeMetricTopic.truck_id || "that truck";
  const metricIntent = sanitizeMetricIntent(activeMetricTopic.metric_intent);
  const periods = parsedQuery.comparison?.periods || parsedQuery.detected_periods || [];
  const [first, second] = normalizeComparisonPeriodPair(periods);

  if (metricIntent === "distance_covered" || parsedQuery.metric === "distance") {
    return `Compare distance for ${label} between ${first} and ${second}.`;
  }

  return `Compare ${metricIntent || "the previous metric"} for ${label} between ${first} and ${second}.`;
}

function buildActiveTruckComparisonQuestion(
  activeTopic: any,
  parsedQuery: NavaEyeStructuredQuery
) {
  const truckId = activeTopic.display_label || activeTopic.truck_id || "that truck";
  const periods = parsedQuery.comparison?.periods || parsedQuery.detected_periods || [];
  const [first, second] = normalizeComparisonPeriodPair(periods);
  return `Compare distance for ${truckId} between ${first} and ${second}.`;
}

function normalizeComparisonPeriodPair(periods: string[]) {
  const supported = (periods || []).filter((period) =>
    ["today", "yesterday", "day_before_yesterday", "7d", "30d"].includes(period)
  );
  const first = supported[0] || "yesterday";
  const second = supported.find((period) => period !== first) || "today";
  return [formatPeriodForQuestion(first), formatPeriodForQuestion(second)];
}

function formatPeriodForQuestion(period: string) {
  if (period === "day_before_yesterday") return "day before yesterday";
  return period || "today";
}

function isTripEvidenceFollowup(normalizedQuestion: string) {
  return (
    /\b(expenses?|proof|receipt|receipts|evidence|attachments?|documents?)\b/.test(
      normalizedQuestion
    ) &&
    /\b(this trip|that trip|the trip|on this|on that|missing|supported|show)\b/.test(
      normalizedQuestion
    )
  );
}

function isTripPerformanceFollowup(normalizedQuestion: string) {
  return (
    /\b(it|that trip|this trip|the trip)\b/.test(normalizedQuestion) &&
    /\b(make money|made money|contribution|contribute|profit|margin|perform|performance|profit review)\b/.test(
      normalizedQuestion
    )
  );
}

function buildActiveTripPerformanceQuestion(activeTripTopic: any) {
  const reference = activeTripTopic.reference || activeTripTopic.journey_id || "that trip";
  return `How did trip ${reference} perform?`;
}

function buildActiveTripEvidenceQuestion(normalizedQuestion: string, activeTripTopic: any) {
  const reference = activeTripTopic.reference || activeTripTopic.journey_id || "that trip";
  if (/\bmissing\b/.test(normalizedQuestion)) {
    return `Which expenses on trip ${reference} are missing proof?`;
  }
  if (/\b(show|open|list)\b/.test(normalizedQuestion)) {
    return `Show evidence and expense proof status for trip ${reference}.`;
  }
  return `Which expenses on trip ${reference} have proof attached?`;
}

function resolveInheritedTimeframe(question: string, fallback: any) {
  if (questionHasExplicitTimeframe(question)) {
    return resolveTruckTimelineTimeframe(question, fallback);
  }
  return sanitizeTopicTimeframe(fallback) || null;
}

async function resolvePromptVehicle(
  question: string,
  companyId: string
): Promise<VehicleResolution> {
  const inputs = extractVehicleInputs(question);
  const base: VehicleResolution = {
    input: inputs[0]?.input || null,
    input_key: inputs[0]?.key || null,
    selected: null,
    closest: null,
    ambiguous: [],
  };

  if (!inputs.length) return base;

  const data = await loadFleetAssetsForConversationResolution(companyId);

  const assets = (data || []).map((asset: any) => ({
    ...buildConversationVehicleCandidate(asset),
  }));

  for (const input of inputs) {
    const exact = assets.filter((asset: any) => asset.keys.includes(input.key));
    if (exact.length === 1) {
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        selected: { ...exact[0], match_type: "exact_normalized" },
      };
    }
    if (exact.length > 1) {
      const bestExact = selectUniqueBestVehicleCandidate(exact);
      if (bestExact) {
        return {
          ...base,
          input: input.input,
          input_key: input.key,
          selected: { ...bestExact, match_type: "exact_normalized" },
        };
      }
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        ambiguous: exact.map((asset: any) => ({ ...asset, match_type: "exact_normalized" })),
      };
    }

    const trailerExact = assets.filter((asset: any) =>
      (asset.trailer_keys || []).includes(input.key)
    );
    if (trailerExact.length === 1) {
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        selected: {
          ...trailerExact[0],
          match_type: "attached_trailer_context",
          trailer_context: true,
        },
      };
    }
    if (trailerExact.length > 1) {
      const bestTrailer = selectUniqueBestVehicleCandidate(trailerExact);
      if (bestTrailer) {
        return {
          ...base,
          input: input.input,
          input_key: input.key,
          selected: {
            ...bestTrailer,
            match_type: "attached_trailer_context",
            trailer_context: true,
          },
        };
      }
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        ambiguous: trailerExact.map((asset: any) => ({
          ...asset,
          match_type: "attached_trailer_context",
          trailer_context: true,
        })),
      };
    }

    const prefix = assets.filter((asset: any) =>
      asset.keys.some((key: string) => key.startsWith(input.key) || input.key.startsWith(key))
    );
    if (prefix.length === 1) {
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        selected: { ...prefix[0], match_type: "unique_prefix" },
      };
    }
    if (prefix.length > 1) {
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        ambiguous: prefix.map((asset: any) => ({ ...asset, match_type: "prefix" })),
      };
    }

    const closest = findClosestVehicle(input.key, assets);
    if (closest) {
      return {
        ...base,
        input: input.input,
        input_key: input.key,
        closest,
      };
    }
  }

  return base;
}

async function loadFleetAssetsForConversationResolution(companyId: string) {
  let { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, intelligence_enabled, billing_status, billing_enabled_at, telemetry_capabilities")
    .eq("company_id", companyId)
    .eq("status", "active")
    .limit(1000);

  if (isMissingOptionalTelemetryColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, intelligence_enabled")
      .eq("company_id", companyId)
      .eq("status", "active")
      .limit(1000);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) throw error;
  return data || [];
}

function buildConversationVehicleCandidate(asset: any) {
  const identityContext = readStoredVehicleIdentityContext(asset);
  const providerLabelKey = normalizeVehicleKey(identityContext.provider_label);
  const rankBias = vehicleCandidateRankBias(asset, identityContext);
  return {
    id: asset.id,
    truck_id: asset.truck_id || null,
    registration: asset.registration || null,
    display_label:
      identityContext.provider_label ||
      asset.registration ||
      asset.truck_id ||
      "truck",
    attached_trailer_plate: identityContext.attached_trailer_plate,
    provider_label: identityContext.provider_label,
    enabled_for_intelligence: isAssetEnabledForNavaEye(asset),
    keys: [
      providerLabelKey,
      normalizeVehicleKey(asset.truck_id),
      normalizeVehicleKey(asset.registration),
    ].filter((key) => key.length >= 4),
    trailer_keys: [normalizeVehicleKey(identityContext.attached_trailer_plate)].filter(
      (key) => key.length >= 4
    ),
    rank_bias: rankBias,
  };
}

function selectUniqueBestVehicleCandidate(candidates: any[]) {
  const sorted = [...candidates].sort(
    (a, b) => Number(b.rank_bias || 0) - Number(a.rank_bias || 0)
  );
  if (!sorted.length) return null;
  const topBias = Number(sorted[0].rank_bias || 0);
  const secondBias = Number(sorted[1]?.rank_bias || 0);
  return topBias > secondBias ? sorted[0] : null;
}

function vehicleCandidateRankBias(asset: any, identityContext: any) {
  let bias = 0;
  if (isAssetEnabledForNavaEye(asset)) bias += 0.3;
  const canonicalKey = normalizeVehicleKey(identityContext?.canonical_truck_plate);
  const truckKey = normalizeVehicleKey(asset?.truck_id);
  const registrationKey = normalizeVehicleKey(asset?.registration);
  if (canonicalKey && (truckKey === canonicalKey || registrationKey === canonicalKey)) {
    bias += 0.2;
  }
  if (
    canonicalKey &&
    identityContext?.attached_trailer_plate &&
    truckKey &&
    truckKey !== canonicalKey &&
    truckKey.includes(canonicalKey)
  ) {
    bias -= 0.2;
  }
  return bias;
}

function isAssetEnabledForNavaEye(asset: any) {
  if (!asset?.intelligence_enabled) return false;
  const hasBillingStatus = Object.prototype.hasOwnProperty.call(asset, "billing_status");
  const hasBillingEnabledAt = Object.prototype.hasOwnProperty.call(asset, "billing_enabled_at");
  if (!hasBillingStatus && !hasBillingEnabledAt) return true;
  return (
    String(asset.billing_status || "").toLowerCase() === "enabled" &&
    Boolean(asset.billing_enabled_at)
  );
}

function findClosestVehicle(inputKey: string, assets: any[]) {
  let closest: any = null;
  for (const asset of assets) {
    for (const key of asset.keys || []) {
      const distance = editDistance(inputKey, key);
      const samePrefix = key.slice(0, 3) === inputKey.slice(0, 3);
      const closeEnough =
        distance <= 1 ||
        (distance <= 2 && samePrefix && Math.min(inputKey.length, key.length) >= 5);
      if (!closeEnough) continue;
      const rank = 100 - distance * 10 + (samePrefix ? 2 : 0);
      if (!closest || rank > closest.rank) {
        closest = {
          ...asset,
          match_type: "close_match",
          distance,
          rank,
        };
      }
    }
  }
  return closest;
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

function extractVehicleInputs(question: string) {
  const inputs = new Map<string, string>();
  const providerLabelPattern =
    /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?\s+[A-Z]{1,3}[\s\-/.]*\d{3,5}[A-Z]?/gi;
  const providerLabelMatches = question.match(providerLabelPattern) || [];

  for (const match of providerLabelMatches) {
    const key = normalizeVehicleKey(match);
    if (key.length >= 8) inputs.set(key, formatVehicleInput(match));
  }

  const platePattern = /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?/gi;
  const matches = question.match(platePattern) || [];

  for (const match of matches) {
    const key = normalizeVehicleKey(match);
    if (key.length >= 4) inputs.set(key, formatVehicleInput(match));
  }

  const tokens = question
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const key = normalizeVehicleKey(token);
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

function buildVehicleNotFoundClarification(resolution: VehicleResolution) {
  const inputLabel = formatMissingVehicleLabel(resolution.input || resolution.input_key || "that truck");
  if (resolution.closest) {
    return `${inputLabel} was not found in this workspace. Closest match: ${resolution.closest.display_label}. Did you mean ${resolution.closest.display_label}?`;
  }
  return `${inputLabel} was not found in this workspace. Which truck should I check?`;
}

function buildAmbiguousVehicleClarification(resolution: VehicleResolution) {
  const inputLabel = formatMissingVehicleLabel(resolution.input || resolution.input_key || "that truck");
  const candidates = resolution.ambiguous
    .slice(0, 5)
    .map((candidate: any) => candidate.display_label)
    .filter(Boolean);
  return `${inputLabel} matched more than one asset in this workspace. Which one do you mean: ${candidates.join(", ")}?`;
}

function formatMissingVehicleLabel(value: string) {
  const normalized = normalizeVehicleKey(value);
  const match = normalized.match(/^([A-Z]{2,4})(\d{2,4})([A-Z]?)$/);
  if (!match) return String(value || "that truck").toUpperCase();
  return `${match[1]} ${match[2]}${match[3] ? match[3] : ""}`.trim();
}

function formatVehicleInput(value: string) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function shouldInheritIntent(question: string) {
  const lower = normalizeQuestion(question);
  if (hasExplicitOperationalIntent(lower)) return false;
  return (
    /\b(how about|what about|and|that one|this one)\b/.test(lower) ||
    /^[a-z]{2,4}[\s\-/.]*\d{2,4}\s*[a-z]?$/i.test(String(question || "").trim())
  );
}

function hasExplicitOperationalIntent(lower: string) {
  return (
    /\b(where|location|current status|is\s+\w+\s+idling|idling|moving|stopped|stationary)\b/.test(
      lower
    ) ||
    /\b(mileage|distance|how far|how many\s+km|profit|make money|contribution|odometer)\b/.test(
      lower
    ) ||
    /\b(route|timeline|movements?|stops?)\b/.test(lower)
  );
}

function getActiveTruckTopic(pending: any, companyId?: string | null) {
  const topic = pending?.active_topic;
  if (!topic || typeof topic !== "object") return null;
  if (String(topic.entity_type || "") !== "truck") return null;
  const truckId = String(topic.truck_id || "").trim();
  if (!truckId || truckId.length > 80) return null;
  const topicCompanyId = String(topic.company_id || "").trim();
  if (companyId && topicCompanyId && topicCompanyId !== companyId) return null;

  return {
    entity_type: "truck",
    truck_id: truckId,
    display_label: typeof topic.display_label === "string" ? topic.display_label.slice(0, 80) : truckId,
    company_id: topicCompanyId || companyId || null,
    timeframe: sanitizeTopicTimeframe(topic.timeframe),
    local_day: typeof topic.local_day === "string" ? topic.local_day.slice(0, 20) : null,
    display_date_label:
      typeof topic.display_date_label === "string" ? topic.display_date_label.slice(0, 80) : null,
    last_intent: typeof topic.last_intent === "string" ? topic.last_intent.slice(0, 80) : null,
    metric_intent: sanitizeMetricIntent(topic.metric_intent),
    metric_result: sanitizeMetricResultSummary(topic.metric_result || topic.result_summary),
    result_summary: sanitizeMetricResultSummary(topic.result_summary || topic.metric_result),
    detail_mode_available: Boolean(topic.detail_mode_available),
  };
}

function getActiveMetricTopic(pending: any, companyId?: string | null) {
  const topic = pending?.active_topic;
  if (!topic || typeof topic !== "object") return null;
  const metricIntent = sanitizeMetricIntent(topic.metric_intent);
  if (!metricIntent) return null;

  const entityType = String(topic.entity_type || "").trim().toLowerCase();
  if (entityType !== "truck" && entityType !== "fleet") return null;
  const truckId = entityType === "truck" ? String(topic.truck_id || "").trim() : null;
  if (entityType === "truck" && (!truckId || truckId.length > 80)) return null;

  const topicCompanyId = String(topic.company_id || "").trim();
  if (companyId && topicCompanyId && topicCompanyId !== companyId) return null;

  return {
    entity_type: entityType,
    truck_id: truckId,
    display_label:
      typeof topic.display_label === "string" ? topic.display_label.slice(0, 80) : truckId,
    company_id: topicCompanyId || companyId || null,
    last_intent: typeof topic.last_intent === "string" ? topic.last_intent.slice(0, 80) : null,
    metric_intent: metricIntent,
    timeframe: sanitizeTopicTimeframe(topic.timeframe),
    local_day: typeof topic.local_day === "string" ? topic.local_day.slice(0, 20) : null,
    display_date_label:
      typeof topic.display_date_label === "string" ? topic.display_date_label.slice(0, 80) : null,
    metric_result: sanitizeMetricResultSummary(topic.metric_result || topic.result_summary),
    result_summary: sanitizeMetricResultSummary(topic.result_summary || topic.metric_result),
    comparison_result: sanitizeMetricComparisonSummary(topic.comparison_result),
    updated_at: typeof topic.updated_at === "string" ? topic.updated_at.slice(0, 40) : null,
  };
}

function buildMetricTopicFromActiveTruckTopic(activeTopic: any) {
  if (!activeTopic || activeTopic.entity_type !== "truck") return null;
  const metricIntent = sanitizeMetricIntent(activeTopic.metric_intent);
  if (!metricIntent) return null;

  return {
    entity_type: "truck",
    truck_id: activeTopic.truck_id,
    display_label: activeTopic.display_label || activeTopic.truck_id,
    company_id: activeTopic.company_id || null,
    last_intent: activeTopic.last_intent || "business_metrics",
    metric_intent: metricIntent,
    timeframe: activeTopic.timeframe || null,
    local_day: activeTopic.local_day || null,
    display_date_label: activeTopic.display_date_label || null,
    metric_result: activeTopic.metric_result || {},
    result_summary: activeTopic.result_summary || activeTopic.metric_result || {},
    comparison_result: activeTopic.comparison_result || null,
    updated_at: activeTopic.updated_at || null,
  };
}

function getActiveTripTopic(pending: any, companyId?: string | null) {
  const topic = pending?.active_trip;
  if (!topic || typeof topic !== "object") return null;
  const reference = String(topic.reference || "").trim();
  const journeyId = String(topic.journey_id || "").trim();
  if (!reference && !journeyId) return null;
  const topicCompanyId = String(topic.company_id || "").trim();
  if (companyId && topicCompanyId && topicCompanyId !== companyId) return null;

  return {
    entity_type: "trip",
    journey_id: journeyId.slice(0, 120) || null,
    reference: reference.slice(0, 160) || null,
    truck: String(topic.truck || "").trim().slice(0, 80) || null,
    client_name: String(topic.client_name || "").trim().slice(0, 120) || null,
    route_label: String(topic.route_label || "").trim().slice(0, 160) || null,
    company_id: topicCompanyId || companyId || null,
  };
}

function sanitizeMetricIntent(value: any) {
  const intent = String(value || "").trim().toLowerCase();
  const allowed = [
    "distance_covered",
    "contribution_per_km",
    "profit_readiness",
    "missing_profit_data",
    "odometer_reliability",
    "distance_status",
    "moved_without_revenue",
  ];
  return allowed.includes(intent) ? intent : null;
}

function sanitizeMetricResultSummary(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const distanceKm = Number(value.distance_km);
  const gpsFallback = value.gps_fallback && typeof value.gps_fallback === "object"
    ? value.gps_fallback
    : {};
  return {
    distance_km: Number.isFinite(distanceKm) ? distanceKm : null,
    distance_source: sanitizeDistanceSource(value.distance_source),
    date_label: typeof value.date_label === "string" ? value.date_label.slice(0, 80) : null,
    display_date_label:
      typeof value.display_date_label === "string" ? value.display_date_label.slice(0, 80) : null,
    odometer_status:
      typeof value.odometer_status === "string" ? value.odometer_status.slice(0, 80) : null,
    available: value.available === undefined ? null : Boolean(value.available),
    evidence_count: safeMetricNumber(value.evidence_count),
    provider_summary_count: safeMetricNumber(value.provider_summary_count),
    telemetry_point_count: safeMetricNumber(value.telemetry_point_count),
    segment_count: safeMetricNumber(value.segment_count ?? gpsFallback.segment_count),
    rows_truncated: Boolean(value.rows_truncated || gpsFallback.rows_truncated),
    skipped_invalid_points: safeMetricNumber(
      value.skipped_invalid_points ?? gpsFallback.skipped_invalid_points
    ),
    skipped_unrealistic_segments: safeMetricNumber(
      value.skipped_unrealistic_segments ?? gpsFallback.skipped_unrealistic_segments
    ),
    skipped_stationary_jitter_segments: safeMetricNumber(
      value.skipped_stationary_jitter_segments ?? gpsFallback.skipped_stationary_jitter_segments
    ),
  };
}

function sanitizeMetricComparisonSummary(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    metric: typeof value.metric === "string" ? value.metric.slice(0, 40) : "distance",
    periods: Array.isArray(value.periods)
      ? value.periods.map((period: any) => String(period).slice(0, 20)).slice(0, 2)
      : [],
    left: sanitizeComparisonDistanceSummary(value.left),
    right: sanitizeComparisonDistanceSummary(value.right),
    delta_km: safeMetricNumber(value.delta_km),
    direction: typeof value.direction === "string" ? value.direction.slice(0, 40) : null,
    provisional: Boolean(value.provisional),
  };
}

function sanitizeComparisonDistanceSummary(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    period: typeof value.period === "string" ? value.period.slice(0, 20) : null,
    display_label:
      typeof value.display_label === "string" ? value.display_label.slice(0, 80) : null,
    local_day: typeof value.local_day === "string" ? value.local_day.slice(0, 20) : null,
    distance_km: safeMetricNumber(value.distance_km),
    distance_source: sanitizeDistanceSource(value.distance_source),
    provider_summary_count: safeMetricNumber(value.provider_summary_count),
    telemetry_point_count: safeMetricNumber(value.telemetry_point_count),
    segment_count: safeMetricNumber(value.segment_count),
    rows_truncated: Boolean(value.rows_truncated),
    skipped_invalid_points: safeMetricNumber(value.skipped_invalid_points),
    skipped_unrealistic_segments: safeMetricNumber(value.skipped_unrealistic_segments),
    skipped_stationary_jitter_segments: safeMetricNumber(
      value.skipped_stationary_jitter_segments
    ),
  };
}

function safeMetricNumber(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeDistanceSource(value: any) {
  const source = String(value || "").trim().toLowerCase();
  const allowed = [
    "provider_reported_mileage",
    "gps_estimated_distance",
    "dashboard_odometer",
    "can_odometer",
    "mixed_distance_sources",
    "unavailable",
  ];
  return allowed.includes(source) ? source : "unavailable";
}

function sanitizeTopicTimeframe(value: any) {
  if (!value || typeof value !== "object") return null;
  const requested = String(value.requested || "").trim().toLowerCase();
  if (
    requested !== "today" &&
    requested !== "yesterday" &&
    requested !== "day_before_yesterday"
  ) {
    return null;
  }
  const rawDayOffset = value.dayOffset ?? value.day_offset;
  const dayOffset = Number.isFinite(Number(rawDayOffset))
    ? Number(rawDayOffset)
    : requested === "yesterday"
      ? -1
      : requested === "day_before_yesterday"
        ? -2
      : 0;
  return {
    requested,
    dayOffset,
    local_day: value.local_day ? String(value.local_day).slice(0, 20) : null,
    day_start_utc: value.day_start_utc ? String(value.day_start_utc).slice(0, 40) : null,
    day_end_utc: value.day_end_utc ? String(value.day_end_utc).slice(0, 40) : null,
    display_date_label: value.display_date_label
      ? String(value.display_date_label).slice(0, 80)
      : null,
  };
}

function formatTimeframeQuestionSuffix(timeframe: any) {
  const requested = String(timeframe?.requested || "").toLowerCase();
  if (requested === "yesterday") return " for yesterday";
  if (requested === "today") return " for today";
  return "";
}

function formatMetricTimeframeQuestionSuffix(timeframe: any) {
  const requested = String(timeframe?.requested || "").toLowerCase();
  if (requested === "yesterday") return " yesterday";
  if (requested === "today") return " today";
  return "";
}

function buildTruckScopedFollowupQuestion(question: string, activeTopic: any) {
  const trimmed = String(question || "").trim();
  const normalized = normalizeQuestion(trimmed);
  const truckId = activeTopic.truck_id;
  const fallbackTimeframe = activeTopic.timeframe || null;
  const timeframe = resolveTruckTimelineTimeframe(normalized, fallbackTimeframe);
  const withoutTerminalPunctuation = trimmed.replace(/[.!?]+$/g, "");
  const hasExplicitTimeframe = questionHasExplicitTimeframe(normalized);
  const timeframeSuffix =
    !hasExplicitTimeframe && timeframe?.requested === "yesterday"
      ? " for yesterday"
      : !hasExplicitTimeframe && timeframe?.requested === "today" && isDetailedTimelineRequest(normalized)
        ? " for today"
        : "";

  if (/^show\s+yesterday\b/.test(normalized) || /^what\s+about\s+yesterday\b/.test(normalized)) {
    return `Show yesterday's movement for ${truckId}.`;
  }

  if (/^show\s+today\b/.test(normalized) || /^what\s+about\s+today\b/.test(normalized)) {
    return `Show today's movement for ${truckId}.`;
  }

  if (/\bwhere\s+(?:is|are)\s+(?:it|that truck|this truck|the truck)\b/.test(normalized)) {
    return `Where is ${truckId}?`;
  }

  if (/\bwhat\s+should\s+i\s+do\s+about\s+(?:it|that|this)\b/.test(normalized)) {
    return `What should I act on for ${truckId}?`;
  }

  if (isDetailedTimelineRequest(normalized)) {
    return `Show detailed timeline for ${truckId}${timeframeSuffix}.`;
  }

  if (isLocationEvidenceRequest(normalized)) {
    return buildLocationEvidenceQuestion(question, activeTopic, timeframe);
  }

  if (isMileageDistanceQuestion(normalized)) {
    const scoped = withoutTerminalPunctuation
      .replace(/\bit\b/gi, truckId)
      .replace(/\bthis truck\b/gi, truckId)
      .replace(/\bthe truck\b/gi, truckId);
    return scoped.includes(truckId)
      ? `${scoped}?`.slice(0, 500)
      : `${scoped} for ${truckId}?`.slice(0, 500);
  }

  if (
    /\b(?:is|was)\s+it\s+idling\b/.test(normalized) ||
    /\b(?:is|was)\s+it\s+(?:stuck|stopped|stationary)(?:\s+or\s+idling)?\b/.test(normalized) ||
    /\b(?:is|was)\s+(?:that truck|this truck|the truck)\s+idling\b/.test(normalized) ||
    /\bidle\s+risk\b/.test(normalized)
  ) {
    return /\bstuck|stopped|stationary\b/.test(normalized)
      ? `Was ${truckId} stuck or idling?`
      : `Is ${truckId} idling?`;
  }

  if (/\bis\s+it\s+moving\b/.test(normalized)) {
    return `Is ${truckId} moving?`;
  }

  return `${withoutTerminalPunctuation} for ${truckId}${timeframeSuffix}?`.slice(0, 500);
}

function buildLocationEvidenceQuestion(question: string, activeTopic: any, timeframe: any) {
  const normalized = normalizeQuestion(question);
  const truckId = activeTopic.truck_id;
  const suffix = formatTimeframeQuestionSuffix(timeframe);
  const mapContext = asksForMapOrExactLocation(normalized)
    ? " Include a map pin for the main location."
    : "";
  return `Show operational location evidence for ${truckId}${suffix}.${mapContext}`.slice(0, 500);
}

function questionHasExplicitTimeframe(lower: string) {
  return (
    lower.includes("today") ||
    lower.includes("yesterday") ||
    lower.includes("day before yesterday") ||
    lower.includes("day_before_yesterday") ||
    lower.includes("two days ago") ||
    lower.includes("previous day") ||
    lower.includes("previous-day") ||
    lower.includes("last operating day") ||
    lower.includes("last full route")
  );
}

function isEllipticalTruckQuestion(question: string) {
  const lower = normalizeQuestion(question);
  if (!lower) return false;
  if (asksForExplicitFleetScope(lower)) return false;

  return (
    /\bwhat\s+are\s+(?:today'?s|yesterday'?s)\s+movements?\b/.test(lower) ||
    /\b(?:today'?s|yesterday'?s)\s+movements?\b/.test(lower) ||
    /\bshow\s+(?:today|yesterday)\b/.test(lower) ||
    /\bwhat\s+about\s+(?:today|yesterday)\b/.test(lower) ||
    /\bwhere\s+did\s+it\s+go\b/.test(lower) ||
    /\bwhere\s+(?:is|are)\s+(?:it|that truck|this truck|the truck)\b/.test(lower) ||
    /\bwhat\s+should\s+i\s+do\s+about\s+(?:it|that|this)\b/.test(lower) ||
    /\bis\s+it\s+(?:moving|idling|stopped|stationary)\b/.test(lower) ||
    /\bwas\s+it\s+(?:idling|stopped|stationary|stuck)\b/.test(lower) ||
    /\bidle\s+risk\b/.test(lower) ||
    isLocationEvidenceRequest(lower) ||
    isMileageDistanceQuestion(lower) ||
    isDetailedTimelineRequest(lower)
  );
}

function isLocationEvidenceRequest(question: string) {
  const lower = normalizeQuestion(question);
  return (
    /\bwhere\s+exactly\s+(?:was|is)\s+(?:it|that truck|this truck|the truck)?\b/.test(lower) ||
    /\bshow\s+me\s+where\s+(?:it|that truck|this truck|the truck)\s+(?:was|is)\b/.test(lower) ||
    /\bwhere\s+was\s+(?:it|that truck|this truck|the truck)\s+(?:today|yesterday)\b/.test(lower) ||
    /\bshow\s+me\s+on\s+the\s+map\b/.test(lower) ||
    /\blocation\s+evidence\b/.test(lower) ||
    /\bwhere\s+did\s+(?:it|that truck|this truck|the truck)\s+spend\b/.test(lower) ||
    /\bwhere\s+(?:did\s+)?(?:it|that truck|this truck|the truck)\s+spend\s+the\s+day\b/.test(lower) ||
    /\bwhere\s+was\s+(?:it|that truck|this truck|the truck)\s+(?:parked|stopped)\b/.test(lower) ||
    normalizeQuestion(lower) === "map" ||
    /^map\s+(?:it|that|this|there)?$/.test(lower)
  );
}

function asksForMapOrExactLocation(question: string) {
  const lower = normalizeQuestion(question);
  return /\b(map|pin|exact|exactly|coordinates?|gps)\b/.test(lower);
}

function isMileageDistanceQuestion(question: string) {
  const lower = normalizeQuestion(question);
  return (
    /\b(how much mileage|mileage covered|covered mileage|mileage today|mileage yesterday)\b/.test(
      lower
    ) ||
    /\b(distance covered|covered distance|distance today|distance yesterday)\b/.test(lower) ||
    /\bhow far\b/.test(lower) ||
    /\bhow many\s+km\b/.test(lower) ||
    /\bhow many\s+kilomet(?:er|re)s?\b/.test(lower) ||
    /\bkm\s+covered\b/.test(lower) ||
    /\bkilomet(?:er|re)s?\s+covered\b/.test(lower)
  );
}

function detectMetricFollowupType(question: string) {
  const lower = normalizeQuestion(question);
  if (!lower) return null;

  if (
    /\b(how\s+did\s+you\s+calculate|how\s+was\s+.*calculated|show\s+evidence|show\s+the\s+evidence|what\s+data\s+did\s+you\s+use|data\s+used|source\s+hierarchy|why\s+should\s+i\s+trust|why\s+is\s+it\s+different|why\s+different|why\s+so\s+low|why\s+low|why\s+is\s+.*\s+low|audit|details?|explain\s+the\s+source)\b/.test(
      lower
    )
  ) {
    return "audit_detail";
  }

  if (
    /\b(so\s+which\s+is\s+it|which\s+one\s+is\s+correct|which\s+is\s+correct|wait\s+what|that\s+doesn't\s+make\s+sense|that\s+does\s+not\s+make\s+sense|doesn't\s+make\s+sense|does\s+not\s+make\s+sense|why\s+the\s+conflict|what\s+is\s+the\s+conflict)\b/.test(
      lower
    )
  ) {
    return "conflict_explanation";
  }

  if (
    /\b(?:is|was)\s+(?:that|it)\s+(?:dashboard\s+)?odometer\s+mileage\b/.test(lower) ||
    /\b(?:is|was)\s+(?:that|it)\s+(?:odometer|dashboard odometer|odo)\b/.test(lower) ||
    /\bodometer\s+mileage\b/.test(lower)
  ) {
    return "source_check";
  }

  if (
    /\b(?:the\s+)?\d+(?:\.\d+)?\s*(?:km|kms|kilometers|kilometres)\b/.test(lower) ||
    /\b(?:that|this)\s+(?:distance|number|mileage|figure|km)\b/.test(lower) ||
    /\b(?:was|is)\s+(?:that|it)\s+today\b/.test(lower) ||
    /\b(?:was|is)\s+that\s+(?:mileage|distance)\s+today\b/.test(lower) ||
    /\b(?:was|is)\s+(?:that|it)\s+yesterday\b/.test(lower) ||
    /\bcovered\s+(?:today|yesterday)\b/.test(lower)
  ) {
    return "timeframe_confirmation";
  }

  return null;
}

function asksForExplicitFleetScope(question: string) {
  const lower = normalizeQuestion(question);
  return /\b(fleet|all trucks|all vehicles|whole fleet|every truck|every vehicle|all assets|company-wide|company wide|company total|fleet total)\b/.test(
    lower
  );
}

function isShortFollowupCommand(question: string) {
  const normalized = normalizeQuestion(question).replace(/[.!?]+$/g, "");

  return [
    "yes",
    "y",
    "yeah",
    "yep",
    "please",
    "please do",
    "do it",
    "go ahead",
    "continue",
    "compare",
    "show me",
    "check it",
    "check",
    "that one",
    "those",
  ].includes(normalized);
}

function isDetailedTimelineRequest(question: string) {
  const lower = normalizeQuestion(question);
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
    isRawIdleMarkerRequest(lower)
  );
}

function isRawIdleMarkerRequest(question: string) {
  const lower = normalizeQuestion(question);
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

function isTimelinePendingFollowup(pending: any) {
  const type = String(pending?.type || "");
  return type === "compare_stop_motion_timeline" || type === "show_detailed_timeline";
}

function normalizeQuestion(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'");
}

function sanitizeResolverMetadata(metadata: any): Record<string, any> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata;
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
