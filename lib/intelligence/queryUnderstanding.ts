export type NavaEyeIntentFamily =
  | "distance"
  | "compare_metric"
  | "explain_previous_answer"
  | "live_status"
  | "idle_or_stopped"
  | "trip_performance"
  | "expense_evidence"
  | "finance_revenue"
  | "provider_capability"
  | "management_actions"
  | "unknown";

export type NavaEyeSubjectType =
  | "truck"
  | "trip"
  | "client"
  | "route"
  | "provider"
  | "unknown";

export type NavaEyeMetric =
  | "distance"
  | "contribution"
  | "revenue"
  | "stopped_time"
  | "idle_markers"
  | "proof_status"
  | "unknown";

export type NavaEyePeriod =
  | "today"
  | "yesterday"
  | "day_before_yesterday"
  | "7d"
  | "30d"
  | "tomorrow";

export type NavaEyeStructuredQuery = {
  original_text: string;
  normalized_text: string;
  replacements: string[];
  intent_family: NavaEyeIntentFamily;
  subject_type: NavaEyeSubjectType;
  subject_label: string | null;
  subject_id: string | null;
  scope: "explicit_subject" | "active_subject" | "fleet" | "unknown";
  detected_entities: {
    vehicles: string[];
    providers: string[];
    trip_references: string[];
  };
  detected_periods: NavaEyePeriod[];
  comparison: {
    metric: NavaEyeMetric;
    periods: NavaEyePeriod[];
  } | null;
  metric: NavaEyeMetric;
  follow_up: boolean;
  answer_mode: "concise" | "audit";
};

type QueryUnderstandingOptions = {
  pendingFollowup?: any;
};

const SHORTHAND_REPLACEMENTS: Array<[RegExp, string, string]> = [
  [/\bbtwn\b/gi, "between", "btwn->between"],
  [/\bb\/w\b/gi, "between", "b/w->between"],
  [/\bdiff\b/gi, "difference", "diff->difference"],
  [/\byday\b/gi, "yesterday", "yday->yesterday"],
  [/\bytdy\b/gi, "yesterday", "ytdy->yesterday"],
  [/\btdy\b/gi, "today", "tdy->today"],
  [/\btmw\b/gi, "tomorrow", "tmw->tomorrow"],
  [/\btmrw\b/gi, "tomorrow", "tmrw->tomorrow"],
  [/\bb4\b/gi, "before", "b4->before"],
  [/\bu\b/gi, "you", "u->you"],
  [/\bur\b/gi, "your", "ur->your"],
  [/\bkms\b/gi, "kilometers", "kms->kilometers"],
  [/\bkm\b/gi, "kilometers", "km->kilometers"],
];

export function normalizeNavaEyeQuery(input: string) {
  const original = String(input || "").trim();
  let normalized = original.replace(/[’]/g, "'");
  const replacements: string[] = [];

  for (const [pattern, replacement, label] of SHORTHAND_REPLACEMENTS) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) {
      replacements.push(label);
      pattern.lastIndex = 0;
      normalized = normalized.replace(pattern, replacement);
    }
  }

  normalized = normalized
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,])/g, "$1")
    .trim();

  return {
    original_text: original,
    normalized_text: normalized || original,
    replacements: Array.from(new Set(replacements)),
  };
}

export function parseNavaEyeQuery(
  input: string,
  options: QueryUnderstandingOptions = {}
): NavaEyeStructuredQuery {
  const normalized = normalizeNavaEyeQuery(input);
  const lower = normalized.normalized_text.toLowerCase();
  const detectedEntities = detectEntities(normalized.normalized_text);
  const detectedPeriods = detectPeriods(lower);
  const metric = detectMetric(lower);
  const answerMode = detectAuditMode(lower) ? "audit" : "concise";
  const comparison = detectComparison(lower, detectedPeriods, metric);
  const followUp = detectFollowUp(lower, options.pendingFollowup);
  const intentFamily = detectIntentFamily(lower, {
    metric,
    comparison,
    answerMode,
  });
  const subjectType = detectSubjectType(lower, detectedEntities, options.pendingFollowup);
  const subjectLabel = detectSubjectLabel(detectedEntities, options.pendingFollowup);
  const scope = detectScope(lower, detectedEntities, followUp, subjectLabel, intentFamily);

  return {
    original_text: normalized.original_text,
    normalized_text: normalized.normalized_text,
    replacements: normalized.replacements,
    intent_family: intentFamily,
    subject_type: subjectType,
    subject_label: subjectLabel,
    subject_id: null,
    scope,
    detected_entities: detectedEntities,
    detected_periods: detectedPeriods,
    comparison,
    metric,
    follow_up: followUp,
    answer_mode: answerMode,
  };
}

export const buildStructuredIntent = parseNavaEyeQuery;

function detectEntities(text: string) {
  const vehicles = new Set<string>();
  const providers = new Set<string>();
  const tripReferences = new Set<string>();

  const providerLabelPattern =
    /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?\s+[A-Z]{1,3}[\s\-/.]*\d{3,5}[A-Z]?/gi;
  for (const match of text.match(providerLabelPattern) || []) {
    vehicles.add(cleanEntityLabel(match));
  }

  const platePattern = /[A-Z]{2,4}[\s\-/.]*\d{2,4}[A-Z]?/gi;
  for (const match of text.match(platePattern) || []) {
    vehicles.add(cleanEntityLabel(match));
  }

  const uuidPattern =
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  for (const match of text.match(uuidPattern) || []) {
    tripReferences.add(match);
  }

  const internalTripPattern = /\b[A-Z0-9]{2,}(?:-[A-Z0-9]{2,}){2,}\b/g;
  for (const match of text.match(internalTripPattern) || []) {
    if (/\d/.test(match)) tripReferences.add(match);
  }

  const lower = text.toLowerCase();
  if (/\bfleettrack\b/.test(lower)) providers.add("FleetTrack");
  if (/\bblue\s*trax\b|\bbluetrax\b/.test(lower)) providers.add("BlueTrax");
  if (/\boak\b/.test(lower)) providers.add("Oak");

  return {
    vehicles: Array.from(vehicles).slice(0, 6),
    providers: Array.from(providers).slice(0, 6),
    trip_references: Array.from(tripReferences).slice(0, 6),
  };
}

function detectPeriods(lower: string): NavaEyePeriod[] {
  const mentions: Array<{ period: NavaEyePeriod; index: number; end: number }> = [];
  const dayBeforeSpans = collectPeriodMatches(
    lower,
    /\b(?:the\s+)?day\s+before\s+yesterday\b|\bday\s+before\s+yday\b|\bday\s+before\s+previous\s+day\b|\btwo\s+days\s+ago\b|\b(?:the\s+)?day\s+before\b|\bprevious\s+previous\s+day\b/g,
    "day_before_yesterday"
  );
  mentions.push(...dayBeforeSpans);
  mentions.push(...collectPeriodMatches(lower, /\btoday\b|\bcurrent day\b|\bsame day\b/g, "today"));
  mentions.push(
    ...collectPeriodMatches(
      lower,
      /\byesterday\b|\bprevious day\b|\blast operating day\b/g,
      "yesterday"
    ).filter((match) => !isInsideAnySpan(match.index, dayBeforeSpans))
  );
  mentions.push(
    ...collectPeriodMatches(
      lower,
      /\b7\s*(?:days?|d)\b|\bseven days\b|\blast week\b|\bthis week\b/g,
      "7d"
    )
  );
  mentions.push(
    ...collectPeriodMatches(
      lower,
      /\b30\s*(?:days?|d)\b|\bthirty days\b|\blast month\b/g,
      "30d"
    )
  );
  mentions.push(...collectPeriodMatches(lower, /\btomorrow\b|\bnext day\b/g, "tomorrow"));

  const ordered = mentions.sort((a, b) => a.index - b.index);
  const periods: NavaEyePeriod[] = [];
  for (const mention of ordered) {
    if (!periods.includes(mention.period)) periods.push(mention.period);
  }
  return periods;
}

function detectMetric(lower: string): NavaEyeMetric {
  if (
    /\b(distance|kilometers|mileage|how far|gone|covered|cover|travelled|traveled|moved)\b/.test(
      lower
    )
  ) {
    return "distance";
  }
  if (/\b(contribution|contribute|margin|made money|make money|profit)\b/.test(lower)) {
    return "contribution";
  }
  if (/\b(revenue|rate|rates|billing)\b/.test(lower)) return "revenue";
  if (/\b(idle markers?|idling|idle alert|provider idle)\b/.test(lower)) {
    return "idle_markers";
  }
  if (
    /\b(stopped|stuck|stationary|not moving|parked|waiting|grounded|under repair|repair|breakdown|out of service)\b/.test(
      lower
    )
  ) {
    return "stopped_time";
  }
  if (/\b(proof|receipt|evidence|attachments?|documents?|screenshot)\b/.test(lower)) {
    return "proof_status";
  }
  return "unknown";
}

function detectAuditMode(lower: string) {
  return /\b(how did you calculate|how was .*calculated|why is it different|why different|why so low|why low|why is .* low|show evidence|show the evidence|what data did you use|data used|source hierarchy|why should i trust|audit|details?|explain the source|so which is it|which one is correct|which is correct|that does(?:n't| not) make sense|does(?:n't| not) make sense|wait what|explain that|explain)\b/.test(
    lower
  );
}

function detectComparison(
  lower: string,
  periods: NavaEyePeriod[],
  metric: NavaEyeMetric
) {
  const comparisonLanguage =
    /\b(compare|comparison|difference|between|versus|vs|more than|less than|better than|worse than|how much more|how much less|this to that|that to this)\b/.test(
      lower
    );
  if (!comparisonLanguage) return null;

  const comparisonPeriods =
    periods.length >= 2
      ? periods.filter((period) =>
          ["today", "yesterday", "day_before_yesterday", "7d", "30d"].includes(period)
        )
      : /\btoday\b/.test(lower) && /\byesterday\b/.test(lower)
        ? (["yesterday", "today"] as NavaEyePeriod[])
        : [];

  if (!comparisonPeriods.length) return null;
  return {
    metric: metric === "unknown" ? "distance" : metric,
    periods: uniquePeriods(comparisonPeriods).slice(0, 2),
  };
}

function detectScope(
  lower: string,
  entities: NavaEyeStructuredQuery["detected_entities"],
  followUp: boolean,
  subjectLabel: string | null,
  intentFamily: NavaEyeIntentFamily
): NavaEyeStructuredQuery["scope"] {
  if (/\b(fleet|whole fleet|all trucks|all vehicles|all assets|company total|company-wide|company wide|fleet total)\b/.test(lower)) {
    return "fleet";
  }
  if (intentFamily === "management_actions" && isBroadActionRequest(lower)) {
    return "fleet";
  }
  if (
    entities.vehicles.length ||
    entities.providers.length ||
    entities.trip_references.length
  ) {
    return "explicit_subject";
  }
  if (followUp && subjectLabel) return "active_subject";
  return "unknown";
}

function detectFollowUp(lower: string, pendingFollowup: any) {
  if (!lower) return false;
  if (/^(yes|yeah|yep|correct|right|no|nope|that one|that truck)$/i.test(lower)) {
    return true;
  }
  if (/\b(it|that truck|this truck|that one|this one|that trip|this trip)\b/.test(lower)) {
    return true;
  }
  if (/^(what about|how about|and)\b/.test(lower)) return true;
  if (detectAuditMode(lower)) return true;
  return Boolean(pendingFollowup && Object.keys(pendingFollowup || {}).length > 0);
}

function detectIntentFamily(
  lower: string,
  input: {
    metric: NavaEyeMetric;
    comparison: NavaEyeStructuredQuery["comparison"];
    answerMode: "concise" | "audit";
  }
): NavaEyeIntentFamily {
  if (input.answerMode === "audit" && input.metric !== "proof_status") {
    return "explain_previous_answer";
  }
  if (input.comparison) return "compare_metric";
  if (detectManagementAction(lower)) return "management_actions";
  if (detectProviderCapability(lower)) return "provider_capability";
  if (detectFinanceRevenue(lower)) return "finance_revenue";
  if (detectExpenseEvidence(lower)) return "expense_evidence";
  if (detectTripPerformance(lower)) return "trip_performance";
  if (input.metric === "distance") return "distance";
  if (input.metric === "idle_markers" || input.metric === "stopped_time") {
    return "idle_or_stopped";
  }
  if (detectLiveStatus(lower)) return "live_status";
  return "unknown";
}

function detectSubjectType(
  lower: string,
  entities: NavaEyeStructuredQuery["detected_entities"],
  pendingFollowup: any
): NavaEyeSubjectType {
  if (entities.providers.length) return "provider";
  if (entities.trip_references.length || /\btrip|journey\b/.test(lower)) return "trip";
  if (entities.vehicles.length) return "truck";
  if (/\bclient|customer\b/.test(lower)) return "client";
  if (/\b(route|corridor)\b|\bfrom\b.*\bto\b/.test(lower)) return "route";
  if (pendingFollowup?.active_trip) return "trip";
  if (pendingFollowup?.active_topic?.entity_type === "truck") return "truck";
  return "unknown";
}

function detectSubjectLabel(
  entities: NavaEyeStructuredQuery["detected_entities"],
  pendingFollowup: any
) {
  return (
    entities.vehicles[0] ||
    entities.trip_references[0] ||
    entities.providers[0] ||
    pendingFollowup?.active_trip?.reference ||
    pendingFollowup?.active_topic?.display_label ||
    pendingFollowup?.active_topic?.truck_id ||
    null
  );
}

function detectManagementAction(lower: string) {
  return /\b(what should i do|what should we do|what should i check|so what should i check|what now|so what|what does that mean|act on|needs attention|action items?|management actions?|attention today|urgent|issues today)\b/.test(
    lower
  );
}

function isBroadActionRequest(lower: string) {
  return (
    /\bwhat\s+should\s+(i|we)\s+do\s+today\b/.test(lower) ||
    /\bwhat\s+should\s+i\s+act\s+on\b/.test(lower) ||
    /\bwhat\s+needs\s+attention\b/.test(lower) ||
    /\battention\s+today\b/.test(lower) ||
    /\b(action\s+items?|management\s+actions?|urgent|issues\s+today)\b/.test(lower)
  );
}

function detectProviderCapability(lower: string) {
  const mentionsProvider =
    /\b(provider|tracking|feed|sync|capability|capabilities|fleettrack|bluetrax|blue trax)\b/.test(
      lower
    );
  const mentionsSignal =
    /\b(expose|exposes|provide|provides|detected|mapped|fuel|engine|ignition|odometer|mileage|distance|idle|diagnostic|fault|driver|geofence)\b/.test(
      lower
    );
  return mentionsProvider && mentionsSignal;
}

function detectFinanceRevenue(lower: string) {
  return /\b(revenue review|trips? needing revenue|trips? need revenue|missing revenue|no rate rule|rate rule|matched rate|apply rate|configured rate|what rate applies)\b/.test(
    lower
  );
}

function detectExpenseEvidence(lower: string) {
  const mentionsProof =
    /\b(proof|receipt|receipts|evidence|attachment|attachments|document|documents|screenshot|screenshots|payment proof)\b/.test(
      lower
    );
  if (!mentionsProof) return false;
  return /\b(expense|expenses|trip|journey|per diem|allowance|supported|missing|attached|show)\b/.test(
    lower
  );
}

function detectTripPerformance(lower: string) {
  return (
    /\btrip|journey\b/.test(lower) &&
    /\b(perform|performance|make money|made money|contribution|contribute|profit|margin|ready for profit review|profit review)\b/.test(
      lower
    )
  ) ||
    /\b(make money|made money|contribution|profit|margin)\b/.test(lower);
}

function detectLiveStatus(lower: string) {
  return /\b(where|location|live now|is .* live|status now|where is it now|where is .* now)\b/.test(
    lower
  );
}

function cleanEntityLabel(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function uniquePeriods(periods: NavaEyePeriod[]) {
  return Array.from(new Set(periods));
}

function collectPeriodMatches(
  text: string,
  pattern: RegExp,
  period: NavaEyePeriod
) {
  const matches: Array<{ period: NavaEyePeriod; index: number; end: number }> = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    matches.push({
      period,
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
}

function isInsideAnySpan(index: number, spans: Array<{ index: number; end: number }>) {
  return spans.some((span) => index >= span.index && index < span.end);
}
