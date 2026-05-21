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

export function resolveOperationalDayRange(timeZone: string, dayOffset = 0) {
  const now = new Date();
  const localParts = getOperationalZonedDateParts(now, timeZone);
  const targetLocalDate = new Date(
    Date.UTC(localParts.year, localParts.month - 1, localParts.day + dayOffset)
  );
  const targetParts = getOperationalZonedDateParts(targetLocalDate, "UTC");
  const start = zonedDateTimeToUtc(
    targetParts.year,
    targetParts.month,
    targetParts.day,
    0,
    0,
    0,
    timeZone
  );
  const nextLocalDay = new Date(
    Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day + 1)
  );
  const nextParts = getOperationalZonedDateParts(nextLocalDay, "UTC");
  const end = zonedDateTimeToUtc(
    nextParts.year,
    nextParts.month,
    nextParts.day,
    0,
    0,
    0,
    timeZone
  );

  return {
    localDate: `${targetParts.year}-${String(targetParts.month).padStart(2, "0")}-${String(
      targetParts.day
    ).padStart(2, "0")}`,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
  };
}

export function getOperationalZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = Number(part.value);
  }
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour === 24 ? 0 : lookup.hour || 0,
    minute: lookup.minute || 0,
    second: lookup.second || 0,
  };
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

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMillis(utcGuess, timeZone);
  const firstPass = new Date(utcGuess.getTime() - offset);
  const adjustedOffset = getTimeZoneOffsetMillis(firstPass, timeZone);
  return new Date(utcGuess.getTime() - adjustedOffset);
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string) {
  const parts = getOperationalZonedDateParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return zonedAsUtc - date.getTime();
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
