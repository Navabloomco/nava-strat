import {
  DEFAULT_OPERATIONAL_TIME_ZONE,
  getOperationalZonedDateParts,
  parseProviderTimestamp,
} from "../timeFormatting";

export const DISTANCE_SUMMARY_FIELDS = [
  "provider_trip_key",
  "report_date",
  "report_start_time",
  "report_end_time",
  "start_location",
  "end_location",
  "start_odometer",
  "end_odometer",
  "mileage",
  "motion_duration",
  "violations_count",
];

export type DistanceDiagnostics = {
  summary_rows_found: number;
  summaries_normalized: number;
  summaries_written: number;
  asset_distance_updates: number;
  rows_skipped_over_cap: number;
  setup_required: boolean;
  table_missing: boolean;
  fleet_asset_columns_missing: boolean;
  odometer_health_counts: Record<string, number>;
  distance_source_counts: Record<string, number>;
  errors: string[];
};

export type ProviderTripSummary = {
  company_id: string;
  asset_id: string | null;
  provider_id: string;
  truck_id: string;
  provider_trip_key: string | null;
  report_date: string | null;
  start_time: string | null;
  end_time: string | null;
  start_location: string | null;
  end_location: string | null;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  odometer_delta_km: number | null;
  provider_mileage_km: number | null;
  motion_duration_minutes: number | null;
  violations_count: number | null;
  distance_source: string;
  distance_quality: string;
  odometer_health: string;
  asset_distance_quality: Record<string, any>;
  metadata: Record<string, any>;
};

export function parseDistanceCsv(
  csvText: string,
  options: { maxRows?: number } = {}
) {
  const maxRows = options.maxRows || 2000;
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) {
    return { headers: [] as string[], rows: [] as Record<string, string>[] };
  }

  const headers = rows[0].map((header, index) => {
    const clean = String(header || "")
      .replace(/^\uFEFF/, "")
      .trim();
    return clean || `column_${index + 1}`;
  });

  const parsedRows = rows
    .slice(1, maxRows + 1)
    .map((row) => {
      const output: Record<string, string> = {};
      headers.forEach((header, index) => {
        output[header] = String(row[index] || "").trim();
      });
      return output;
    })
    .filter((row) => Object.values(row).some((value) => String(value || "").trim()));

  return { headers, rows: parsedRows };
}

export function createDistanceDiagnostics(): DistanceDiagnostics {
  return {
    summary_rows_found: 0,
    summaries_normalized: 0,
    summaries_written: 0,
    asset_distance_updates: 0,
    rows_skipped_over_cap: 0,
    setup_required: false,
    table_missing: false,
    fleet_asset_columns_missing: false,
    odometer_health_counts: {},
    distance_source_counts: {},
    errors: [],
  };
}

export function normalizeProviderTripSummary(
  row: any,
  mapping: Record<string, string> = {},
  context: {
    companyId: string;
    providerId: string;
    providerTimezone?: string | null;
  }
): ProviderTripSummary | null {
  if (!row || typeof row !== "object") return null;

  const truckId = normalizeDistanceTruckId(
    getMappedValue(row, "truck", mapping) ||
      getFirstAvailable(row, getDistanceFieldFallbackKeys("truck"))
  );
  if (!truckId) return null;

  const providerTimezone =
    safeTimezone(context.providerTimezone) || DEFAULT_OPERATIONAL_TIME_ZONE;
  const startOdometerKm = getMappedNumber(row, "start_odometer", mapping);
  const endOdometerKm = getMappedNumber(row, "end_odometer", mapping);
  const providerMileageKm = getMappedNumber(row, "mileage", mapping);
  const motionDurationMinutes = parseMotionDurationMinutes(
    getMappedValue(row, "motion_duration", mapping)
  );
  const violationsCount = parseViolationsCount(
    getMappedValue(row, "violations_count", mapping)
  );
  const startTime = parseDistanceTimestamp(
    getMappedValue(row, "report_start_time", mapping),
    providerTimezone
  );
  const endTime = parseDistanceTimestamp(
    getMappedValue(row, "report_end_time", mapping),
    providerTimezone
  );
  const currentTime = parseDistanceTimestamp(
    getMappedValue(row, "current_time", mapping),
    providerTimezone
  );
  const reportDate =
    parseReportDate(getMappedValue(row, "report_date", mapping), providerTimezone) ||
    localDateFromIso(startTime || endTime || currentTime, providerTimezone);
  const startLocation = safeShortText(
    getMappedValue(row, "start_location", mapping)
  );
  const endLocation = safeShortText(getMappedValue(row, "end_location", mapping));

  const hasDistanceEvidence =
    startOdometerKm !== null ||
    endOdometerKm !== null ||
    providerMileageKm !== null ||
    motionDurationMinutes !== null ||
    violationsCount !== null ||
    Boolean(startLocation || endLocation || startTime || endTime || reportDate);

  if (!hasDistanceEvidence) return null;

  const evidence = analyzeDistanceEvidence({
    startOdometerKm,
    endOdometerKm,
    providerMileageKm,
  });
  const providerTripKey = safeShortText(
    getMappedValue(row, "provider_trip_key", mapping)
  ) || buildFallbackTripKey({
    truckId,
    reportDate,
    startTime,
    endTime,
    providerMileageKm,
    startLocation,
    endLocation,
  });

  return {
    company_id: context.companyId,
    asset_id: null,
    provider_id: context.providerId,
    truck_id: truckId,
    provider_trip_key: providerTripKey,
    report_date: reportDate,
    start_time: startTime,
    end_time: endTime,
    start_location: startLocation,
    end_location: endLocation,
    start_odometer_km: startOdometerKm,
    end_odometer_km: endOdometerKm,
    odometer_delta_km: evidence.odometer_delta_km,
    provider_mileage_km: providerMileageKm,
    motion_duration_minutes: motionDurationMinutes,
    violations_count: violationsCount,
    distance_source: evidence.distance_source,
    distance_quality: evidence.distance_quality,
    odometer_health: evidence.odometer_health,
    asset_distance_quality: evidence.asset_distance_quality,
    metadata: {
      provider_timezone: providerTimezone,
      source: "provider_trip_summary",
      provider_reported_mileage:
        providerMileageKm !== null && providerMileageKm !== undefined,
      physical_odometer_values_seen:
        startOdometerKm !== null || endOdometerKm !== null,
    },
  };
}

export function analyzeDistanceEvidence(input: {
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  providerMileageKm: number | null;
}) {
  const { startOdometerKm, endOdometerKm, providerMileageKm } = input;
  const odometerDeltaKm =
    startOdometerKm !== null && endOdometerKm !== null
      ? roundKm(endOdometerKm - startOdometerKm)
      : null;
  let odometerHealth = "unknown";
  let distanceSource = "unknown";
  let distanceQuality = "unknown";
  let mismatch = false;
  let mismatchKm: number | null = null;

  if (providerMileageKm !== null && providerMileageKm > 0) {
    distanceSource = "provider_mileage";
    distanceQuality = "valid";
  } else if (odometerDeltaKm !== null && odometerDeltaKm > 0) {
    distanceSource = "physical_odometer";
    distanceQuality = "valid";
  }

  if (odometerDeltaKm !== null) {
    if (odometerDeltaKm < 0) {
      odometerHealth = "rollover_suspected";
      distanceQuality = "suspect";
    } else if (
      providerMileageKm !== null &&
      providerMileageKm > 10 &&
      odometerDeltaKm === 0
    ) {
      odometerHealth =
        startOdometerKm === 0 && endOdometerKm === 0
          ? "static_zero"
          : "static_nonzero";
      distanceQuality = "suspect";
    } else if (providerMileageKm !== null && providerMileageKm > 0) {
      mismatchKm = roundKm(Math.abs(odometerDeltaKm - providerMileageKm));
      const toleranceKm = Math.max(5, providerMileageKm * 0.25);
      mismatch = mismatchKm > toleranceKm;
      if (mismatch) {
        odometerHealth = "mismatch";
        distanceQuality = "suspect";
      } else if (odometerDeltaKm > 0) {
        odometerHealth = "valid";
      }
    } else if (odometerDeltaKm > 0) {
      odometerHealth = "valid";
    }
  }

  return {
    odometer_delta_km: odometerDeltaKm,
    odometer_health: odometerHealth,
    distance_source: distanceSource,
    distance_quality: distanceQuality,
    asset_distance_quality: {
      odometer_delta_km: odometerDeltaKm,
      provider_mileage_km: providerMileageKm,
      mismatch,
      mismatch_km: mismatchKm,
      odometer_health: odometerHealth,
      distance_source: distanceSource,
      provider_reported_mileage:
        providerMileageKm !== null && providerMileageKm !== undefined,
      physical_odometer_usable:
        odometerHealth === "valid" && odometerDeltaKm !== null && odometerDeltaKm > 0,
    },
  };
}

export function distanceEvidenceWording(input: {
  odometerHealth?: string | null;
  distanceSource?: string | null;
  providerMileageKm?: number | null;
  odometerDeltaKm?: number | null;
}) {
  const health = String(input.odometerHealth || "unknown");
  if (health === "static_zero" || health === "static_nonzero") {
    return "The dashboard odometer is not reliable for this asset. Distance should use provider-reported mileage or GPS-derived movement until the odometer is inspected.";
  }
  if (health === "valid") {
    if (input.providerMileageKm === null || input.providerMileageKm === undefined) {
      return "Physical odometer movement is usable for this asset, but provider mileage is not available for comparison.";
    }
    return "Physical odometer movement is consistent with provider mileage.";
  }
  if (health === "mismatch") {
    const providerMileage =
      input.providerMileageKm === null || input.providerMileageKm === undefined
        ? "unknown"
        : `${roundKm(input.providerMileageKm)} km`;
    const odometerDelta =
      input.odometerDeltaKm === null || input.odometerDeltaKm === undefined
        ? "unknown"
        : `${roundKm(input.odometerDeltaKm)} km`;
    return `Distance signals disagree: the provider reported ${providerMileage}, while the odometer changed by ${odometerDelta}. Treat the dashboard odometer as suspect until inspected.`;
  }
  return "Distance source reliability is not classified yet.";
}

export function getDistanceFieldFallbackKeys(field: string) {
  switch (field) {
    case "truck":
      return ["truck", "truck_id", "truckId", "reg_no", "registration", "vehicle", "unit_id", "unitId"];
    case "provider_trip_key":
      return ["provider_trip_key", "trip_key", "tripId", "trip_id", "report_id", "reportId"];
    case "report_date":
      return ["report_date", "reportDate", "date", "Date"];
    case "report_start_time":
      return ["report_start_time", "start_time", "startTime", "startDate", "StartTime", "StartTimeStamp", "StartLocationTime"];
    case "report_end_time":
      return ["report_end_time", "end_time", "endTime", "endDate", "EndTime", "EndTimeStamp", "EndLocationTime"];
    case "current_time":
      return ["current_time", "currentTime", "CurrentTime", "fixtime", "fixTime", "recorded_at"];
    case "start_location":
      return ["start_location", "startLocation", "StartLocation", "origin", "from"];
    case "end_location":
      return ["end_location", "endLocation", "EndLocation", "destination", "to"];
    case "start_odometer":
      return ["start_odometer", "startOdometer", "StartOdometer", "start_odometer_km"];
    case "end_odometer":
      return ["end_odometer", "endOdometer", "EndOdometer", "end_odometer_km"];
    case "mileage":
      return ["mileage", "Mileage", "distance", "distance_km", "DistanceKm", "provider_mileage"];
    case "motion_duration":
      return ["motion_duration", "motionDuration", "MotionDuration", "moving_duration", "drive_time"];
    case "violations_count":
      return ["violations_count", "violation_count", "violations", "Violations", "violationCount"];
    default:
      return [field];
  }
}

function getMappedNumber(row: any, field: string, mapping: Record<string, string>) {
  return parseNumber(getMappedValue(row, field, mapping));
}

function getMappedValue(row: any, field: string, mapping: Record<string, string>) {
  const mappedPath = mapping?.[field];
  if (mappedPath) {
    const mappedValue = getValueByCaseInsensitivePath(row, mappedPath);
    if (isPresent(mappedValue)) return mappedValue;
  }

  return getFirstAvailable(row, getDistanceFieldFallbackKeys(field));
}

function getFirstAvailable(row: any, keys: string[]) {
  for (const key of keys) {
    const value = getValueByCaseInsensitivePath(row, key);
    if (isPresent(value)) return value;
  }
  return null;
}

function getValueByCaseInsensitivePath(obj: any, path: string) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let current = obj;

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (typeof current !== "object") return undefined;
    const key = Object.keys(current).find(
      (candidate) => candidate.toLowerCase() === part.toLowerCase()
    );
    if (!key) return undefined;
    current = current[key];
  }

  return current;
}

function isPresent(value: any) {
  return value !== undefined && value !== null && value !== "";
}

function parseNumber(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundKm(value) : null;
  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? roundKm(parsed) : null;
}

function parseMotionDurationMinutes(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const text = String(value).trim();
  if (!text) return null;
  const parts = text.split(":").map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return Math.round(parts[0] * 60 + parts[1] + parts[2] / 60);
  }
  if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
    return Math.round(parts[0] * 60 + parts[1]);
  }
  return parseNumber(text);
}

function parseViolationsCount(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.length;
  const parsed = parseNumber(value);
  if (parsed !== null) return Math.round(parsed);
  const text = String(value).trim();
  if (!text) return null;
  return text.split(/[;,|]/).map((part) => part.trim()).filter(Boolean).length || null;
}

function parseDistanceTimestamp(value: any, timeZone: string) {
  const parsed = parseProviderTimestamp(value, timeZone);
  return parsed ? parsed.toISOString() : null;
}

function parseReportDate(value: any, timeZone: string) {
  if (!isPresent(value)) return null;
  const parsed = parseProviderTimestamp(value, timeZone);
  if (parsed) return localDateFromIso(parsed.toISOString(), timeZone);
  const match = String(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function localDateFromIso(value: any, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = getOperationalZonedDateParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function normalizeDistanceTruckKey(value: any) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizeDistanceTruckId(value: any) {
  const text = String(value || "").trim();
  return text && text.toUpperCase() !== "UNKNOWN" ? text.toUpperCase() : "";
}

function safeShortText(value: any) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 240) : null;
}

function safeTimezone(value: any) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: text }).format(new Date());
    return text;
  } catch {
    return "";
  }
}

function buildFallbackTripKey(input: {
  truckId: string;
  reportDate: string | null;
  startTime: string | null;
  endTime: string | null;
  providerMileageKm: number | null;
  startLocation: string | null;
  endLocation: string | null;
}) {
  const source = [
    input.truckId,
    input.reportDate || "",
    input.startTime || "",
    input.endTime || "",
    input.providerMileageKm ?? "",
    input.startLocation || "",
    input.endLocation || "",
  ].join("|");

  return `distance_${stableHash(source)}`;
}

function roundKm(value: number) {
  return Math.round(value * 100) / 100;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => String(value || "").trim())) rows.push(row);

  return rows;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
