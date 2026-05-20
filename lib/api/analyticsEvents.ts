import { supabaseAdmin } from "../supabaseAdmin";

type AnalyticsMetadata = Record<string, any>;

type AnalyticsEventInput = {
  companyId?: string | null;
  userId?: string | null;
  eventName: string;
  eventCategory: string;
  source?: string | null;
  metadata?: AnalyticsMetadata | null;
};

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_DEPTH = 4;

const DANGEROUS_KEY_PARTS = [
  "password",
  "token",
  "cookie",
  "authorization",
  "api_key",
  "apikey",
  "provider_secret",
  "auth_config",
  "raw_payload",
  "credentials",
  "secret",
];

const RAW_TEXT_KEYS = new Set([
  "question",
  "prompt",
  "answer",
  "response",
  "full_question",
  "full_answer",
  "raw_question",
  "raw_answer",
]);

export async function recordAnalyticsEvent(input: AnalyticsEventInput) {
  try {
    const eventName = String(input.eventName || "").trim();
    const eventCategory = String(input.eventCategory || "").trim();

    if (!eventName || !eventCategory) {
      return { success: false, error: "event_name and event_category are required" };
    }

    const { error } = await supabaseAdmin.from("analytics_events").insert({
      company_id: input.companyId || null,
      user_id: input.userId || null,
      event_name: eventName.slice(0, 120),
      event_category: eventCategory.slice(0, 80),
      source: input.source ? String(input.source).slice(0, 120) : null,
      metadata: sanitizeAnalyticsMetadata(input.metadata),
    });

    if (error) {
      console.warn("Analytics event skipped:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn("Analytics event skipped:", err.message || "Unknown analytics error");
    return { success: false, error: err.message || "Unknown analytics error" };
  }
}

export function sanitizeAnalyticsMetadata(metadata: any) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return sanitizeObject(metadata, 0);
}

function sanitizeObject(value: AnalyticsMetadata, depth: number): AnalyticsMetadata {
  if (depth > MAX_DEPTH) return {};

  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const output: AnalyticsMetadata = {};

  for (const [key, entry] of entries) {
    if (!isSafeMetadataKey(key)) continue;
    const sanitizedValue = sanitizeValue(entry, depth + 1);
    if (sanitizedValue !== undefined) {
      output[key] = sanitizedValue;
    }
  }

  return output;
}

function sanitizeValue(value: any, depth: number): any {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value === null || typeof value === "boolean") return value;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    if (depth > MAX_DEPTH) return [];
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    return sanitizeObject(value, depth);
  }

  return undefined;
}

function isSafeMetadataKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  if (RAW_TEXT_KEYS.has(normalized)) return false;
  return !DANGEROUS_KEY_PARTS.some((part) => normalized.includes(part));
}
