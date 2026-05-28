export const CANONICAL_PROVIDER_IDLE_EVENT_TYPE = "provider_idle_marker";

export type ProviderIdleMarkerKind =
  | "idle"
  | "excessive_idle"
  | "prolonged_idle"
  | "stop_idle";

export type ProviderIdleMarkerDetection = {
  canonical_event_type: typeof CANONICAL_PROVIDER_IDLE_EVENT_TYPE;
  marker_kind: ProviderIdleMarkerKind;
  original_label: string;
  display_label: string;
  source_key: string | null;
  severity: "medium" | "high";
  duration_minutes: number | null;
  evidence_source: "provider-derived" | "legacy-event-type";
};

const IDLE_KEY_HINTS = [
  "idle",
  "idling",
  "event",
  "alert",
  "alarm",
  "marker",
  "status",
  "state",
  "violation",
  "activity",
  "motion",
];

const SENSITIVE_KEY_PARTS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "session",
  "jwt",
  "apikey",
  "api_key",
];

export function extractProviderIdleMarkersFromRow(raw: any): ProviderIdleMarkerDetection[] {
  const markers: ProviderIdleMarkerDetection[] = [];
  const seen = new Set<string>();
  const durationMinutes = findProviderIdleDurationMinutes(raw);

  collectSafeScalarEntries(raw).forEach(({ path, value }) => {
    const marker = normalizeProviderIdleMarker(value, path);
    if (!marker) return;

    const dedupeKey = `${marker.marker_kind}|${marker.source_key || ""}|${marker.original_label}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    markers.push({
      ...marker,
      duration_minutes: marker.duration_minutes ?? durationMinutes,
    });
  });

  return markers.slice(0, 5);
}

export function normalizeProviderIdleMarker(
  value: any,
  sourceKey?: string | null
): ProviderIdleMarkerDetection | null {
  const original = coerceMarkerText(value);
  const normalizedKey = normalizeText(sourceKey || "");
  const keyHasIdle = /\bidle|idling\b/.test(normalizedKey);
  const keyHasHint = keyHasIdle || IDLE_KEY_HINTS.some((hint) => normalizedKey.includes(hint));

  if (isFalseLike(value)) return null;

  if (keyHasIdle && isTrueLike(value)) {
    return buildMarker("idle", "Idle", sourceKey || null, "provider-derived", null);
  }

  if (keyHasIdle && isPositiveNumberLike(value)) {
    return buildMarker(
      markerKindFromText(normalizedKey) || "idle",
      keyLabel(sourceKey || "idle"),
      sourceKey || null,
      "provider-derived",
      parseDurationMinutes(value)
    );
  }

  if (!original) return null;

  const normalized = normalizeText(original);
  const kind = markerKindFromText(`${normalizedKey} ${normalized}`);
  if (!kind) return null;

  if (!keyHasHint && !isStrongIdlePhrase(normalized)) return null;

  return buildMarker(kind, original, sourceKey || null, "provider-derived", parseDurationMinutes(value));
}

export function isProviderIdleMarkerEvent(rowOrType: any): boolean {
  const row =
    rowOrType && typeof rowOrType === "object"
      ? rowOrType
      : { event_type: rowOrType };
  if (String(row.event_type || "") === CANONICAL_PROVIDER_IDLE_EVENT_TYPE) return true;

  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const evidenceSource = normalizeText(metadata.evidence_source || metadata.source || "");
  if (evidenceSource.includes("gps") && !metadata.provider_marker_kind && !metadata.provider_marker_label) {
    return false;
  }
  const text = [
    row.event_type,
    row.context_type,
    row.context_label,
    metadata.evidence_source,
    metadata.provider_marker_kind,
    metadata.provider_marker_label,
  ]
    .filter(Boolean)
    .join(" ");

  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/\b(?:stopped|stationary|long stop|long_stop)\b/.test(normalized) && !/\bidle|idling\b/.test(normalized)) {
    return false;
  }
  return Boolean(markerKindFromText(normalized));
}

export function canonicalProviderIdleEventType(rowOrType: any): string {
  const row =
    rowOrType && typeof rowOrType === "object"
      ? rowOrType
      : { event_type: rowOrType };
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const text = [
    row.event_type,
    row.context_type,
    row.context_label,
    metadata.provider_marker_kind,
    metadata.provider_marker_label,
  ]
    .filter(Boolean)
    .join(" ");
  const kind = markerKindFromText(normalizeText(text));
  return kind || CANONICAL_PROVIDER_IDLE_EVENT_TYPE;
}

export function providerIdleMarkerLabel(rowOrType: any): string {
  const type = canonicalProviderIdleEventType(rowOrType);
  if (type === "excessive_idle") return "Provider excessive-idle marker";
  if (type === "prolonged_idle") return "Provider prolonged-idle marker";
  if (type === "stop_idle") return "Provider stop-idle marker";
  return "Provider idle marker";
}

function buildMarker(
  kind: ProviderIdleMarkerKind,
  label: string,
  sourceKey: string | null,
  evidenceSource: ProviderIdleMarkerDetection["evidence_source"],
  durationMinutes: number | null
): ProviderIdleMarkerDetection {
  return {
    canonical_event_type: CANONICAL_PROVIDER_IDLE_EVENT_TYPE,
    marker_kind: kind,
    original_label: sanitizeMarkerLabel(label),
    display_label: displayLabelForKind(kind),
    source_key: sourceKey ? sanitizeSourceKey(sourceKey) : null,
    severity: kind === "excessive_idle" || kind === "prolonged_idle" ? "high" : "medium",
    duration_minutes: durationMinutes,
    evidence_source: evidenceSource,
  };
}

function markerKindFromText(value: string): ProviderIdleMarkerKind | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/\b(?:excessive|over|high)\s+id(?:le|ling)\b/.test(text)) return "excessive_idle";
  if (/\b(?:prolonged|long|extended)\s+id(?:le|ling)\b/.test(text)) return "prolonged_idle";
  if (/\bstop\s+id(?:le|ling)\b/.test(text) || /\bid(?:le|ling)\s+stop\b/.test(text)) return "stop_idle";
  if (/\bidling\b/.test(text) || /\bidle\b/.test(text)) return "idle";
  return null;
}

function isStrongIdlePhrase(value: string) {
  const text = normalizeText(value);
  return (
    /^(?:idle|idling)$/.test(text) ||
    /\b(?:excessive|prolonged|long|extended|stop|engine)\s+id(?:le|ling)\b/.test(text) ||
    /\bid(?:le|ling)\s+(?:event|alert|marker|alarm|warning|status)\b/.test(text)
  );
}

function collectSafeScalarEntries(raw: any) {
  const entries: Array<{ path: string; value: any }> = [];
  const seen = new Set<any>();

  function walk(value: any, path: string, depth: number) {
    if (entries.length >= 120 || depth > 5 || value === null || value === undefined) return;

    if (typeof value !== "object") {
      if (path) entries.push({ path, value });
      return;
    }

    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKey(key)) continue;
      const nextPath = path ? `${path}.${key}` : key;
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(raw, "", 0);
  return entries;
}

function findProviderIdleDurationMinutes(raw: any): number | null {
  const entries = collectSafeScalarEntries(raw);
  const durationEntry = entries.find(({ path, value }) => {
    const key = normalizeText(path);
    return (
      /\bidle\b/.test(key) &&
      /\b(?:duration|minutes|mins|time|seconds|secs)\b/.test(key) &&
      parseDurationMinutes(value) !== null
    );
  });
  return durationEntry ? parseDurationMinutes(durationEntry.value) : null;
}

function parseDurationMinutes(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 24 * 60 * 60 ? Math.round(value / 60) : Math.round(value);
  }

  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  const plainNumber = text.match(/^\d+(?:\.\d+)?$/);

  let minutes = 0;
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (secondMatch && !minuteMatch && !hourMatch) minutes += Number(secondMatch[1]) / 60;
  if (!minutes && plainNumber) minutes = Number(plainNumber[0]);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes);
}

function isPositiveNumberLike(value: any) {
  const number = parseDurationMinutes(value);
  return number !== null && number > 0;
}

function isTrueLike(value: any) {
  if (value === true || value === 1) return true;
  const text = String(value || "").trim().toLowerCase();
  return ["true", "yes", "y", "on", "1", "active"].includes(text);
}

function isFalseLike(value: any) {
  if (value === false || value === 0) return true;
  const text = String(value || "").trim().toLowerCase();
  return ["false", "no", "n", "off", "0", "none", "null", "inactive"].includes(text);
}

function coerceMarkerText(value: any) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function normalizeText(value: any) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}\s/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function keyLabel(value: string) {
  return value
    .split(".")
    .pop()
    ?.replace(/[_-]+/g, " ")
    .trim() || "idle";
}

function displayLabelForKind(kind: ProviderIdleMarkerKind) {
  if (kind === "excessive_idle") return "Excessive idle";
  if (kind === "prolonged_idle") return "Prolonged idle";
  if (kind === "stop_idle") return "Stop idle";
  return "Idle";
}

function sanitizeMarkerLabel(value: any) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function sanitizeSourceKey(value: string) {
  return String(value || "")
    .replace(/[^\w.[\]-]/g, "")
    .slice(0, 120);
}

function isSensitiveKey(key: string) {
  const text = String(key || "").toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => text.includes(part));
}
