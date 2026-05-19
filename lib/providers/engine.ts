import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicle } from "./normalizeVehicle";

export type ProviderRecord = {
  id: string;
  provider_name: string;
  auth_type: string | null;
  login_url: string | null;
  fleet_url: string | null;
  default_login_url?: string | null;
  default_fleet_url?: string | null;
  username: string | null;
  api_key: string | null;
  password: string | null;
  bearer_token: string | null;
  auth_config?: any;
  fleet_config?: any;
  field_mapping?: any;
  company_id?: string;        // ✅ multi‑tenant key
};

export type SyncResult = {
  success: boolean;
  message: string;
  vehicleCount: number;
  sample_normalized?: any;
  supplemental_diagnostics?: SupplementalDiagnostics;
  debug?: any;
};

type AuthResult = {
  success: boolean;
  token?: string | null;
  metadata?: AuthMetadata;
  message?: string;
  debug?: any;
};

type AuthMetadata = {
  auth_user_id?: string | number;
  provider_user_id?: string | number;
  analytics_user_id?: string | number;
};

type FleetResult = {
  success: boolean;
  vehicles: any[];
  message?: string;
  debug?: any;
};

type SupplementalFeedConfig = {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, any>;
  payload?: Record<string, any>;
  vehicle_paths?: string[];
  match_keys?: string[];
  mapping?: Record<string, string>;
  api_key_header?: string;
};

type SupplementalFeedRows = {
  config: SupplementalFeedConfig;
  rows: any[];
};

type SupplementalDiagnostics = {
  supplemental_feeds_configured: number;
  supplemental_feeds_attempted: number;
  supplemental_rows_found: number;
  supplemental_matches_found: number;
  supplemental_fields_merged: Record<string, number>;
  feeds: Array<{
    name: string;
    attempted: boolean;
    success: boolean;
    rows_found: number;
    matches_found: number;
    mapped_fields_configured: string[];
    mapped_fields_found: Record<string, number>;
    mapped_fields_merged: Record<string, number>;
    mapped_fields_skipped: Record<string, number>;
    unmatched_supplemental_rows: number;
    unmapped_available_keys: string[];
    skipped?: boolean;
    skipped_reason?: string;
    missing_macros?: string[];
    unknown_macros?: string[];
    error?: string;
  }>;
};

type TemplateRenderResult<T = any> = {
  value: T;
  missingMacros: string[];
  unknownMacros: string[];
};

type SupplementalFetchResult = {
  feeds: SupplementalFeedRows[];
  diagnostics: SupplementalDiagnostics;
};

const SUPPLEMENTAL_FIELDS = [
  "fuel_level",
  "odometer",
  "mileage",
  "engine_hours",
  "driver_name",
  "battery_voltage",
  "temperature",
];

const PERSISTED_SUPPLEMENTAL_FIELDS = new Set(["fuel_level"]);
const MAX_UNMAPPED_AVAILABLE_KEYS = 50;

const DEFAULT_SUPPLEMENTAL_MATCH_KEYS = [
  "reg_no",
  "registration",
  "truck_id",
  "vehicle",
  "plate",
  "unit_id",
  "imei",
  "device_id",
];

const SUPPORTED_TEMPLATE_MACROS = new Set([
  "username",
  "api_key",
  "password",
  "bearer_token",
  "token",
  "now_iso",
  "now_minus_1h_iso",
  "now_minus_24h_iso",
  "now_minus_7d_iso",
  "now_plus_1h_iso",
  "auth_user_id",
  "provider_user_id",
  "analytics_user_id",
]);

const AUTH_METADATA_PATHS: Record<keyof AuthMetadata, string[]> = {
  auth_user_id: [
    "auth_user_id",
    "user_id",
    "userId",
    "user.id",
    "data.user_id",
    "data.userId",
    "data.user.id",
    "result.user_id",
    "result.userId",
    "data.selectUsersByUsernamePassword.0.user_id",
    "data.selectUsersByUsernamePassword.0.userId",
    "data.selectUsersByUsernamePassword.0.id",
    "result.selectUsersByUsernamePassword.0.user_id",
    "result.selectUsersByUsernamePassword.0.userId",
    "result.selectUsersByUsernamePassword.0.id",
    "selectUsersByUsernamePassword.0.user_id",
    "selectUsersByUsernamePassword.0.userId",
    "selectUsersByUsernamePassword.0.id",
  ],
  provider_user_id: [
    "provider_user_id",
    "user_id",
    "userId",
    "user.id",
    "data.user_id",
    "data.userId",
    "result.user_id",
    "result.userId",
    "data.selectUsersByUsernamePassword.0.user_id",
    "data.selectUsersByUsernamePassword.0.userId",
    "data.selectUsersByUsernamePassword.0.id",
    "result.selectUsersByUsernamePassword.0.user_id",
    "result.selectUsersByUsernamePassword.0.userId",
    "result.selectUsersByUsernamePassword.0.id",
    "selectUsersByUsernamePassword.0.user_id",
    "selectUsersByUsernamePassword.0.userId",
  ],
  analytics_user_id: [
    "analytics_user_id",
    "analyticsUserId",
    "user_id",
    "userId",
    "data.user_id",
    "data.userId",
    "result.user_id",
    "result.userId",
    "data.selectUsersByUsernamePassword.0.user_id",
    "data.selectUsersByUsernamePassword.0.userId",
    "data.selectUsersByUsernamePassword.0.id",
    "result.selectUsersByUsernamePassword.0.user_id",
    "result.selectUsersByUsernamePassword.0.userId",
    "result.selectUsersByUsernamePassword.0.id",
    "selectUsersByUsernamePassword.0.user_id",
    "selectUsersByUsernamePassword.0.userId",
  ],
};

export async function runProviderSync(
  provider: ProviderRecord
): Promise<SyncResult> {
  // ✅ MUST have company_id – no hardcoding in code
  if (!provider.company_id) {
    return {
      success: false,
      message: "Provider has no company_id – cannot sync",
      vehicleCount: 0,
    };
  }

  try {
    const auth = await authenticateProvider(provider);
    if (!auth.success) {
      return {
        success: false,
        message: auth.message || "Provider authentication failed",
        vehicleCount: 0,
        debug: auth.debug || null,
      };
    }

    const authMetadata = auth.metadata || {};
    const fleet = await fetchFleet(provider, auth.token || null, authMetadata);
    if (!fleet.success) {
      return {
        success: false,
        message: fleet.message || "Fleet fetch failed",
        vehicleCount: 0,
        debug: fleet.debug || null,
      };
    }

    const supplemental = await fetchSupplementalFeeds(
      provider,
      auth.token || null,
      authMetadata
    );
    let sample_normalized = null;
    let syncedCount = 0;
    const errors: string[] = [];

    for (const rawVehicle of fleet.vehicles) {
      try {
        const normalized = normalizeVehicle(
          rawVehicle,
          provider.field_mapping || {},
          provider.provider_name
        );

        mergeSupplementalData(
          normalized,
          rawVehicle,
          provider.field_mapping || {},
          supplemental.feeds,
          supplemental.diagnostics
        );

        if (!sample_normalized) sample_normalized = normalized;

        const { data: existingAsset, error: existingAssetError } = await supabaseAdmin
          .from("fleet_assets")
          .select("id")
          .eq("provider_id", provider.id)
          .eq("truck_id", normalized.truck_id)
          .maybeSingle();

        if (existingAssetError) {
          throw new Error(`Asset registry lookup failed: ${existingAssetError.message}`);
        }

        const assetPayload: Record<string, any> = {
          provider_id: provider.id,
          provider_name: provider.provider_name,
          company_id: provider.company_id,
          truck_id: normalized.truck_id,
          registration: normalized.truck_id,
          status: "active",                              // 🔥 needed for dashboard filtering
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          last_seen_at: normalized.recorded_at,
          raw_payload: normalized.raw,
          updated_at: new Date().toISOString(),
        };

        if (!existingAsset) {
          assetPayload.asset_category = "unknown";
          assetPayload.billing_status = "unreviewed";
          assetPayload.intelligence_enabled = false;
          assetPayload.first_seen_at = new Date().toISOString();
        }

        if (normalized.location_label) {
          assetPayload.provider_location_label = normalized.location_label;
        }

        // ✅ Upsert telemetry fields only; reviewed billing/classification fields are not overwritten.
        const { error: assetError } = await supabaseAdmin
          .from("fleet_assets")
          .upsert(
            assetPayload,
            { onConflict: "provider_id,truck_id" }
          );

        if (assetError) throw new Error(`Asset registry write failed: ${assetError.message}`);

        // ✅ Insert into telemetry_logs with company_id
        const { error: telemetryError } = await supabaseAdmin
          .from("telemetry_logs")
          .insert({
            provider_id: provider.id,
            company_id: provider.company_id,
            truck_id: normalized.truck_id,
            latitude: normalized.latitude,
            longitude: normalized.longitude,
            speed: normalized.speed,
            fuel_level: normalized.fuel_level,
            provider_location_label: normalized.location_label || null,
            recorded_at: normalized.recorded_at,
            raw_payload: normalized.raw,
            validation: normalized.validation,
          });

        if (telemetryError) throw new Error(`Telemetry log write failed: ${telemetryError.message}`);

        syncedCount++;
      } catch (err: any) {
        errors.push(err.message || "Unknown vehicle sync error");
      }
    }

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? `Synced ${syncedCount} vehicles.`
          : `Synced ${syncedCount}/${fleet.vehicles.length} vehicles with ${errors.length} errors.`,
      vehicleCount: syncedCount,
      sample_normalized,
      supplemental_diagnostics: supplemental.diagnostics,
      debug: {
        errors,
        fleet_debug: fleet.debug || null,
        supplemental_diagnostics: supplemental.diagnostics,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "Unknown provider sync error",
      vehicleCount: 0,
      debug: err,
    };
  }
}

/* -------------------------------
   Authentication & Fleet Helpers
   (keep exactly as in your original)
-------------------------------- */
async function authenticateProvider(provider: ProviderRecord): Promise<AuthResult> {
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.auth_config || {};

  if (authType === "NONE") {
    return { success: true, token: null, metadata: buildAuthMetadata(provider) };
  }
  if (authType === "BEARER") {
    const token = provider.bearer_token || provider.api_key;
    if (!token) return { success: false, message: "Bearer token missing" };
    return { success: true, token, metadata: buildAuthMetadata(provider) };
  }
  if (authType === "API_KEY") {
    if (!provider.api_key) return { success: false, message: "API key missing" };
    return {
      success: true,
      token: provider.api_key,
      metadata: buildAuthMetadata(provider),
    };
  }
  if (authType === "BASIC_AUTH") {
    if (!provider.username || !(provider.password || provider.api_key)) {
      return { success: false, message: "Basic auth credentials missing" };
    }
    const raw = `${provider.username}:${provider.password || provider.api_key}`;
    const token = Buffer.from(raw).toString("base64");
    return { success: true, token, metadata: buildAuthMetadata(provider) };
  }
  if (authType === "POST_LOGIN") {
    const loginUrl = provider.login_url || provider.auth_config?.login_url || provider.default_login_url;
    if (!loginUrl) return { success: false, message: "Login URL missing" };
    const method = String(config.method || "POST").toUpperCase();
    const payloadTemplate = config.payload && typeof config.payload === "object"
      ? config.payload
      : { user_name: "{{username}}", key: "{{api_key}}" };
    const payload = buildPayload(payloadTemplate, provider);
    const headers = buildHeaders(config.headers || {}, provider, null);
    const response = await fetch(loginUrl, {
      method,
      headers: withJsonContentType(headers),
      body: method === "GET" ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
    const data = await safeJson(response);
    const tokenPaths = Array.isArray(config.token_paths) && config.token_paths.length > 0
      ? config.token_paths
      : defaultTokenPaths();
    const token = getByPaths(data, tokenPaths);
    const metadata = buildAuthMetadata(provider, data);
    if (!response.ok || !token) {
      return {
        success: false,
        message: "No token returned",
        debug: {
          status: response.status,
          loginUrl,
          payload_sent: maskPayload(payload),
          token_paths_checked: tokenPaths,
          auth_response_keys: collectSafeResponseKeys(data),
        },
      };
    }
    return {
      success: true,
      token,
      metadata,
      debug: {
        auth_metadata_available: Object.keys(metadata),
        auth_response_keys: collectSafeResponseKeys(data),
      },
    };
  }
  return { success: false, message: `Unsupported auth_type: ${authType}` };
}

async function fetchFleet(
  provider: ProviderRecord,
  token: string | null,
  authMetadata: AuthMetadata = {}
): Promise<FleetResult> {
  const fleetUrl = provider.fleet_url || provider.fleet_config?.fleet_url || provider.default_fleet_url;
  if (!fleetUrl) return { success: false, vehicles: [], message: "Fleet URL missing" };
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.fleet_config || {};
  const method = String(config.method || "POST").toUpperCase();
  const headers = buildHeaders(config.headers || {}, provider, token, authMetadata);
  if (token) {
    if (authType === "API_KEY") headers[config.api_key_header || "x-api-key"] = token;
    else if (authType === "BASIC_AUTH") headers.Authorization = `Basic ${token}`;
    else headers.Authorization = `Bearer ${token}`;
  }
  const payload = buildPayload(config.payload || {}, provider, token, authMetadata);
  const response = await fetch(fleetUrl, {
    method,
    headers: withJsonContentType(headers),
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await safeJson(response);
  if (!response.ok) {
    return {
      success: false,
      vehicles: [],
      message: `Fleet API returned HTTP ${response.status}`,
      debug: { status: response.status, fleetUrl, fleet_response: data },
    };
  }
  const vehiclePaths = Array.isArray(config.vehicle_paths) && config.vehicle_paths.length > 0
    ? config.vehicle_paths
    : defaultVehiclePaths();
  const vehicles = getByPaths(data, vehiclePaths);
  return {
    success: true,
    vehicles: Array.isArray(vehicles) ? vehicles : [],
    debug: { fleetUrl, vehicle_paths_checked: vehiclePaths, fleet_response: data },
  };
}

async function fetchSupplementalFeeds(
  provider: ProviderRecord,
  token: string | null,
  authMetadata: AuthMetadata = {}
): Promise<SupplementalFetchResult> {
  const configs = getSupplementalFeedConfigs(provider);
  const diagnostics = createSupplementalDiagnostics(configs);

  if (configs.length === 0) {
    return { feeds: [], diagnostics };
  }

  const feeds: SupplementalFeedRows[] = [];

  for (const config of configs) {
    const feedDiagnostics = diagnostics.feeds.find(
      (feed) => feed.name === config.name
    );

    const payloadResult = buildPayloadWithDiagnostics(
      config.payload || {},
      provider,
      token,
      authMetadata
    );

    if (
      payloadResult.missingMacros.length > 0 ||
      payloadResult.unknownMacros.length > 0
    ) {
      const skippedReason =
        payloadResult.unknownMacros.length > 0
          ? `Unknown template macro(s): ${payloadResult.unknownMacros.join(", ")}`
          : `Missing required template macro(s): ${payloadResult.missingMacros.join(", ")}`;

      if (feedDiagnostics) {
        feedDiagnostics.skipped = true;
        feedDiagnostics.skipped_reason = skippedReason;
        feedDiagnostics.success = false;
        feedDiagnostics.error = skippedReason;
        feedDiagnostics.missing_macros = payloadResult.missingMacros;
        feedDiagnostics.unknown_macros = payloadResult.unknownMacros;
      }
      continue;
    }

    if (feedDiagnostics) feedDiagnostics.attempted = true;
    diagnostics.supplemental_feeds_attempted++;

    try {
      const rows = await fetchSupplementalFeed(
        provider,
        token,
        config,
        payloadResult.value,
        authMetadata
      );
      feeds.push({ config, rows });
      diagnostics.supplemental_rows_found += rows.length;

      if (feedDiagnostics) {
        feedDiagnostics.success = true;
        feedDiagnostics.rows_found = rows.length;
        feedDiagnostics.unmatched_supplemental_rows = rows.length;
        feedDiagnostics.mapped_fields_found = countMappedFieldsFound(
          rows,
          config.mapping || {}
        );
        feedDiagnostics.unmapped_available_keys = collectUnmappedAvailableKeys(
          rows,
          config
        );
      }
    } catch (err: any) {
      if (feedDiagnostics) {
        feedDiagnostics.success = false;
        feedDiagnostics.error = err.message || "Supplemental feed failed";
      }
    }
  }

  return { feeds, diagnostics };
}

async function fetchSupplementalFeed(
  provider: ProviderRecord,
  token: string | null,
  config: SupplementalFeedConfig,
  payload: any,
  authMetadata: AuthMetadata = {}
) {
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const method = String(config.method || "GET").toUpperCase();
  const headers = buildHeaders(
    config.headers || {},
    provider,
    token,
    authMetadata
  );

  if (token) {
    if (authType === "API_KEY") {
      headers[config.api_key_header || provider.fleet_config?.api_key_header || "x-api-key"] = token;
    } else if (authType === "BASIC_AUTH") {
      headers.Authorization = `Basic ${token}`;
    } else {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(config.url, {
    method,
    headers: withJsonContentType(headers),
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(`Supplemental feed ${config.name} returned HTTP ${response.status}`);
  }

  const paths =
    Array.isArray(config.vehicle_paths) && config.vehicle_paths.length > 0
      ? config.vehicle_paths
      : defaultSupplementalVehiclePaths();

  return getRowsByPaths(data, paths);
}

function getSupplementalFeedConfigs(provider: ProviderRecord): SupplementalFeedConfig[] {
  const config = provider.fleet_config || {};
  const feeds: SupplementalFeedConfig[] = [];

  if (Array.isArray(config.supplemental_feeds)) {
    for (const feed of config.supplemental_feeds) {
      const normalized = normalizeSupplementalFeedConfig(feed);
      if (normalized) feeds.push(normalized);
    }
  }

  const currentStatusUrl = config.current_status_url;
  if (currentStatusUrl) {
    feeds.push({
      name: "current_status",
      url: currentStatusUrl,
      method: config.current_status_method || config.method || "GET",
      headers: config.current_status_headers || config.headers || {},
      payload: config.current_status_payload || {},
      vehicle_paths: config.current_status_vehicle_paths,
      match_keys: config.current_status_match_keys,
      mapping: config.current_status_mapping || {},
      api_key_header: config.current_status_api_key_header,
    });
  }

  const fuelStatusUrl = config.fuel_status_url;
  if (fuelStatusUrl) {
    feeds.push({
      name: "fuel_status",
      url: fuelStatusUrl,
      method: config.fuel_status_method || config.method || "GET",
      headers: config.fuel_status_headers || config.headers || {},
      payload: config.fuel_status_payload || {},
      vehicle_paths: config.fuel_status_vehicle_paths,
      match_keys: config.fuel_status_match_keys,
      mapping: config.fuel_status_mapping || config.current_status_mapping || {},
      api_key_header: config.fuel_status_api_key_header,
    });
  }

  return dedupeSupplementalFeeds(feeds);
}

function normalizeSupplementalFeedConfig(feed: any): SupplementalFeedConfig | null {
  if (!feed || typeof feed !== "object" || !feed.url) return null;

  return {
    name: String(feed.name || "supplemental").trim() || "supplemental",
    url: String(feed.url),
    method: feed.method || "GET",
    headers: feed.headers || {},
    payload: feed.payload || {},
    vehicle_paths: Array.isArray(feed.vehicle_paths) ? feed.vehicle_paths : undefined,
    match_keys: Array.isArray(feed.match_keys) ? feed.match_keys : undefined,
    mapping: feed.mapping || {},
    api_key_header: feed.api_key_header,
  };
}

function dedupeSupplementalFeeds(feeds: SupplementalFeedConfig[]) {
  const seen = new Set<string>();
  return feeds.filter((feed) => {
    const key = `${feed.name}:${feed.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createSupplementalDiagnostics(
  feeds: SupplementalFeedConfig[]
): SupplementalDiagnostics {
  return {
    supplemental_feeds_configured: feeds.length,
    supplemental_feeds_attempted: 0,
    supplemental_rows_found: 0,
    supplemental_matches_found: 0,
    supplemental_fields_merged: {},
    feeds: feeds.map((feed) => ({
      name: feed.name,
      attempted: false,
      success: false,
      rows_found: 0,
      matches_found: 0,
      mapped_fields_configured: getConfiguredMappedFields(feed.mapping || {}),
      mapped_fields_found: {},
      mapped_fields_merged: {},
      mapped_fields_skipped: {},
      unmatched_supplemental_rows: 0,
      unmapped_available_keys: [],
    })),
  };
}

function getConfiguredMappedFields(mapping: Record<string, string>) {
  return Array.from(
    new Set(
      Object.keys(mapping || {})
        .map((field) => String(field || "").trim())
        .filter(Boolean)
    )
  );
}

function countMappedFieldsFound(rows: any[], mapping: Record<string, string>) {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const fields = extractSupplementalFields(row, mapping);
    for (const field of Object.keys(fields)) {
      counts[field] = (counts[field] || 0) + 1;
    }
  }

  return counts;
}

function collectUnmappedAvailableKeys(
  rows: any[],
  config: SupplementalFeedConfig
) {
  const excludedKeys = buildMappedKeyExclusionSet(config);
  const availableKeys = new Map<string, string>();

  for (const row of rows.slice(0, 20)) {
    collectSafeKeyNames(row, availableKeys, 0);
    if (availableKeys.size >= MAX_UNMAPPED_AVAILABLE_KEYS * 2) break;
  }

  return Array.from(availableKeys.entries())
    .filter(([normalizedKey]) => !excludedKeys.has(normalizedKey))
    .map(([, key]) => key)
    .slice(0, MAX_UNMAPPED_AVAILABLE_KEYS);
}

function buildMappedKeyExclusionSet(config: SupplementalFeedConfig) {
  const keys = new Set<string>();
  const mapping = config.mapping || {};

  for (const field of SUPPLEMENTAL_FIELDS) {
    addNormalizedKey(keys, field);
    for (const fallbackKey of getFieldFallbackKeys(field)) {
      addNormalizedKey(keys, fallbackKey);
    }
  }

  for (const key of DEFAULT_SUPPLEMENTAL_MATCH_KEYS) {
    addNormalizedKey(keys, key);
  }

  for (const key of config.match_keys || []) {
    addNormalizedKey(keys, key);
  }

  for (const field of Object.keys(mapping)) {
    addNormalizedKey(keys, field);
    for (const segment of String(mapping[field] || "").split(".")) {
      addNormalizedKey(keys, segment);
    }
  }

  return keys;
}

function collectSafeKeyNames(
  value: any,
  output: Map<string, string>,
  depth: number
) {
  if (!value || typeof value !== "object" || depth > 4) return;

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 10)) {
      collectSafeKeyNames(item, output, depth + 1);
    }
    return;
  }

  for (const key of Object.keys(value)) {
    const normalized = normalizeProviderKey(key);
    if (!normalized || isSensitiveProviderKey(normalized)) continue;
    if (!output.has(normalized)) output.set(normalized, key);
    collectSafeKeyNames(value[key], output, depth + 1);
  }
}

function isSensitiveProviderKey(normalizedKey: string) {
  return [
    "password",
    "pass",
    "secret",
    "apikey",
    "api",
    "token",
    "bearertoken",
    "authorization",
    "auth",
    "cookie",
    "session",
    "jwt",
  ].some((fragment) => normalizedKey.includes(fragment));
}

function addNormalizedKey(keys: Set<string>, key: string) {
  const normalized = normalizeProviderKey(key);
  if (normalized) keys.add(normalized);
}

function incrementFieldCount(
  target: Record<string, number> | undefined,
  field: string
) {
  if (!target) return;
  target[field] = (target[field] || 0) + 1;
}

function mergeSupplementalData(
  normalized: any,
  rawVehicle: any,
  primaryMapping: any,
  feeds: SupplementalFeedRows[],
  diagnostics: SupplementalDiagnostics
) {
  if (!feeds.length) return;

  const primaryKeys = getPrimaryVehicleMatchKeys(
    rawVehicle,
    normalized.truck_id,
    primaryMapping
  );

  for (const feed of feeds) {
    const match = findSupplementalMatch(primaryKeys, feed);
    if (!match) continue;

    diagnostics.supplemental_matches_found++;
    const feedDiagnostics = diagnostics.feeds.find(
      (item) => item.name === feed.config.name
    );
    if (feedDiagnostics) {
      feedDiagnostics.matches_found++;
      feedDiagnostics.unmatched_supplemental_rows = Math.max(
        feedDiagnostics.rows_found - feedDiagnostics.matches_found,
        0
      );
    }

    const enrichment = extractSupplementalFields(match, feed.config.mapping || {});
    const mergedFields: string[] = [];

    for (const field of SUPPLEMENTAL_FIELDS) {
      const value = enrichment[field];
      if (!isMeaningfulSupplementalValue(field, value)) continue;

      if (!PERSISTED_SUPPLEMENTAL_FIELDS.has(field)) {
        incrementFieldCount(feedDiagnostics?.mapped_fields_skipped, field);
        continue;
      }

      if (field === "fuel_level") {
        if (!isMeaningfulSupplementalValue(field, normalized.fuel_level)) {
          normalized.fuel_level = value;
          mergedFields.push(field);
        } else {
          incrementFieldCount(feedDiagnostics?.mapped_fields_skipped, field);
        }
        continue;
      }

      if (!isMeaningfulSupplementalValue(field, normalized[field])) {
        normalized[field] = value;
        mergedFields.push(field);
      }
    }

    if (mergedFields.length > 0) {
      normalized.supplemental_enrichment = {
        ...(normalized.supplemental_enrichment || {}),
        [feed.config.name]: pickFields(enrichment, mergedFields),
      };

      for (const field of mergedFields) {
        diagnostics.supplemental_fields_merged[field] =
          (diagnostics.supplemental_fields_merged[field] || 0) + 1;
        incrementFieldCount(feedDiagnostics?.mapped_fields_merged, field);
      }
    }
  }
}

function findSupplementalMatch(
  primaryKeys: Set<string>,
  feed: SupplementalFeedRows
) {
  for (const row of feed.rows) {
    const rowKeys = getSupplementalRowMatchKeys(row, feed.config);
    for (const key of Array.from(rowKeys)) {
      if (primaryKeys.has(key)) return row;
    }
  }

  return null;
}

function getPrimaryVehicleMatchKeys(
  rawVehicle: any,
  normalizedTruckId: string | null | undefined,
  primaryMapping: any
) {
  const keys = new Set<string>();
  addMatchKey(keys, normalizedTruckId);

  if (primaryMapping?.truck) {
    addMatchKey(keys, getValueByCaseInsensitivePath(rawVehicle, primaryMapping.truck));
  }

  for (const key of DEFAULT_SUPPLEMENTAL_MATCH_KEYS) {
    addMatchKey(keys, getValueByCaseInsensitivePath(rawVehicle, key));
  }

  return keys;
}

function getSupplementalRowMatchKeys(row: any, config: SupplementalFeedConfig) {
  const keys = new Set<string>();
  const matchKeys =
    Array.isArray(config.match_keys) && config.match_keys.length > 0
      ? [...config.match_keys, ...DEFAULT_SUPPLEMENTAL_MATCH_KEYS]
      : DEFAULT_SUPPLEMENTAL_MATCH_KEYS;

  for (const key of matchKeys) {
    addMatchKey(keys, getValueByCaseInsensitivePath(row, key));
  }

  return keys;
}

function extractSupplementalFields(row: any, mapping: Record<string, string>) {
  const output: Record<string, any> = {};

  for (const field of SUPPLEMENTAL_FIELDS) {
    const value = getSupplementalFieldValue(row, field, mapping);
    if (value === null || value === undefined || value === "") continue;

    if (field === "driver_name") {
      const driverName = String(value).trim();
      if (driverName) output[field] = driverName.slice(0, 120);
      continue;
    }

    const parsed = parseProviderNumber(value);
    if (parsed === null) continue;

    if (isSaneSupplementalNumber(field, parsed)) {
      output[field] = parsed;
    }
  }

  return output;
}

function getSupplementalFieldValue(
  row: any,
  field: string,
  mapping: Record<string, string>
) {
  const configuredPath = mapping[field] || getFieldAliasMapping(field, mapping);
  if (configuredPath) {
    const configuredValue = getValueByCaseInsensitivePath(row, configuredPath);
    if (
      configuredValue !== undefined &&
      configuredValue !== null &&
      configuredValue !== ""
    ) {
      return configuredValue;
    }
  }

  for (const fallbackKey of getFieldFallbackKeys(field)) {
    const value = getValueByCaseInsensitivePath(row, fallbackKey);
    if (value !== undefined && value !== null && value !== "") return value;
  }

  return null;
}

function getFieldAliasMapping(field: string, mapping: Record<string, string>) {
  if (field === "odometer") return mapping.mileage;
  if (field === "mileage") return mapping.odometer;
  return null;
}

function getFieldFallbackKeys(field: string) {
  if (field === "fuel_level") {
    return [
      "current_fuel",
      "currentFuel",
      "current fuel",
      "Current Fuel",
      "CURRENT FUEL",
      "fuel",
      "fuel_level",
      "fuelLevel",
      "fuel_liters",
      "fuelLiters",
      "litres",
      "liters",
      "tank_level",
      "tankLevel",
      "fuel_value",
      "fuelValue",
    ];
  }

  if (field === "odometer" || field === "mileage") {
    return ["odometer", "mileage", "km", "kilometers", "distance"];
  }

  if (field === "engine_hours") {
    return ["engine_hours", "engineHours", "engine hours", "hours"];
  }

  if (field === "driver_name") {
    return ["driver_name", "driverName", "driver", "Driver"];
  }

  if (field === "battery_voltage") {
    return ["battery_voltage", "batteryVoltage", "battery voltage", "voltage"];
  }

  if (field === "temperature") {
    return ["temperature", "temp", "Temperature"];
  }

  return [field];
}

function isMeaningfulSupplementalValue(field: string, value: any) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (field === "temperature") return true;
    return value > 0;
  }
  return String(value).trim().length > 0;
}

function isSaneSupplementalNumber(field: string, value: number) {
  if (!Number.isFinite(value)) return false;

  if (field === "fuel_level") return value >= 0 && value <= 5000;
  if (field === "odometer" || field === "mileage") {
    return value >= 0 && value <= 10000000;
  }
  if (field === "engine_hours") return value >= 0 && value <= 1000000;
  if (field === "battery_voltage") return value >= 0 && value <= 1000;
  if (field === "temperature") return value >= -100 && value <= 1000;

  return true;
}

function parseProviderNumber(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const match = value.trim().replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function addMatchKey(keys: Set<string>, value: any) {
  const normalized = normalizeMatchValue(value);
  if (normalized) keys.add(normalized);
}

function normalizeMatchValue(value: any) {
  if (value === undefined || value === null || value === "") return "";
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeRows(value: any): any[] {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (!value || typeof value !== "object") return [];

  for (const key of ["data", "result", "vehicles", "items", "rows"]) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      return nested.filter((item) => item && typeof item === "object");
    }
  }

  return [];
}

function getRowsByPaths(data: any, paths: string[]) {
  for (const path of paths) {
    const rows = normalizeRows(getByPath(data, path));
    if (rows.length > 0) return rows;
  }

  return [];
}

function getValueByCaseInsensitivePath(raw: any, path?: string): any {
  if (!raw || !path) return null;

  return path.split(".").reduce((current: any, segment: string) => {
    if (current === undefined || current === null) return null;

    if (
      typeof current === "object" &&
      !Array.isArray(current) &&
      segment in current
    ) {
      return current[segment];
    }

    if (typeof current !== "object" || Array.isArray(current)) return null;

    const target = normalizeProviderKey(segment);
    const match = Object.keys(current).find(
      (key) => normalizeProviderKey(key) === target
    );

    return match ? current[match] : null;
  }, raw);
}

function normalizeProviderKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickFields(source: Record<string, any>, fields: string[]) {
  return fields.reduce((output: Record<string, any>, field) => {
    output[field] = source[field];
    return output;
  }, {});
}

function defaultSupplementalVehiclePaths() {
  return [
    "$",
    "data",
    "result",
    "vehicles",
    "items",
    "rows",
    "data.vehicles",
    "data.items",
    "data.rows",
    "result.vehicles",
    "result.items",
    "result.rows",
  ];
}

function buildPayload(
  template: any,
  provider: ProviderRecord,
  token: string | null = null,
  authMetadata: AuthMetadata = {}
) {
  return buildPayloadWithDiagnostics(template, provider, token, authMetadata)
    .value;
}

function buildPayloadWithDiagnostics(
  template: any,
  provider: ProviderRecord,
  token: string | null = null,
  authMetadata: AuthMetadata = {}
): TemplateRenderResult {
  return renderTemplateValue(template || {}, {
    provider,
    token,
    authMetadata,
    now: new Date(),
  });
}

function buildHeaders(
  template: any,
  provider: ProviderRecord,
  token: string | null,
  authMetadata: AuthMetadata = {}
) {
  const output: Record<string, string> = {};
  const rendered = renderTemplateValue(template || {}, {
    provider,
    token,
    authMetadata,
    now: new Date(),
  });

  if (
    !rendered.value ||
    typeof rendered.value !== "object" ||
    Array.isArray(rendered.value)
  ) {
    return output;
  }

  for (const [key, value] of Object.entries(rendered.value)) {
    if (value === undefined || value === null) continue;
    output[key] = String(value);
  }

  return output;
}

function renderTemplateValue(
  template: any,
  context: {
    provider: ProviderRecord;
    token: string | null;
    authMetadata: AuthMetadata;
    now: Date;
  }
): TemplateRenderResult {
  const missingMacros = new Set<string>();
  const unknownMacros = new Set<string>();

  const render = (value: any): any => {
    if (typeof value === "string") {
      return renderTemplateString(value, context, missingMacros, unknownMacros);
    }

    if (Array.isArray(value)) {
      return value.map((item) => render(item));
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, render(nested)])
      );
    }

    return value;
  };

  return {
    value: render(template),
    missingMacros: Array.from(missingMacros),
    unknownMacros: Array.from(unknownMacros),
  };
}

function renderTemplateString(
  value: string,
  context: {
    provider: ProviderRecord;
    token: string | null;
    authMetadata: AuthMetadata;
    now: Date;
  },
  missingMacros: Set<string>,
  unknownMacros: Set<string>
) {
  const wholeMacro = value.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);
  if (wholeMacro) {
    const resolved = resolveTemplateMacro(
      wholeMacro[1],
      context,
      missingMacros,
      unknownMacros
    );
    return resolved === undefined || resolved === null ? "" : resolved;
  }

  return value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, macro) => {
    const resolved = resolveTemplateMacro(
      macro,
      context,
      missingMacros,
      unknownMacros
    );
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function resolveTemplateMacro(
  macro: string,
  context: {
    provider: ProviderRecord;
    token: string | null;
    authMetadata: AuthMetadata;
    now: Date;
  },
  missingMacros: Set<string>,
  unknownMacros: Set<string>
) {
  const normalizedMacro = String(macro || "").trim();

  if (!SUPPORTED_TEMPLATE_MACROS.has(normalizedMacro)) {
    unknownMacros.add(normalizedMacro || "(empty)");
    return "";
  }

  const value = getTemplateMacroValue(normalizedMacro, context);
  if (value === undefined || value === null || value === "") {
    missingMacros.add(normalizedMacro);
    return "";
  }

  return value;
}

function getTemplateMacroValue(
  macro: string,
  context: {
    provider: ProviderRecord;
    token: string | null;
    authMetadata: AuthMetadata;
    now: Date;
  }
) {
  const { provider, token, authMetadata, now } = context;

  if (macro === "username") return provider.username || "";
  if (macro === "api_key") return provider.api_key || "";
  if (macro === "password") return provider.password || "";
  if (macro === "bearer_token") return provider.bearer_token || "";
  if (macro === "token") return token || "";

  const dateValue = getDateMacroValue(macro, now);
  if (dateValue) return dateValue;

  if (
    macro === "auth_user_id" ||
    macro === "provider_user_id" ||
    macro === "analytics_user_id"
  ) {
    return getAuthMacroValue(macro, provider, authMetadata);
  }

  return "";
}

function getDateMacroValue(macro: string, now: Date) {
  const date = new Date(now);

  if (macro === "now_iso") return date.toISOString();
  if (macro === "now_minus_1h_iso") {
    date.setHours(date.getHours() - 1);
    return date.toISOString();
  }
  if (macro === "now_minus_24h_iso") {
    date.setHours(date.getHours() - 24);
    return date.toISOString();
  }
  if (macro === "now_minus_7d_iso") {
    date.setDate(date.getDate() - 7);
    return date.toISOString();
  }
  if (macro === "now_plus_1h_iso") {
    date.setHours(date.getHours() + 1);
    return date.toISOString();
  }

  return "";
}

function getAuthMacroValue(
  macro: keyof AuthMetadata,
  provider: ProviderRecord,
  authMetadata: AuthMetadata
) {
  const metadataPriority: Array<keyof AuthMetadata> =
    macro === "auth_user_id"
      ? ["auth_user_id", "provider_user_id", "analytics_user_id"]
      : macro === "provider_user_id"
        ? ["provider_user_id", "auth_user_id", "analytics_user_id"]
        : ["analytics_user_id", "auth_user_id", "provider_user_id"];

  for (const key of metadataPriority) {
    const value = sanitizeMacroScalar(authMetadata[key]);
    if (value !== null) return value;
  }

  return getConfiguredAuthMacroValue(provider, macro);
}

function getConfiguredAuthMacroValue(
  provider: ProviderRecord,
  macro: keyof AuthMetadata
) {
  const sources = [provider.fleet_config || {}, provider.auth_config || {}];
  const paths =
    macro === "analytics_user_id"
      ? [
          "analytics_user_id",
          "analyticsUserId",
          "auth_user_id",
          "authUserId",
          "provider_user_id",
          "providerUserId",
          "user_id",
          "userId",
          "user.id",
        ]
      : macro === "provider_user_id"
        ? [
            "provider_user_id",
            "providerUserId",
            "auth_user_id",
            "authUserId",
            "analytics_user_id",
            "analyticsUserId",
            "user_id",
            "userId",
            "user.id",
          ]
        : [
            "auth_user_id",
            "authUserId",
            "analytics_user_id",
            "analyticsUserId",
            "provider_user_id",
            "providerUserId",
            "user_id",
            "userId",
            "user.id",
          ];

  for (const source of sources) {
    const value = firstSafeValueByPaths(source, paths);
    if (value !== null) return value;
  }

  return "";
}

function buildAuthMetadata(
  provider: ProviderRecord,
  authResponse?: any
): AuthMetadata {
  const metadata: AuthMetadata = {};

  for (const key of Object.keys(AUTH_METADATA_PATHS) as Array<
    keyof AuthMetadata
  >) {
    const responseValue = firstSafeValueByPaths(
      authResponse,
      AUTH_METADATA_PATHS[key]
    );
    const configuredValue = getConfiguredAuthMacroValue(provider, key);
    const value = responseValue !== null ? responseValue : configuredValue;

    if (value !== null && value !== "") {
      metadata[key] = value;
    }
  }

  return metadata;
}

function firstSafeValueByPaths(source: any, paths: string[]) {
  if (!source || typeof source !== "object") return null;

  for (const path of paths) {
    const value = sanitizeMacroScalar(getByPath(source, path));
    if (value !== null) return value;
  }

  return null;
}

function sanitizeMacroScalar(value: any): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return null;
  return trimmed;
}

function collectSafeResponseKeys(data: any) {
  const keys = new Map<string, string>();
  collectSafeKeyNames(data, keys, 0);
  return Array.from(keys.values()).slice(0, MAX_UNMAPPED_AVAILABLE_KEYS);
}

function withJsonContentType(headers: Record<string, string>) {
  const output = { ...headers };
  const hasContentType = Object.keys(output).some(
    (key) => key.toLowerCase() === "content-type"
  );

  if (!hasContentType) output["Content-Type"] = "application/json";
  return output;
}

async function safeJson(response: Response) {
  try { return await response.json(); } catch { return { raw: "Non-JSON response", status: response.status, statusText: response.statusText }; }
}

function getByPaths(data: any, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(data, path);
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function getByPath(obj: any, path: string) {
  if (path === "$") return obj;
  return path.split(".").reduce((current, part) => current?.[part], obj);
}

function defaultTokenPaths() {
  return ["token", "access_token", "jwt", "bearer_token", "data.token", "data.access_token", "result.token", "result.access_token"];
}

function defaultVehiclePaths() {
  return ["$", "data", "result", "vehicles", "items", "data.vehicles", "data.items", "result.vehicles", "result.items"];
}

function maskPayload(payload: any, depth = 0): any {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(payload)) {
    return payload.map((item) => maskPayload(item, depth + 1));
  }
  if (!payload || typeof payload !== "object") return payload;

  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      const normalizedKey = normalizeProviderKey(key);
      if (isSensitiveProviderKey(normalizedKey) || normalizedKey === "key") {
        return [key, "***MASKED***"];
      }

      return [key, maskPayload(value, depth + 1)];
    })
  );
}
