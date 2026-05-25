import { normalizeTelemetryCapability } from "../telemetry/capabilities";

type AnswerQualityInput = {
  answer: string;
  question: string;
  originalQuestion?: string | null;
  context?: any;
};

type AnswerQualityResult = {
  answer: string;
  warnings: string[];
};

const RAW_COORDINATE_PAIR =
  /\b-?(?:[0-8]?\d(?:\.\d{4,})?|90(?:\.0+)?)\s*,\s*-?(?:(?:1[0-7]\d|[0-9]?\d)(?:\.\d{4,})?|180(?:\.0+)?)\b/g;

const ENTITY_LIKE_TOKEN = /\b[A-Z]{2,4}\s*[-.]?\s*\d{2,4}\s*[A-Z]?\b/i;

const FOLLOWUP_REFERENCE =
  /\b(how about|what about|that truck|this truck|that one|that number|that mileage|that distance|covered today|was that today|is that today|is it today|is that odometer mileage|the\s+\d+(?:\.\d+)?\s*km)\b/i;

const COORDINATE_REQUEST =
  /\b(coordinate|coordinates|gps|latitude|longitude|lat\/long|lat long|map pin|exact point|map link)\b/i;

const LIMITED_CONTEXT =
  /Nava Eye found limited context\. Ask about fleet health, offline trucks, fuel risk, truck status, driver activity, or journeys\./i;

const ENGINE_ON_CONFIRMED =
  /\b(?:engine-on idling|engine-on idle|active fuel-burn idling)\s+(?:is\s+)?confirmed\b/gi;

export function applyNavaEyeAnswerQualityGuardrails(
  input: AnswerQualityInput
): AnswerQualityResult {
  const warnings: string[] = [];
  const prompt = `${input.question || ""} ${input.originalQuestion || ""}`.trim();
  let answer = String(input.answer || "");

  if (hasEntityLikePrompt(prompt) && LIMITED_CONTEXT.test(answer)) {
    answer =
      "I found a vehicle-like follow-up, but I could not resolve it safely in this company workspace. Use the exact truck registration or ask for fleet scope.";
    warnings.push("entity_like_limited_context_replaced");
  }

  const beforeVoiceCleanup = answer;
  answer = answer
    .replace(/\bNava reads this as\b/gi, "This is")
    .replace(/\bNava treats this as\b/gi, "This is")
    .replace(/\bNava can confirm\b/gi, "The evidence confirms")
    .replace(/\bNava only has\b/gi, "Only");
  if (answer !== beforeVoiceCleanup) {
    warnings.push("third_person_self_reference_rewritten");
  }

  if (!asksForCoordinates(prompt)) {
    RAW_COORDINATE_PAIR.lastIndex = 0;
    if (RAW_COORDINATE_PAIR.test(answer)) {
      RAW_COORDINATE_PAIR.lastIndex = 0;
      answer = answer.replace(RAW_COORDINATE_PAIR, "GPS point hidden by default");
      warnings.push("raw_coordinates_hidden");
    }
  }

  if (!supportsEngineOnIdleClaim(input.context)) {
    ENGINE_ON_CONFIRMED.lastIndex = 0;
    if (ENGINE_ON_CONFIRMED.test(answer)) {
      ENGINE_ON_CONFIRMED.lastIndex = 0;
      answer = answer.replace(
        ENGINE_ON_CONFIRMED,
        "engine-on idling is not confirmed with the current hardware signals"
      );
      warnings.push("unsupported_engine_idle_claim_rewritten");
    }
  }

  return { answer, warnings };
}

export function hasEntityLikePrompt(value: string) {
  return ENTITY_LIKE_TOKEN.test(value) || FOLLOWUP_REFERENCE.test(value);
}

export function asksForCoordinates(value: string) {
  return COORDINATE_REQUEST.test(value);
}

function supportsEngineOnIdleClaim(context: any) {
  if (!context || typeof context !== "object") return false;

  if (hasExplicitEngineOrIgnitionSignal(context)) return true;

  const capabilities = collectCapabilityValues(context);
  return capabilities.some((value) => {
    const capability = normalizeTelemetryCapability(value);
    return ["GPS_WITH_IGNITION", "CAN_BUS", "HYBRID_CAN_AND_FUEL_ROD"].includes(
      capability
    );
  });
}

function hasExplicitEngineOrIgnitionSignal(value: any, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 3) return false;

  if (value.engine_on === true) {
    return true;
  }

  if (value.ignition_on === true) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasExplicitEngineOrIgnitionSignal(entry, depth + 1));
  }

  return Object.values(value).some((entry) =>
    hasExplicitEngineOrIgnitionSignal(entry, depth + 1)
  );
}

function collectCapabilityValues(value: any, depth = 0): any[] {
  if (!value || typeof value !== "object" || depth > 4) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectCapabilityValues(entry, depth + 1));
  }

  const output: any[] = [];
  if ("telemetry_capability" in value) output.push(value.telemetry_capability);
  if ("telemetryCapability" in value) {
    const entry = value.telemetryCapability;
    output.push(typeof entry === "object" ? entry?.capability : entry);
  }
  if (
    "capability" in value &&
    ["UNKNOWN", "GPS_ONLY", "GPS_WITH_IGNITION", "CAN_BUS", "FUEL_ROD", "HYBRID_CAN_AND_FUEL_ROD"].includes(
      String(value.capability || "").toUpperCase()
    )
  ) {
    output.push(value.capability);
  }

  for (const entry of Object.values(value)) {
    output.push(...collectCapabilityValues(entry, depth + 1));
  }

  return output;
}
