export const DEFAULT_OPERATIONAL_TIME_ZONE = "Africa/Nairobi";

const KENYA_TIME_ZONE_OFFSET_MINUTES = 180;

export function resolveOperationalTimeZone(source?: any) {
  const candidates = [
    source?.timezone,
    source?.time_zone,
    source?.operational_timezone,
    source?.fleet_timezone,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value && isValidTimeZone(value)) return value;
  }

  return DEFAULT_OPERATIONAL_TIME_ZONE;
}

export function operationalTimeZoneLabel(timeZone = DEFAULT_OPERATIONAL_TIME_ZONE) {
  return timeZone === DEFAULT_OPERATIONAL_TIME_ZONE
    ? "EAT (Kenya time)"
    : timeZone;
}

export function formatOperationalDateTime(
  value: any,
  timeZone = DEFAULT_OPERATIONAL_TIME_ZONE
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";

  const formatted = new Intl.DateTimeFormat("en-KE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${formatted} ${operationalTimeZoneLabel(timeZone)}`;
}

export function isAmbiguousProviderTimestampValue(value: any) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (!/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) return false;
  return !/(z|utc|gmt|[+-]\d{2}:?\d{2})$/i.test(text);
}

export function parseProviderTimestamp(
  value: any,
  timeZone = DEFAULT_OPERATIONAL_TIME_ZONE
) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (
    typeof value === "string" &&
    isAmbiguousProviderTimestampValue(value) &&
    timeZone === DEFAULT_OPERATIONAL_TIME_ZONE
  ) {
    const date = parseNaiveKenyaTimestamp(value);
    if (date) return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function hasAmbiguousTimestampWarning(value: any) {
  const warnings = Array.isArray(value?.warnings)
    ? value.warnings
    : Array.isArray(value)
      ? value
      : [];

  return warnings.some((warning: any) =>
    String(warning || "").toLowerCase().includes("timestamp")
  );
}

function parseNaiveKenyaTimestamp(value: string) {
  const match = value
    .trim()
    .match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[tT\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/
    );

  if (!match) return null;

  const [, year, month, day, hour = "0", minute = "0", second = "0", millisecond = "0"] =
    match;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, "0").slice(0, 3))
  );

  return new Date(utcMillis - KENYA_TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
