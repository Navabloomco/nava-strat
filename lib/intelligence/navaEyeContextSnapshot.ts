type SnapshotSubjectType =
  | "truck"
  | "trip"
  | "provider"
  | "client"
  | "route"
  | "fleet"
  | "evidence"
  | "expense"
  | "unknown";

type SnapshotIntent =
  | "truck_day_story"
  | "truck_timeline"
  | "distance"
  | "live_status"
  | "idle_stopped"
  | "trip_performance"
  | "expense_evidence"
  | "finance_review"
  | "provider_capability"
  | "action_plan"
  | "comparison"
  | "general";

type SnapshotPeriodValue = "today" | "yesterday" | "day_before_yesterday" | "7d" | "30d" | "custom";

export type NavaEyeContextSnapshot = {
  version: "2026-05-30";
  company_id: string | null;
  activeSubject: SnapshotSubject;
  lastIntent: SnapshotIntent;
  lastPeriod: SnapshotPeriod | null;
  lastAnswer: SnapshotAnswer | null;
  lastAuditTarget: SnapshotAuditTarget | null;
  lastTimelineTarget: SnapshotTimelineTarget | null;
  lastComparison: SnapshotComparison | null;
  pendingClarification: SnapshotClarification | null;
  subjectHistory: SnapshotSubject[];
  updatedAt: string;
};

type SnapshotSubject = {
  type: SnapshotSubjectType;
  id: string | null;
  label: string;
  providerLabel?: string | null;
  trailerLabel?: string | null;
  confidence: "high" | "medium" | "low";
  lastSeenAt: string;
};

type SnapshotPeriod = {
  value: SnapshotPeriodValue;
  startDate?: string | null;
  endDate?: string | null;
  label?: string | null;
};

type SnapshotAnswer = {
  source: string;
  subject: SnapshotSubject;
  period: SnapshotPeriod | null;
  summary: string | null;
  evidenceSummary: Record<string, any>;
  createdAt: string;
};

type SnapshotAuditTarget = {
  type: string;
  subject: SnapshotSubject;
  period: SnapshotPeriod | null;
  evidenceSummary: Record<string, any>;
  createdAt: string;
};

type SnapshotTimelineTarget = {
  subject: SnapshotSubject;
  period: SnapshotPeriod | null;
  source: string;
  createdAt: string;
};

type SnapshotComparison = {
  subject: SnapshotSubject;
  metric: string;
  periods: SnapshotPeriod[];
  values: Record<string, any>[];
  caveats: string[];
  createdAt: string;
};

type SnapshotClarification = {
  originalQuestion: string;
  originalIntent: string | null;
  candidates: Array<{ id: string | null; label: string }>;
  askedAt: string;
};

const MAX_LABEL_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 220;
const MAX_HISTORY = 5;

export function isNavaEyeClearContextRequest(question: unknown) {
  const text = String(question || "").trim().toLowerCase();
  return /^(start over|new conversation|clear context|forget that|reset context|clear this)$/i.test(
    text
  );
}

export function resolveNavaEyeContextSnapshot(input: {
  pendingFollowup?: any;
  recentMessages?: any[];
  companyId?: string | null;
}): NavaEyeContextSnapshot | null {
  const fromPending = sanitizeNavaEyeContextSnapshot(
    input.pendingFollowup?.context_snapshot,
    input.companyId
  );
  if (fromPending) return fromPending;

  const messages = [...(input.recentMessages || [])].reverse();
  for (const message of messages) {
    const snapshot = sanitizeNavaEyeContextSnapshot(
      message?.metadata?.context_snapshot,
      input.companyId
    );
    if (snapshot) return snapshot;
  }

  return null;
}

export function applyNavaEyeContextSnapshotToPendingFollowup(input: {
  pendingFollowup?: any;
  snapshot?: NavaEyeContextSnapshot | null;
  companyId?: string | null;
}) {
  const pending =
    input.pendingFollowup && typeof input.pendingFollowup === "object" && !Array.isArray(input.pendingFollowup)
      ? { ...input.pendingFollowup }
      : {};
  const snapshot = sanitizeNavaEyeContextSnapshot(input.snapshot, input.companyId);
  if (!snapshot) return pending;

  pending.context_snapshot = snapshot;

  if (!pending.active_topic && snapshot.activeSubject.type === "truck") {
    pending.active_topic = buildTruckActiveTopicFromSnapshot(snapshot);
  } else if (pending.active_topic && snapshot.activeSubject.type === "truck") {
    pending.active_topic = {
      ...buildTruckActiveTopicFromSnapshot(snapshot),
      ...pending.active_topic,
      last_intent: pending.active_topic.last_intent || snapshot.lastIntent,
      timeframe: pending.active_topic.timeframe || periodToTimeframe(snapshot.lastPeriod),
    };
  }

  if (!pending.active_trip && snapshot.activeSubject.type === "trip") {
    pending.active_trip = {
      entity_type: "trip",
      journey_id: snapshot.activeSubject.id || null,
      reference: snapshot.activeSubject.label || null,
      company_id: snapshot.company_id || input.companyId || null,
      last_intent: snapshot.lastIntent,
      updated_at: snapshot.updatedAt,
    };
  }

  if (!pending.provider_topic && snapshot.activeSubject.type === "provider") {
    pending.provider_topic = {
      entity_type: "provider",
      provider_id: snapshot.activeSubject.id || null,
      provider_name: snapshot.activeSubject.label,
      company_id: snapshot.company_id || input.companyId || null,
      last_intent: snapshot.lastIntent,
      updated_at: snapshot.updatedAt,
    };
  }

  if (!pending.type) {
    pending.type = pendingTypeForSnapshot(snapshot);
  }

  return pending;
}

export function attachNavaEyeContextSnapshot(input: {
  pendingFollowup?: any;
  snapshot?: NavaEyeContextSnapshot | null;
}) {
  const pending =
    input.pendingFollowup && typeof input.pendingFollowup === "object" && !Array.isArray(input.pendingFollowup)
      ? { ...input.pendingFollowup }
      : {};
  if (input.snapshot) pending.context_snapshot = input.snapshot;
  return pending;
}

export function buildNavaEyeContextSnapshot(input: {
  context: any;
  answer?: string;
  previousSnapshot?: NavaEyeContextSnapshot | null;
  pendingFollowup?: any;
}) {
  const context = input.context || {};
  const previous = sanitizeNavaEyeContextSnapshot(
    input.previousSnapshot,
    context.company?.id || null
  );
  const now = new Date().toISOString();
  const subject = resolveSnapshotSubject(context, previous, now);
  const intent = resolveSnapshotIntent(context);
  const period = resolveSnapshotPeriod(context, previous);
  const evidenceSummary = buildEvidenceSummary(context);
  const source = resolveAnswerSource(context);
  const pendingClarification = sanitizeSnapshotClarification(
    input.pendingFollowup?.pending_clarification,
    now
  );
  const history = buildSubjectHistory(previous, subject, now);
  const comparison = buildSnapshotComparison(context, subject, now);

  return sanitizeNavaEyeContextSnapshot(
    {
      version: "2026-05-30",
      company_id: context.company?.id || previous?.company_id || null,
      activeSubject: subject,
      lastIntent: intent,
      lastPeriod: period,
      lastAnswer: {
        source,
        subject,
        period,
        summary: sanitizeAnswerSummary(input.answer || ""),
        evidenceSummary,
        createdAt: now,
      },
      lastAuditTarget: buildAuditTarget(context, subject, period, evidenceSummary, now),
      lastTimelineTarget: buildTimelineTarget(context, subject, period, now),
      lastComparison: comparison,
      pendingClarification,
      subjectHistory: history,
      updatedAt: now,
    },
    context.company?.id || previous?.company_id || null
  );
}

export function sanitizeNavaEyeContextSnapshot(
  value: any,
  companyId?: string | null
): NavaEyeContextSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.company_id && companyId && value.company_id !== companyId) return null;

  const now = new Date().toISOString();
  const activeSubject = sanitizeSubject(value.activeSubject, now);
  if (!activeSubject || activeSubject.type === "unknown") return null;

  const snapshot: NavaEyeContextSnapshot = {
    version: "2026-05-30",
    company_id: cleanString(value.company_id || companyId, 80) || null,
    activeSubject,
    lastIntent: sanitizeIntent(value.lastIntent),
    lastPeriod: sanitizePeriod(value.lastPeriod),
    lastAnswer: sanitizeAnswer(value.lastAnswer, activeSubject),
    lastAuditTarget: sanitizeAuditTarget(value.lastAuditTarget, activeSubject),
    lastTimelineTarget: sanitizeTimelineTarget(value.lastTimelineTarget, activeSubject),
    lastComparison: sanitizeComparison(value.lastComparison, activeSubject),
    pendingClarification: sanitizeSnapshotClarification(value.pendingClarification, now),
    subjectHistory: Array.isArray(value.subjectHistory)
      ? value.subjectHistory
          .map((subject: any) => sanitizeSubject(subject, now))
          .filter(Boolean)
          .slice(0, MAX_HISTORY)
      : [],
    updatedAt: cleanString(value.updatedAt, 40) || now,
  };

  return snapshot;
}

function resolveSnapshotSubject(
  context: any,
  previous: NavaEyeContextSnapshot | null,
  now: string
): SnapshotSubject {
  const dayStory = context.truck_day_story;
  if (dayStory?.identity) {
    return buildSubject("truck", {
      id: dayStory.identity.truck_id || dayStory.identity.registration || context.detected_truck_id,
      label:
        dayStory.identity.provider_asset_label ||
        dayStory.identity.registration ||
        dayStory.identity.truck_id ||
        context.detected_truck_id,
      providerLabel: dayStory.identity.provider_asset_label || null,
      trailerLabel: dayStory.identity.attached_trailer_plate || null,
      confidence: "high",
      lastSeenAt: dayStory.latest_status?.recorded_at || now,
    });
  }

  const timeline = context.truck_timeline_comparison || Object.values(context.truck_timelines || {})[0];
  if (timeline?.truck_id || timeline?.registration) {
    return buildSubject("truck", {
      id: timeline.truck_id || timeline.registration || context.detected_truck_id,
      label: timeline.registration || timeline.truck_id || context.detected_truck_id,
      confidence: "high",
      lastSeenAt: timeline.day_story?.coverage_end_at || now,
    });
  }

  if (context.truck?.truck_id || context.truck?.registration || context.detected_truck_id) {
    return buildSubject("truck", {
      id: context.truck?.truck_id || context.truck?.registration || context.detected_truck_id,
      label: context.truck?.registration || context.truck?.truck_id || context.detected_truck_id,
      providerLabel: context.truck?.provider_asset_label || null,
      confidence: "high",
      lastSeenAt: context.truck?.last_seen_at || context.truck?.timestamp || now,
    });
  }

  if (context.trip_performance?.matched_trip) {
    const trip = context.trip_performance.matched_trip;
    return buildSubject("trip", {
      id: trip.trip_id || null,
      label: trip.reference || trip.route_label || "Trip",
      confidence: "high",
      lastSeenAt: now,
    });
  }

  if (context.provider_capability?.provider_name || context.provider_capability?.provider) {
    const provider = context.provider_capability;
    return buildSubject("provider", {
      id: provider.provider_id || provider.id || null,
      label: provider.provider_name || provider.provider || "Provider",
      confidence: "medium",
      lastSeenAt: now,
    });
  }

  if (context.management_action_request && context.action_plan_context?.active_topic?.truck_id) {
    const topic = context.action_plan_context.active_topic;
    return buildSubject("truck", {
      id: topic.truck_id,
      label: topic.display_label || topic.truck_id,
      confidence: "high",
      lastSeenAt: now,
    });
  }

  if (context.management_action_request && context.action_plan_context?.active_trip) {
    const trip = context.action_plan_context.active_trip;
    return buildSubject("trip", {
      id: trip.journey_id || null,
      label: trip.reference || trip.route_label || "Trip",
      confidence: "high",
      lastSeenAt: now,
    });
  }

  if (context.intent === "fleet_health" || context.intent === "fleet_movement") {
    return buildSubject("fleet", {
      id: context.company?.id || null,
      label: context.company?.name || "Fleet",
      confidence: "medium",
      lastSeenAt: now,
    });
  }

  return (
    previous?.activeSubject ||
    buildSubject("unknown", {
      id: null,
      label: "Unknown",
      confidence: "low",
      lastSeenAt: now,
    })
  );
}

function resolveSnapshotIntent(context: any): SnapshotIntent {
  if (context.truck_day_story) return "truck_day_story";
  if (context.metric_comparison) return "comparison";
  if (context.business_metric) return "distance";
  if (context.trip_performance) return "trip_performance";
  if (context.evidence_review) return "expense_evidence";
  if (context.finance_review) return "finance_review";
  if (context.provider_capability) return "provider_capability";
  if (context.action_plan || context.management_action_request) return "action_plan";
  if (context.live_status_idle_focus || context.provider_idle_marker_request) return "idle_stopped";
  if (context.intent === "truck_status" || context.truck) return "live_status";
  if (context.truck_timeline_comparison || context.truck_timelines) return "truck_timeline";
  return "general";
}

function resolveSnapshotPeriod(context: any, previous: NavaEyeContextSnapshot | null): SnapshotPeriod | null {
  const storyPeriod = context.truck_day_story?.period;
  if (storyPeriod) {
    return sanitizePeriod({
      value: storyPeriod.requested || "today",
      startDate: storyPeriod.start_utc || null,
      endDate: storyPeriod.end_utc || null,
      label: storyPeriod.label || storyPeriod.local_day || null,
    });
  }

  const timeline = context.truck_timeline_comparison || Object.values(context.truck_timelines || {})[0];
  if (timeline?.timeframe) {
    return sanitizePeriod({
      value: timeline.timeframe.requested || "today",
      startDate: timeline.query_window_utc?.start || null,
      endDate: timeline.query_window_utc?.end || null,
      label: timeline.timeframe.local_day || timeline.timeframe.requested || null,
    });
  }

  const metricTimeframe = context.business_metric?.timeframe || context.business_metric_timeframe;
  if (metricTimeframe) {
    return sanitizePeriod({
      value: metricTimeframe.requested || "today",
      startDate: metricTimeframe.day_start_utc || null,
      endDate: metricTimeframe.day_end_utc || null,
      label: metricTimeframe.display_label || metricTimeframe.local_day || null,
    });
  }

  return previous?.lastPeriod || null;
}

function buildEvidenceSummary(context: any) {
  if (context.truck_day_story) {
    const story = context.truck_day_story;
    return compactObject({
      source: "truckDayStory",
      telemetry_points: story.audit?.telemetry_points ?? null,
      motion_blocks: story.audit?.motion_blocks ?? null,
      distance_source: story.movement?.source || null,
      stopped_windows: story.stopped_time?.window_count ?? null,
      idle_markers: story.tracker_idle_markers?.marker_count ?? null,
      first_evidence_at: story.audit?.first_telemetry_at || null,
      last_evidence_at: story.audit?.last_telemetry_at || null,
    });
  }

  if (context.business_metric) {
    const distance = context.business_metric.distance || {};
    const gps = distance.gps_fallback || {};
    return compactObject({
      source: "metricEngine",
      metric: context.business_metric.type || context.business_metric_intent || null,
      distance_source: distance.primary_distance_source || distance.distance_source || null,
      telemetry_points: distance.telemetry_point_count || gps.point_count || null,
      segment_count: gps.segment_count || null,
    });
  }

  if (context.metric_comparison) {
    return compactObject({
      source: "metricEngine",
      metric: "comparison",
      periods: context.metric_comparison.periods || null,
      caveat: context.metric_comparison.caveat || null,
    });
  }

  if (context.truck_timeline_comparison) {
    const timeline = context.truck_timeline_comparison;
    return compactObject({
      source: "truckTimeline",
      telemetry_points: timeline.telemetry_summary?.points_found || null,
      motion_blocks: timeline.telemetry_summary?.blocks_found || null,
      first_evidence_at: timeline.day_story?.coverage_start_at || null,
      last_evidence_at: timeline.day_story?.coverage_end_at || null,
    });
  }

  return compactObject({ source: resolveAnswerSource(context) });
}

function buildAuditTarget(
  context: any,
  subject: SnapshotSubject,
  period: SnapshotPeriod | null,
  evidenceSummary: Record<string, any>,
  now: string
): SnapshotAuditTarget | null {
  const type = context.truck_day_story
    ? "truck_day_story"
    : context.metric_comparison
      ? "comparison"
      : context.business_metric
        ? "distance"
        : context.truck_timeline_comparison
          ? "timeline"
          : context.trip_performance
            ? "trip"
            : context.provider_capability
              ? "provider"
              : context.action_plan || context.management_action_request
                ? "action"
                : null;
  if (!type) return null;
  return { type, subject, period, evidenceSummary, createdAt: now };
}

function buildTimelineTarget(
  context: any,
  subject: SnapshotSubject,
  period: SnapshotPeriod | null,
  now: string
): SnapshotTimelineTarget | null {
  if (!context.truck_day_story && !context.truck_timeline_comparison && !context.truck_timelines) {
    return null;
  }
  return {
    subject,
    period,
    source: context.truck_day_story ? "truckDayStory" : "truckTimeline",
    createdAt: now,
  };
}

function buildSnapshotComparison(
  context: any,
  subject: SnapshotSubject,
  now: string
): SnapshotComparison | null {
  const comparison = context.metric_comparison;
  if (!comparison) return null;
  return {
    subject,
    metric: cleanString(comparison.metric || "distance", 40) || "distance",
    periods: (comparison.periods || [])
      .map((period: any) => sanitizePeriod({ value: period }))
      .filter(Boolean)
      .slice(0, 2) as SnapshotPeriod[],
    values: Array.isArray(comparison.values)
      ? comparison.values.map((value: any) => compactObject(value)).slice(0, 2)
      : [],
    caveats: Array.isArray(comparison.caveats)
      ? comparison.caveats.map((item: any) => cleanString(item, 160)).filter(Boolean).slice(0, 3)
      : [],
    createdAt: now,
  };
}

function buildSubjectHistory(
  previous: NavaEyeContextSnapshot | null,
  subject: SnapshotSubject,
  now: string
) {
  const history = previous?.subjectHistory ? [...previous.subjectHistory] : [];
  if (
    previous?.activeSubject &&
    previous.activeSubject.id !== subject.id &&
    previous.activeSubject.label !== subject.label
  ) {
    history.unshift({ ...previous.activeSubject, lastSeenAt: previous.updatedAt || now });
  }
  return dedupeSubjects(history).slice(0, MAX_HISTORY);
}

function buildTruckActiveTopicFromSnapshot(snapshot: NavaEyeContextSnapshot) {
  return {
    entity_type: "truck",
    truck_id: snapshot.activeSubject.id || snapshot.activeSubject.label,
    display_label: snapshot.activeSubject.label || snapshot.activeSubject.id || "that truck",
    company_id: snapshot.company_id,
    last_intent: snapshot.lastIntent,
    metric_intent: snapshot.lastIntent === "distance" ? "distance_covered" : null,
    timeframe: periodToTimeframe(snapshot.lastPeriod),
    local_day: snapshot.lastPeriod?.label || null,
    display_date_label: snapshot.lastPeriod?.label || null,
    detail_mode_available: Boolean(snapshot.lastTimelineTarget || snapshot.lastAuditTarget),
    updated_at: snapshot.updatedAt,
  };
}

function pendingTypeForSnapshot(snapshot: NavaEyeContextSnapshot) {
  if (snapshot.activeSubject.type === "trip") return "active_trip_topic";
  if (snapshot.lastIntent === "distance" || snapshot.lastIntent === "comparison") {
    return "business_metric_followup";
  }
  if (snapshot.lastIntent === "truck_day_story") return "truck_day_story";
  if (snapshot.activeSubject.type === "truck") return "active_truck_topic";
  if (snapshot.activeSubject.type === "provider") return "provider_topic";
  return "context_snapshot";
}

function resolveAnswerSource(context: any) {
  if (context.truck_day_story) return "truckDayStory";
  if (context.truck_timeline_comparison || context.truck_timelines) return "truckTimeline";
  if (context.business_metric || context.metric_comparison) return "metricEngine";
  if (context.truck) return "liveTracking";
  if (context.trip_performance) return "tripIntelligence";
  if (context.finance_review) return "financeReview";
  if (context.provider_capability) return "providerCapability";
  if (context.action_plan || context.management_action_request) return "actionPlanner";
  return "contextRouter";
}

function periodToTimeframe(period: SnapshotPeriod | null) {
  if (!period) return null;
  const requested = period.value;
  const dayOffset =
    requested === "yesterday" ? -1 : requested === "day_before_yesterday" ? -2 : requested === "today" ? 0 : null;
  return {
    requested,
    dayOffset,
    local_day: period.label || null,
    day_start_utc: period.startDate || null,
    day_end_utc: period.endDate || null,
    display_date_label: period.label || requested,
  };
}

function sanitizeAnswer(value: any, fallbackSubject: SnapshotSubject): SnapshotAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    source: cleanString(value.source, 80) || "contextRouter",
    subject: sanitizeSubject(value.subject, fallbackSubject.lastSeenAt) || fallbackSubject,
    period: sanitizePeriod(value.period),
    summary: sanitizeAnswerSummary(value.summary || ""),
    evidenceSummary: sanitizeEvidenceSummary(value.evidenceSummary),
    createdAt: cleanString(value.createdAt, 40) || fallbackSubject.lastSeenAt,
  };
}

function sanitizeAuditTarget(value: any, fallbackSubject: SnapshotSubject): SnapshotAuditTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    type: cleanString(value.type, 40) || "general",
    subject: sanitizeSubject(value.subject, fallbackSubject.lastSeenAt) || fallbackSubject,
    period: sanitizePeriod(value.period),
    evidenceSummary: sanitizeEvidenceSummary(value.evidenceSummary),
    createdAt: cleanString(value.createdAt, 40) || fallbackSubject.lastSeenAt,
  };
}

function sanitizeTimelineTarget(value: any, fallbackSubject: SnapshotSubject): SnapshotTimelineTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    subject: sanitizeSubject(value.subject, fallbackSubject.lastSeenAt) || fallbackSubject,
    period: sanitizePeriod(value.period),
    source: cleanString(value.source, 80) || "truckTimeline",
    createdAt: cleanString(value.createdAt, 40) || fallbackSubject.lastSeenAt,
  };
}

function sanitizeComparison(value: any, fallbackSubject: SnapshotSubject): SnapshotComparison | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    subject: sanitizeSubject(value.subject, fallbackSubject.lastSeenAt) || fallbackSubject,
    metric: cleanString(value.metric, 40) || "distance",
    periods: Array.isArray(value.periods)
      ? value.periods.map((period: any) => sanitizePeriod(period)).filter(Boolean).slice(0, 2) as SnapshotPeriod[]
      : [],
    values: Array.isArray(value.values)
      ? value.values.map((item: any) => sanitizeEvidenceSummary(item)).slice(0, 2)
      : [],
    caveats: Array.isArray(value.caveats)
      ? value.caveats.map((item: any) => cleanString(item, 160)).filter(Boolean).slice(0, 3)
      : [],
    createdAt: cleanString(value.createdAt, 40) || fallbackSubject.lastSeenAt,
  };
}

function sanitizeSubject(value: any, fallbackDate: string): SnapshotSubject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = sanitizeSubjectType(value.type);
  const label = cleanString(value.label || value.id, MAX_LABEL_LENGTH);
  if (!label) return null;
  return {
    type,
    id: cleanString(value.id, MAX_LABEL_LENGTH) || null,
    label,
    providerLabel: cleanString(value.providerLabel, MAX_LABEL_LENGTH) || null,
    trailerLabel: cleanString(value.trailerLabel, MAX_LABEL_LENGTH) || null,
    confidence: sanitizeConfidence(value.confidence),
    lastSeenAt: cleanString(value.lastSeenAt, 40) || fallbackDate,
  };
}

function sanitizePeriod(value: any): SnapshotPeriod | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const period = sanitizePeriodValue(value.value || value.requested);
  return {
    value: period,
    startDate: cleanString(value.startDate || value.day_start_utc || value.start_utc, 40) || null,
    endDate: cleanString(value.endDate || value.day_end_utc || value.end_utc, 40) || null,
    label: cleanString(value.label || value.display_date_label || value.local_day, 80) || null,
  };
}

function sanitizeSnapshotClarification(value: any, now: string): SnapshotClarification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidates = Array.isArray(value.candidates)
    ? value.candidates
    : value.candidate_label
      ? [{ id: value.candidate_truck_id || value.candidate_registration || null, label: value.candidate_label }]
      : [];
  return {
    originalQuestion: cleanString(value.originalQuestion || value.original_question, 500) || "",
    originalIntent: cleanString(value.originalIntent || value.original_intent, 80) || null,
    candidates: candidates
      .map((candidate: any) => ({
        id: cleanString(candidate.id || candidate.candidate_truck_id, MAX_LABEL_LENGTH) || null,
        label: cleanString(candidate.label || candidate.candidate_label, MAX_LABEL_LENGTH) || "",
      }))
      .filter((candidate: any) => candidate.label)
      .slice(0, 5),
    askedAt: cleanString(value.askedAt || value.asked_at, 40) || now,
  };
}

function buildSubject(type: SnapshotSubjectType, input: any): SnapshotSubject {
  return {
    type,
    id: cleanString(input.id, MAX_LABEL_LENGTH) || null,
    label: cleanString(input.label || input.id, MAX_LABEL_LENGTH) || "Unknown",
    providerLabel: cleanString(input.providerLabel, MAX_LABEL_LENGTH) || null,
    trailerLabel: cleanString(input.trailerLabel, MAX_LABEL_LENGTH) || null,
    confidence: sanitizeConfidence(input.confidence),
    lastSeenAt: cleanString(input.lastSeenAt, 40) || new Date().toISOString(),
  };
}

function sanitizeIntent(value: any): SnapshotIntent {
  const intent = cleanString(value, 40);
  const allowed = [
    "truck_day_story",
    "truck_timeline",
    "distance",
    "live_status",
    "idle_stopped",
    "trip_performance",
    "expense_evidence",
    "finance_review",
    "provider_capability",
    "action_plan",
    "comparison",
    "general",
  ];
  return allowed.includes(intent || "") ? intent as SnapshotIntent : "general";
}

function sanitizeSubjectType(value: any): SnapshotSubjectType {
  const type = cleanString(value, 40);
  const allowed = ["truck", "trip", "provider", "client", "route", "fleet", "evidence", "expense", "unknown"];
  return allowed.includes(type || "") ? type as SnapshotSubjectType : "unknown";
}

function sanitizePeriodValue(value: any): SnapshotPeriodValue {
  const period = cleanString(value, 40);
  const allowed = ["today", "yesterday", "day_before_yesterday", "7d", "30d", "custom"];
  return allowed.includes(period || "") ? period as SnapshotPeriodValue : "today";
}

function sanitizeConfidence(value: any): "high" | "medium" | "low" {
  const confidence = cleanString(value, 20);
  if (confidence === "high" || confidence === "medium" || confidence === "low") return confidence;
  return "medium";
}

function sanitizeAnswerSummary(value: string) {
  const text = cleanString(value, MAX_SUMMARY_LENGTH);
  if (!text) return null;
  return text
    .replace(/\b(?:KES|USD|EUR|GBP)\s*[\d,]+(?:\.\d+)?/gi, "[restricted amount]")
    .replace(/\b\d+(?:\.\d+)?\s*%\b/g, "[restricted percent]");
}

function sanitizeEvidenceSummary(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return compactObject(value);
}

function compactObject(value: Record<string, any>) {
  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value || {}).slice(0, 12)) {
    if (!isSafeSnapshotKey(key)) continue;
    if (entry === null || entry === undefined || entry === "") continue;
    if (typeof entry === "number") {
      output[key] = Number.isFinite(entry) ? entry : null;
    } else if (typeof entry === "boolean") {
      output[key] = entry;
    } else if (typeof entry === "string") {
      output[key] = cleanString(entry, 160);
    } else if (Array.isArray(entry)) {
      output[key] = entry.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 5);
    }
  }
  return output;
}

function dedupeSubjects(subjects: SnapshotSubject[]) {
  const seen = new Set<string>();
  const output: SnapshotSubject[] = [];
  for (const subject of subjects) {
    const key = `${subject.type}:${subject.id || subject.label}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(subject);
  }
  return output;
}

function cleanString(value: any, maxLength: number) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.slice(0, maxLength);
}

function isSafeSnapshotKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    "password",
    "token",
    "cookie",
    "authorization",
    "api_key",
    "apikey",
    "secret",
    "payload",
    "coordinate",
    "latitude",
    "longitude",
    "storage",
    "signed_url",
    "url",
    "phone",
    "license",
  ].some((part) => normalized.includes(part));
}
