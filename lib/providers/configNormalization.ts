const HIGH_STAKES_TARGETS = new Set([
  "ignition_on",
  "engine_on",
  "engine_rpm",
  "fuel_level",
  "fuel_rate",
  "lifetime_fuel_used",
  "engine_hours",
  "fuel_raw",
  "fuel_volume_liters",
]);

const CLEAR_SIGNAL_ALIASES: Record<string, string[]> = {
  ignition_on: ["ignition", "ignition_on", "acc", "acc_on", "engine_on"],
  engine_on: ["engine_on", "ignition", "ignition_on", "acc", "acc_on"],
  engine_rpm: ["engine_rpm", "rpm", "engine_rpm_value"],
  fuel_level: [
    "fuel",
    "fuel_level",
    "fuellevel",
    "current_fuel_level",
    "currentfuellevel",
    "tank_level",
    "fuel_percent",
    "fuel_percentage",
  ],
  fuel_rate: ["fuel_rate", "fuelrate", "fuel_consumption", "fuelconsumption"],
  lifetime_fuel_used: [
    "lifetime_fuel_used",
    "total_fuel",
    "totalfuel",
    "fuel_used",
  ],
  engine_hours: ["engine_hours", "enginehours", "hours"],
  fuel_raw: ["fuel_raw", "fuelraw"],
  fuel_volume_liters: [
    "fuel_volume_liters",
    "fuel_liters",
    "fuel_litres",
    "tank_volume_liters",
  ],
};

const VAGUE_OR_IDENTIFIER_KEYS = [
  "id",
  "identifier",
  "measurement_id",
  "inaccuracy",
  "accuracy",
  "status",
  "type",
  "code",
];

export function normalizeRowPath(value: any) {
  let path = String(value || "").trim();
  if (!path) return "";
  path = path.replace(/\[\]\.?/g, ".");
  path = path.replace(/\.+/g, ".");
  path = path.replace(/\.$/, "");
  path = path.replace(/^\$\$+\./, "$.");
  path = path.replace(/^\$\$+$/, "$");
  while (path.startsWith("$.$.")) {
    path = "$." + path.slice(4);
  }
  return path;
}

export function dedupeRowPaths(values: any[]) {
  return Array.from(
    new Set((values || []).map(normalizeRowPath).filter(Boolean))
  );
}

export function getByPath(obj: any, path: string) {
  const rowPath = normalizeRowPath(path);
  if (rowPath === "$") return obj;
  const lookupPath = rowPath.startsWith("$.") ? rowPath.slice(2) : rowPath;
  return lookupPath.split(".").reduce((current, part) => current?.[part], obj);
}

export function extractRowsByPath(responseData: any, rowPath: string) {
  const path = normalizeRowPath(rowPath) || "$";
  const candidates = [getByPath(responseData, path)];

  if (Array.isArray(responseData) && path !== "$") {
    const childPath = path.startsWith("$.") ? path.slice(2) : path;
    for (const wrapper of responseData.slice(0, 10)) {
      if (wrapper && typeof wrapper === "object" && !Array.isArray(wrapper)) {
        candidates.push(getByPath(wrapper, childPath));
      }
    }
  }

  for (const candidate of candidates) {
    const rows = normalizeRows(candidate);
    if (rows.length > 0) return rows;
  }

  return [];
}

export function isVehicleLikeRow(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  if (
    hasAnyProviderField(value, [
      "vehicle",
      "truck",
      "truck_id",
      "reg",
      "reg_no",
      "registration",
      "plate",
      "unit",
      "unit_id",
      "device",
      "device_id",
      "name",
    ])
  ) {
    return true;
  }

  const hasLatitude = hasAnyProviderField(value, [
    "latitude",
    "lat",
    "gps_lat",
    "position_latitude",
    "y",
  ]);
  const hasLongitude = hasAnyProviderField(value, [
    "longitude",
    "lng",
    "lon",
    "gps_lng",
    "gps_lon",
    "position_longitude",
    "x",
  ]);
  const hasMovementContext = hasAnyProviderField(value, [
    "speed",
    "velocity",
    "kph",
    "speed_kph",
    "speed_kmh",
    "timestamp",
    "time",
    "fixtime",
    "currenttime",
    "current_time",
    "recorded_at",
    "gps_time",
  ]);

  return hasLatitude && hasLongitude && hasMovementContext;
}

export function stripRowPathPrefix(mappingPath: any, selectedRowPath: any) {
  let path = normalizeMappingPath(mappingPath);
  if (!path) return "";

  const rowPath = normalizeRowPath(selectedRowPath);
  if (!rowPath || rowPath === "$") return path;

  const rowPrefixes = rowPath.startsWith("$.")
    ? [rowPath.slice(2), rowPath]
    : [rowPath, `$.${rowPath}`];

  for (const prefix of rowPrefixes) {
    const normalizedPrefix = normalizeMappingPath(prefix);
    if (path === normalizedPrefix) return "";
    if (path.startsWith(`${normalizedPrefix}.`)) {
      return path.slice(normalizedPrefix.length + 1);
    }
  }

  return path;
}

export function normalizeFieldMappingsRelativeToRow(
  fieldMapping: any,
  selectedRowPath: any
) {
  if (!fieldMapping || typeof fieldMapping !== "object" || Array.isArray(fieldMapping)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [target, rawPath] of Object.entries(fieldMapping)) {
    const normalizedTarget = normalizeMappingTarget(target);
    const normalizedPath = stripRowPathPrefix(rawPath, selectedRowPath);
    if (!normalizedTarget || !normalizedPath) continue;
    if (!isSafeMappingForTarget(normalizedTarget, normalizedPath)) continue;
    output[normalizedTarget] = normalizedPath;
  }
  return output;
}

export function normalizeProviderConnectionConfig(
  fleetConfig: any,
  fieldMapping: any
) {
  const nextFleetConfig =
    fleetConfig && typeof fleetConfig === "object" && !Array.isArray(fleetConfig)
      ? JSON.parse(JSON.stringify(fleetConfig))
      : {};
  const currentFeed =
    nextFleetConfig.current_vehicle_feed &&
    typeof nextFleetConfig.current_vehicle_feed === "object" &&
    !Array.isArray(nextFleetConfig.current_vehicle_feed)
      ? nextFleetConfig.current_vehicle_feed
      : {};
  const currentRowPaths = dedupeRowPaths([
    currentFeed.row_path,
    ...(Array.isArray(currentFeed.row_paths) ? currentFeed.row_paths : []),
    ...(Array.isArray(nextFleetConfig.vehicle_paths)
      ? nextFleetConfig.vehicle_paths
      : []),
    nextFleetConfig.data_group,
  ]);
  const currentRowPath = currentRowPaths[0];
  const topLevelMapping = normalizeFieldMappingsRelativeToRow(
    fieldMapping || {},
    currentRowPath
  );
  const currentFeedMapping = normalizeFieldMappingsRelativeToRow(
    currentFeed.mapping || {},
    currentRowPath
  );
  const normalizedCurrentMapping = {
    ...currentFeedMapping,
    ...topLevelMapping,
  };

  if (currentRowPath) {
    nextFleetConfig.data_group = currentRowPath;
    nextFleetConfig.vehicle_paths = currentRowPaths;
    nextFleetConfig.current_vehicle_feed = {
      ...currentFeed,
      row_path: currentRowPath,
      row_paths: currentRowPaths,
      mapping: normalizedCurrentMapping,
    };
  } else if (Object.keys(normalizedCurrentMapping).length > 0) {
    nextFleetConfig.current_vehicle_feed = {
      ...currentFeed,
      mapping: normalizedCurrentMapping,
    };
  }

  normalizeMappedFeedOnConfig(nextFleetConfig, "current_status_vehicle_paths", "current_status_mapping");
  normalizeMappedFeedOnConfig(nextFleetConfig, "fuel_status_vehicle_paths", "fuel_status_mapping");
  normalizeMappedFeedOnConfig(nextFleetConfig, "distance_report_vehicle_paths", "distance_report_mapping");
  normalizeMappedFeedOnConfig(nextFleetConfig, "trip_summary_vehicle_paths", "trip_summary_mapping");

  if (
    nextFleetConfig.report_feed &&
    typeof nextFleetConfig.report_feed === "object" &&
    !Array.isArray(nextFleetConfig.report_feed)
  ) {
    const reportFeed = nextFleetConfig.report_feed;
    const reportRowPaths = dedupeRowPaths([
      reportFeed.row_path,
      ...(Array.isArray(reportFeed.row_paths) ? reportFeed.row_paths : []),
    ]);
    const reportRowPath = reportRowPaths[0];
    if (reportRowPath) {
      reportFeed.row_path = reportRowPath;
      reportFeed.row_paths = reportRowPaths;
    }
    reportFeed.mapping = normalizeFieldMappingsRelativeToRow(
      reportFeed.mapping || {},
      reportRowPath
    );
  }

  return {
    fleet_config: removeUndefinedKeys(nextFleetConfig),
    field_mapping: normalizedCurrentMapping,
  };
}

export function rankCandidateRowPaths(responseData: any, candidatePaths: any[]) {
  return dedupeRowPaths(candidatePaths)
    .map((path) => {
      const rows = extractRowsByPath(responseData, path);
      const nameScore = /vehicle|device|asset|truck|item|data|result/i.test(path)
        ? 3
        : 0;
      return { path, rows: rows.length, score: rows.length > 0 ? 5 + nameScore : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.rows - a.rows);
}

export function isSafeMappingForTarget(target: string, path: string) {
  if (!HIGH_STAKES_TARGETS.has(target)) return true;

  const normalizedPath = normalizeProviderKey(path);
  if (
    VAGUE_OR_IDENTIFIER_KEYS.some((blocked) =>
      normalizedPath.includes(normalizeProviderKey(blocked))
    )
  ) {
    return false;
  }

  return (CLEAR_SIGNAL_ALIASES[target] || []).some(
    (alias) => normalizedPath === normalizeProviderKey(alias) ||
      normalizedPath.endsWith(`_${normalizeProviderKey(alias)}`) ||
      normalizedPath.includes(normalizeProviderKey(alias))
  );
}

function normalizeRows(value: any): any[] {
  if (Array.isArray(value)) return value.filter(isVehicleLikeRow);
  if (isVehicleLikeRow(value)) return [value];
  return [];
}

function normalizeMappedFeedOnConfig(
  config: Record<string, any>,
  pathsKey: string,
  mappingKey: string
) {
  const rowPaths = Array.isArray(config[pathsKey])
    ? dedupeRowPaths(config[pathsKey])
    : [];
  if (rowPaths.length > 0) config[pathsKey] = rowPaths;
  config[mappingKey] = normalizeFieldMappingsRelativeToRow(
    config[mappingKey] || {},
    rowPaths[0]
  );
}

function removeUndefinedKeys(value: any): any {
  if (Array.isArray(value)) return value.map(removeUndefinedKeys);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    output[key] = removeUndefinedKeys(entry);
  }
  return output;
}

function hasAnyProviderField(value: any, aliases: string[], depth = 0): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) {
    return false;
  }

  const normalizedAliases = new Set(aliases.map(normalizeProviderKey));
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeProviderKey(key);
    if (
      normalizedAliases.has(normalizedKey) &&
      entry !== null &&
      entry !== undefined &&
      String(entry).trim() !== ""
    ) {
      return true;
    }

    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      hasAnyProviderField(entry, aliases, depth + 1)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeMappingTarget(value: any) {
  const target = String(value || "").trim();
  const aliases: Record<string, string> = {
    vehicle: "truck",
    timestamp: "recorded_at",
    ignition: "ignition_on",
    rpm: "engine_rpm",
    odometer: "odometer_km",
  };
  return aliases[target] || target;
}

function normalizeMappingPath(value: any) {
  let path = normalizeRowPath(value);
  if (path.startsWith("$.")) path = path.slice(2);
  return path;
}

function normalizeProviderKey(value: any) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
