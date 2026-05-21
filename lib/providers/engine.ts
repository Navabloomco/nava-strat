import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicle } from "./normalizeVehicle";
import {
  buildCapabilitySummary,
  buildProviderCapabilityProfile,
  isSignalSupported,
  resolveTelemetryCapability,
  telemetryCapabilityLabel,
  type ProviderCapabilityProfile,
} from "../telemetry/capabilities";
import {
  DISTANCE_SUMMARY_FIELDS,
  createDistanceDiagnostics,
  getDistanceFieldFallbackKeys,
  normalizeProviderTripSummary,
  type DistanceDiagnostics,
  type ProviderTripSummary,
} from "../telemetry/distance";

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
  provider_secret?: string | null;
  api_secret?: string | null;
  password: string | null;
  bearer_token: string | null;
  auth_config?: any;
  fleet_config?: any;
  field_mapping?: any;
  company_id?: string;        // ✅ multi‑tenant key
  capability_profile?: any;
  supported_signals?: any;
  provider_timezone?: string | null;
  source_signal_notes?: any;
};

export type SyncResult = {
  success: boolean;
  message: string;
  vehicleCount: number;
  skipped_missing_identifier?: number;
  sample_normalized?: any;
  supplemental_diagnostics?: SupplementalDiagnostics;
  capability_summary?: any;
  distance_diagnostics?: DistanceDiagnostics;
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

type SupplementalAuthProfileConfig = {
  name: string;
  type?: string;
  username_override?: string;
  login_url?: string;
  method?: string;
  headers?: Record<string, any>;
  payload?: Record<string, any>;
  token_paths?: string[];
  metadata_paths?: Partial<Record<keyof AuthMetadata, string>>;
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
  auth_profile?: string;
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
    http_status?: number;
    response_type?: string;
    top_level_keys?: string[];
    candidate_row_paths_checked?: string[];
    first_array_paths_found?: Record<string, number>;
    response_error_keys?: string[];
    rendered_request?: SupplementalRequestDiagnostics;
    auth_profile_used?: string;
    auth_profile_attempted?: boolean;
    auth_profile_token_captured?: boolean;
    auth_profile_metadata_available?: string[];
    auth_profile_credential_macros_available?: string[];
    auth_profile_username_override_configured?: boolean;
    auth_username_source?: string | null;
    auth_password_source?: string | null;
    auth_username_present?: boolean;
    auth_password_present?: boolean;
    auth_username_length?: number | null;
    auth_password_length?: number | null;
    auth_http_status?: number;
    auth_response_type?: string;
    auth_top_level_keys?: string[];
    auth_data_is_null?: boolean;
    auth_data_is_empty_object?: boolean;
    auth_data_keys?: string[];
    auth_data_array_paths_found?: Record<string, number>;
    auth_data_object_paths_found?: string[];
    auth_data_result_paths_found?: Record<string, string | number>;
    auth_error_keys?: string[];
    auth_operation_name_sent?: string | null;
    auth_payload_key_paths_sent?: string[];
    auth_variable_keys_sent?: string[];
    auth_variable_value_types?: Record<string, string>;
    auth_variable_value_lengths?: Record<string, number>;
    auth_token_paths_checked?: string[];
    auth_metadata_paths_checked?: string[];
    auth_token_candidate_paths_found?: string[];
    auth_profile_error?: string;
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

type SupplementalAuthContext = {
  token: string | null;
  metadata: AuthMetadata;
  fallbackMetadata: AuthMetadata;
  authType: string;
  profileName?: string | null;
};

type SupplementalResponseDiagnostics = {
  http_status: number;
  response_type: "array" | "object" | "null" | "text" | "html" | "error";
  top_level_keys: string[];
  candidate_row_paths_checked: string[];
  first_array_paths_found: Record<string, number>;
  response_error_keys: string[];
};

type SupplementalRequestDiagnostics = {
  method: string;
  url_host: string | null;
  url_path: string | null;
  content_type: string | null;
  payload_top_level_keys: string[];
  payload_key_paths: string[];
  payload_value_types: Record<string, string>;
  allowed_values: Record<string, string | number>;
};

type SupplementalAuthDiagnostics = {
  auth_http_status?: number;
  auth_response_type?: SupplementalResponseDiagnostics["response_type"];
  auth_top_level_keys?: string[];
  auth_data_is_null?: boolean;
  auth_data_is_empty_object?: boolean;
  auth_data_keys?: string[];
  auth_data_array_paths_found?: Record<string, number>;
  auth_data_object_paths_found?: string[];
  auth_data_result_paths_found?: Record<string, string | number>;
  auth_error_keys?: string[];
  auth_operation_name_sent?: string | null;
  auth_payload_key_paths_sent?: string[];
  auth_variable_keys_sent?: string[];
  auth_variable_value_types?: Record<string, string>;
  auth_variable_value_lengths?: Record<string, number>;
  auth_username_source?: string | null;
  auth_password_source?: string | null;
  auth_username_present?: boolean;
  auth_password_present?: boolean;
  auth_username_length?: number | null;
  auth_password_length?: number | null;
  auth_token_paths_checked?: string[];
  auth_metadata_paths_checked?: string[];
  auth_token_candidate_paths_found?: string[];
};

type TemplateCredentialOverrides = {
  username?: string | null;
};

const SUPPLEMENTAL_FIELDS = [
  "fuel_level",
  "odometer",
  "engine_hours",
  "engine_rpm",
  "engine_on",
  "ignition_on",
  "fuel_rate",
  "lifetime_fuel_used",
  "fuel_raw",
  "fuel_volume_liters",
  "driver_name",
  "battery_voltage",
  "temperature",
  ...DISTANCE_SUMMARY_FIELDS,
];

const PERSISTED_SUPPLEMENTAL_FIELDS = new Set([
  "fuel_level",
  "engine_hours",
  "engine_rpm",
  "engine_on",
  "ignition_on",
  "fuel_rate",
  "lifetime_fuel_used",
  "fuel_raw",
  "fuel_volume_liters",
]);
const MAX_UNMAPPED_AVAILABLE_KEYS = 50;
const MAX_DISTANCE_SUMMARY_ROWS = 500;

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
  "provider_secret",
  "api_secret",
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
    const providerCapabilityProfile = buildProviderCapabilityProfile(provider);
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
    let skippedMissingIdentifier = 0;
    let capabilityRowsProcessed = 0;
    const capabilityCounts: Record<string, number> = {};
    const placeholderZeroSignalCounts: Record<string, number> = {};
    const errors: string[] = [];

    for (const rawVehicle of fleet.vehicles) {
      try {
        const normalized = normalizeVehicle(
          rawVehicle,
          provider.field_mapping || {},
          provider.provider_name,
          providerCapabilityProfile
        );

        if (normalized.validation.missing_fields.includes("truck_id")) {
          skippedMissingIdentifier++;
          continue;
        }

        mergeSupplementalData(
          normalized,
          rawVehicle,
          provider.field_mapping || {},
          supplemental.feeds,
          supplemental.diagnostics,
          providerCapabilityProfile
        );
        refreshNormalizedCapability(normalized, providerCapabilityProfile);

        if (!sample_normalized) sample_normalized = normalized;
        capabilityRowsProcessed++;
        capabilityCounts[normalized.telemetry_capability] =
          (capabilityCounts[normalized.telemetry_capability] || 0) + 1;
        for (const signal of normalized.signal_quality?.placeholder_zero_signals || []) {
          placeholderZeroSignalCounts[signal] =
            (placeholderZeroSignalCounts[signal] || 0) + 1;
        }

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
          telemetry_capability: normalized.telemetry_capability,
          telemetry_capabilities: normalized.telemetry_capabilities,
          telemetry_capability_source: normalized.telemetry_capability_source,
          canbus_enabled:
            normalized.telemetry_capability === "CAN_BUS" ||
            normalized.telemetry_capability === "HYBRID_CAN_AND_FUEL_ROD",
          fuel_rod_installed:
            normalized.telemetry_capability === "FUEL_ROD" ||
            normalized.telemetry_capability === "HYBRID_CAN_AND_FUEL_ROD",
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
        const assetError = await upsertFleetAssetWithCapabilityFallback(assetPayload);

        if (assetError) throw new Error(`Asset registry write failed: ${assetError.message}`);

        // ✅ Insert into telemetry_logs with company_id
        const telemetryError = await insertTelemetryLogWithCapabilityFallback({
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
          engine_rpm: normalized.engine_rpm,
          engine_on: normalized.engine_on,
          ignition_on: normalized.ignition_on,
          fuel_rate: normalized.fuel_rate,
          lifetime_fuel_used: normalized.lifetime_fuel_used,
          engine_hours: normalized.engine_hours,
          fuel_raw: normalized.fuel_raw,
          fuel_volume_liters: normalized.fuel_volume_liters,
          telemetry_capability: normalized.telemetry_capability,
          signal_quality: normalized.signal_quality,
          provider_signal_flags: normalized.provider_signal_flags,
        });

        if (telemetryError) throw new Error(`Telemetry log write failed: ${telemetryError.message}`);

        syncedCount++;
      } catch (err: any) {
        errors.push(err.message || "Unknown vehicle sync error");
      }
    }

    const distanceDiagnostics = await processProviderTripSummaries(
      provider,
      supplemental.feeds,
      providerCapabilityProfile
    );

    return {
      success: errors.length === 0,
      message:
        buildSyncMessage(
          syncedCount,
          fleet.vehicles.length,
          errors.length,
          skippedMissingIdentifier
        ),
      vehicleCount: syncedCount,
      skipped_missing_identifier: skippedMissingIdentifier,
      sample_normalized,
      supplemental_diagnostics: supplemental.diagnostics,
      capability_summary: buildCapabilitySummary({
        rows_processed: capabilityRowsProcessed,
        capability_counts: capabilityCounts,
        placeholder_zero_signal_counts: placeholderZeroSignalCounts,
        providerProfile: providerCapabilityProfile,
      }),
      distance_diagnostics: distanceDiagnostics,
      debug: {
        errors,
        skipped_missing_identifier: skippedMissingIdentifier,
        fleet_debug: fleet.debug || null,
        supplemental_diagnostics: supplemental.diagnostics,
        capability_summary: buildCapabilitySummary({
          rows_processed: capabilityRowsProcessed,
          capability_counts: capabilityCounts,
          placeholder_zero_signal_counts: placeholderZeroSignalCounts,
          providerProfile: providerCapabilityProfile,
        }),
        distance_diagnostics: distanceDiagnostics,
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

function buildSyncMessage(
  syncedCount: number,
  totalRows: number,
  errorCount: number,
  skippedMissingIdentifier: number
) {
  const base =
    errorCount === 0
      ? `Synced ${syncedCount} vehicles.`
      : `Synced ${syncedCount}/${totalRows} vehicles with ${errorCount} errors.`;

  if (skippedMissingIdentifier === 0) return base;

  return `${base} Skipped ${skippedMissingIdentifier} provider row${
    skippedMissingIdentifier === 1 ? "" : "s"
  } missing a safe vehicle identifier.`;
}

function refreshNormalizedCapability(
  normalized: any,
  providerCapabilityProfile: ProviderCapabilityProfile
) {
  const observedSignals = {
    latitude: normalized.latitude !== null && normalized.latitude !== undefined,
    longitude: normalized.longitude !== null && normalized.longitude !== undefined,
    speed: normalized.speed !== null && normalized.speed !== undefined,
    fuel_level: normalized.fuel_level !== null && normalized.fuel_level !== undefined,
    engine_rpm: normalized.engine_rpm !== null && normalized.engine_rpm !== undefined,
    engine_on: normalized.engine_on !== null && normalized.engine_on !== undefined,
    ignition_on: normalized.ignition_on !== null && normalized.ignition_on !== undefined,
    fuel_rate: normalized.fuel_rate !== null && normalized.fuel_rate !== undefined,
    lifetime_fuel_used:
      normalized.lifetime_fuel_used !== null &&
      normalized.lifetime_fuel_used !== undefined,
    engine_hours:
      normalized.engine_hours !== null && normalized.engine_hours !== undefined,
    fuel_raw: normalized.fuel_raw !== null && normalized.fuel_raw !== undefined,
    fuel_volume_liters:
      normalized.fuel_volume_liters !== null &&
      normalized.fuel_volume_liters !== undefined,
  };
  const resolution = resolveTelemetryCapability({
    providerProfile: providerCapabilityProfile,
    observedSignals,
    hasGps: Boolean(observedSignals.latitude && observedSignals.longitude),
  });

  normalized.telemetry_capability = resolution.capability;
  normalized.telemetry_capability_source = resolution.source;
  normalized.telemetry_capabilities = {
    ...(normalized.telemetry_capabilities || {}),
    label: telemetryCapabilityLabel(resolution.capability),
    supported_signals: Object.keys(providerCapabilityProfile.supported_signals).filter(
      (signal) => providerCapabilityProfile.supported_signals[signal]
    ),
    meaningful_signals: Object.keys(observedSignals).filter(
      (signal) => (observedSignals as Record<string, boolean>)[signal]
    ),
  };
  normalized.signal_quality = {
    ...(normalized.signal_quality || {}),
    capability_label: telemetryCapabilityLabel(resolution.capability),
    capability_source: resolution.source,
    meaningful_signals: Object.keys(observedSignals).filter(
      (signal) => (observedSignals as Record<string, boolean>)[signal]
    ),
  };
  normalized.provider_signal_flags = {
    ...(normalized.provider_signal_flags || {}),
    provider_timezone: providerCapabilityProfile.provider_timezone,
    provider_supported_signals: Object.keys(providerCapabilityProfile.supported_signals).filter(
      (signal) => providerCapabilityProfile.supported_signals[signal]
    ),
  };
}

async function upsertFleetAssetWithCapabilityFallback(payload: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from("fleet_assets")
    .upsert(payload, { onConflict: "provider_id,truck_id" });

  if (!isMissingCapabilityColumnError(error)) return error;

  const { error: retryError } = await supabaseAdmin
    .from("fleet_assets")
    .upsert(stripCapabilityAssetColumns(payload), {
      onConflict: "provider_id,truck_id",
    });

  return retryError;
}

async function insertTelemetryLogWithCapabilityFallback(payload: Record<string, any>) {
  const { error } = await supabaseAdmin.from("telemetry_logs").insert(payload);

  if (!isMissingCapabilityColumnError(error)) return error;

  const { error: retryError } = await supabaseAdmin
    .from("telemetry_logs")
    .insert(stripCapabilityTelemetryColumns(payload));

  return retryError;
}

async function processProviderTripSummaries(
  provider: ProviderRecord,
  feeds: SupplementalFeedRows[],
  providerCapabilityProfile: ProviderCapabilityProfile
) {
  const diagnostics = createDistanceDiagnostics();
  if (!provider.company_id || feeds.length === 0) return diagnostics;

  const summaries: ProviderTripSummary[] = [];

  for (const feed of feeds) {
    for (const row of feed.rows) {
      const summary = normalizeProviderTripSummary(row, feed.config.mapping || {}, {
        companyId: provider.company_id,
        providerId: provider.id,
        providerTimezone: providerCapabilityProfile.provider_timezone,
      });
      if (!summary) continue;

      diagnostics.summary_rows_found++;
      if (summaries.length >= MAX_DISTANCE_SUMMARY_ROWS) {
        diagnostics.rows_skipped_over_cap++;
        continue;
      }

      summaries.push(summary);
    }
  }

  diagnostics.summaries_normalized = summaries.length;
  if (summaries.length === 0) return diagnostics;

  const truckIds = Array.from(new Set(summaries.map((summary) => summary.truck_id)));
  const { data: assets, error: assetError } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id")
    .eq("company_id", provider.company_id)
    .eq("provider_id", provider.id)
    .in("truck_id", truckIds);

  if (assetError) {
    diagnostics.errors.push(`Asset lookup failed: ${assetError.message}`);
  }

  const assetsByTruck = new Map(
    (assets || []).map((asset: any) => [String(asset.truck_id || "").toUpperCase(), asset.id])
  );

  for (const summary of summaries) {
    summary.asset_id = assetsByTruck.get(summary.truck_id.toUpperCase()) || null;
    incrementFieldCount(diagnostics.odometer_health_counts, summary.odometer_health);
    incrementFieldCount(diagnostics.distance_source_counts, summary.distance_source);

    if (!diagnostics.table_missing) {
      const writeResult = await writeProviderTripSummary(summary);
      if (writeResult.tableMissing) {
        diagnostics.table_missing = true;
        diagnostics.setup_required = true;
      } else if (writeResult.error) {
        diagnostics.errors.push(writeResult.error);
      } else {
        diagnostics.summaries_written++;
      }
    }

    if (summary.asset_id && !diagnostics.fleet_asset_columns_missing) {
      const assetResult = await updateFleetAssetDistanceState(summary);
      if (assetResult.columnsMissing) {
        diagnostics.fleet_asset_columns_missing = true;
        diagnostics.setup_required = true;
      } else if (assetResult.error) {
        diagnostics.errors.push(assetResult.error);
      } else {
        diagnostics.asset_distance_updates++;
      }
    }
  }

  diagnostics.errors = diagnostics.errors.slice(0, 10);
  return diagnostics;
}

async function writeProviderTripSummary(summary: ProviderTripSummary) {
  const payload = {
    company_id: summary.company_id,
    asset_id: summary.asset_id,
    provider_id: summary.provider_id,
    truck_id: summary.truck_id,
    provider_trip_key: summary.provider_trip_key,
    report_date: summary.report_date,
    start_time: summary.start_time,
    end_time: summary.end_time,
    start_location: summary.start_location,
    end_location: summary.end_location,
    start_odometer_km: summary.start_odometer_km,
    end_odometer_km: summary.end_odometer_km,
    odometer_delta_km: summary.odometer_delta_km,
    provider_mileage_km: summary.provider_mileage_km,
    motion_duration_minutes: summary.motion_duration_minutes,
    violations_count: summary.violations_count,
    distance_source: summary.distance_source,
    distance_quality: summary.distance_quality,
    metadata: summary.metadata,
    updated_at: new Date().toISOString(),
  };

  try {
    if (summary.provider_trip_key) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("provider_trip_summaries")
        .select("id")
        .eq("provider_id", summary.provider_id)
        .eq("provider_trip_key", summary.provider_trip_key)
        .maybeSingle();

      if (isMissingDistanceTableError(lookupError)) return { tableMissing: true };
      if (lookupError) return { error: lookupError.message };

      if (existing?.id) {
        const { error } = await supabaseAdmin
          .from("provider_trip_summaries")
          .update(payload)
          .eq("id", existing.id);
        if (isMissingDistanceTableError(error)) return { tableMissing: true };
        return { error: error?.message || null };
      }
    }

    const { error } = await supabaseAdmin
      .from("provider_trip_summaries")
      .insert(payload);
    if (isMissingDistanceTableError(error)) return { tableMissing: true };
    return { error: error?.message || null };
  } catch (err: any) {
    return { error: err.message || "Distance summary write failed" };
  }
}

async function updateFleetAssetDistanceState(summary: ProviderTripSummary) {
  if (!summary.asset_id) return { error: null };

  const payload = {
    odometer_health: summary.odometer_health,
    last_distance_update_at: new Date().toISOString(),
    distance_quality: {
      ...(summary.asset_distance_quality || {}),
      latest_provider_trip_key: summary.provider_trip_key,
      latest_report_date: summary.report_date,
    },
  };

  const { error } = await supabaseAdmin
    .from("fleet_assets")
    .update(payload)
    .eq("id", summary.asset_id)
    .eq("company_id", summary.company_id);

  if (isMissingDistanceColumnError(error)) return { columnsMissing: true };
  return { error: error?.message || null };
}

function isMissingDistanceTableError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("provider_trip_summaries") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function isMissingDistanceColumnError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "PGRST204" ||
    message.includes("odometer_health") ||
    message.includes("distance_quality") ||
    message.includes("last_distance_update_at") ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}

function stripCapabilityAssetColumns(payload: Record<string, any>) {
  const {
    telemetry_capability,
    telemetry_capabilities,
    telemetry_capability_source,
    canbus_enabled,
    fuel_rod_installed,
    fuel_rod_last_calibration,
    fuel_rod_calibration_status,
    tank_calibration,
    ...base
  } = payload;
  return base;
}

function stripCapabilityTelemetryColumns(payload: Record<string, any>) {
  const {
    engine_rpm,
    engine_on,
    ignition_on,
    fuel_rate,
    lifetime_fuel_used,
    engine_hours,
    fuel_raw,
    fuel_volume_liters,
    telemetry_capability,
    signal_quality,
    provider_signal_flags,
    ...base
  } = payload;
  return base;
}

function isMissingCapabilityColumnError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
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
  const profileCache = new Map<string, Promise<AuthResult>>();

  if (configs.length === 0) {
    return { feeds: [], diagnostics };
  }

  const feeds: SupplementalFeedRows[] = [];

  for (const config of configs) {
    const feedDiagnostics = diagnostics.feeds.find(
      (feed) => feed.name === config.name
    );

    const authContext = await resolveSupplementalAuthContext(
      provider,
      config,
      token,
      authMetadata,
      profileCache,
      feedDiagnostics
    );

    if (!authContext) continue;

    const payloadResult = buildPayloadWithDiagnostics(
      config.payload || {},
      provider,
      authContext.token,
      authContext.metadata,
      authContext.fallbackMetadata
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
      const feedResult = await fetchSupplementalFeed(
        provider,
        authContext,
        config,
        payloadResult.value
      );
      const rows = feedResult.rows;
      feeds.push({ config, rows });
      diagnostics.supplemental_rows_found += rows.length;

      if (feedDiagnostics) {
        feedDiagnostics.rendered_request = feedResult.requestDiagnostics;
        applySupplementalResponseDiagnostics(
          feedDiagnostics,
          feedResult.responseDiagnostics
        );
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
        if (err.requestDiagnostics) {
          feedDiagnostics.rendered_request = err.requestDiagnostics;
        }
        if (err.responseDiagnostics) {
          applySupplementalResponseDiagnostics(
            feedDiagnostics,
            err.responseDiagnostics
          );
        }
        feedDiagnostics.success = false;
        feedDiagnostics.error = err.message || "Supplemental feed failed";
      }
    }
  }

  return { feeds, diagnostics };
}

async function fetchSupplementalFeed(
  provider: ProviderRecord,
  authContext: SupplementalAuthContext,
  config: SupplementalFeedConfig,
  payload: any
) {
  const authType = authContext.authType;
  const token = authContext.token;
  const method = String(config.method || "GET").toUpperCase();
  const headers = buildHeaders(
    config.headers || {},
    provider,
    token,
    authContext.metadata,
    authContext.fallbackMetadata
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

  const requestHeaders = withJsonContentType(headers);
  const requestDiagnostics = buildSupplementalRequestDiagnostics(
    config.url,
    method,
    requestHeaders,
    payload
  );

  let response: Response;
  try {
    response = await fetch(config.url, {
      method,
      headers: requestHeaders,
      body: method === "GET" ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (err: any) {
    err.requestDiagnostics = requestDiagnostics;
    throw err;
  }
  const { data, responseType } = await readSafeSupplementalResponse(response);

  const paths =
    Array.isArray(config.vehicle_paths) && config.vehicle_paths.length > 0
      ? config.vehicle_paths
      : defaultSupplementalVehiclePaths();

  const responseDiagnostics = buildSupplementalResponseDiagnostics(
    data,
    response.status,
    responseType,
    paths
  );

  if (!response.ok) {
    const error = new Error(
      `Supplemental feed ${config.name} returned HTTP ${response.status}`
    ) as any;
    error.requestDiagnostics = requestDiagnostics;
    error.responseDiagnostics = responseDiagnostics;
    throw error;
  }

  return {
    rows: getRowsByPaths(data, paths),
    requestDiagnostics,
    responseDiagnostics,
  };
}

async function resolveSupplementalAuthContext(
  provider: ProviderRecord,
  config: SupplementalFeedConfig,
  primaryToken: string | null,
  primaryMetadata: AuthMetadata,
  profileCache: Map<string, Promise<AuthResult>>,
  feedDiagnostics?: SupplementalDiagnostics["feeds"][number]
): Promise<SupplementalAuthContext | null> {
  const primaryAuthType = (provider.auth_type || "POST_LOGIN").toUpperCase();

  if (!config.auth_profile) {
    return {
      token: primaryToken,
      metadata: primaryMetadata,
      fallbackMetadata: {},
      authType: primaryAuthType,
      profileName: null,
    };
  }

  const profileName = config.auth_profile;
  if (feedDiagnostics) {
    feedDiagnostics.auth_profile_used = profileName;
    feedDiagnostics.auth_profile_attempted = true;
    feedDiagnostics.auth_profile_token_captured = false;
    feedDiagnostics.auth_profile_metadata_available = [];
    feedDiagnostics.auth_profile_credential_macros_available =
      getAvailableCredentialMacroNames(provider);
  }

  const profile = getSupplementalAuthProfile(provider, profileName);
  if (!profile) {
    const message = `Supplemental auth profile '${profileName}' not found`;
    markSupplementalAuthFailure(feedDiagnostics, message);
    return null;
  }

  if (feedDiagnostics) {
    feedDiagnostics.auth_profile_username_override_configured =
      Boolean(profile.username_override);
  }

  let authPromise = profileCache.get(profileName);
  if (!authPromise) {
    authPromise = authenticateSupplementalAuthProfile(
      provider,
      profile,
      primaryToken,
      primaryMetadata
    );
    profileCache.set(profileName, authPromise);
  }

  let auth: AuthResult;
  try {
    auth = await authPromise;
  } catch (err: any) {
    const message = err?.message || `Supplemental auth profile '${profileName}' failed`;
    markSupplementalAuthFailure(feedDiagnostics, message);
    return null;
  }
  if (feedDiagnostics) {
    applySupplementalAuthDiagnostics(feedDiagnostics, auth.debug);
    feedDiagnostics.auth_profile_token_captured = Boolean(auth.token);
    feedDiagnostics.auth_profile_metadata_available = Object.keys(auth.metadata || {});
  }

  if (!auth.success || !auth.token) {
    const message = auth.message || `Supplemental auth profile '${profileName}' failed`;
    markSupplementalAuthFailure(feedDiagnostics, message);
    return null;
  }

  return {
    token: auth.token || null,
    metadata: auth.metadata || {},
    fallbackMetadata: primaryMetadata,
    authType: "BEARER",
    profileName,
  };
}

function markSupplementalAuthFailure(
  feedDiagnostics: SupplementalDiagnostics["feeds"][number] | undefined,
  message: string
) {
  const safeMessage = sanitizeDiagnosticMessage(message);
  if (!feedDiagnostics) return;

  feedDiagnostics.skipped = true;
  feedDiagnostics.skipped_reason = safeMessage;
  feedDiagnostics.success = false;
  feedDiagnostics.error = safeMessage;
  feedDiagnostics.auth_profile_error = safeMessage;
}

async function authenticateSupplementalAuthProfile(
  provider: ProviderRecord,
  profile: SupplementalAuthProfileConfig,
  primaryToken: string | null,
  primaryMetadata: AuthMetadata
): Promise<AuthResult> {
  const type = String(profile.type || "post_login").toUpperCase();

  if (type !== "POST_LOGIN") {
    return { success: false, message: `Unsupported supplemental auth profile type: ${type}` };
  }

  if (!profile.login_url) {
    return { success: false, message: "Supplemental auth profile login URL missing" };
  }

  const method = String(profile.method || "POST").toUpperCase();
  const payloadResult = buildPayloadWithDiagnostics(
    profile.payload || {},
    provider,
    primaryToken,
    primaryMetadata,
    {},
    { username: profile.username_override }
  );

  if (
    payloadResult.missingMacros.length > 0 ||
    payloadResult.unknownMacros.length > 0
  ) {
    return {
      success: false,
      message:
        payloadResult.unknownMacros.length > 0
          ? `Unknown template macro(s): ${payloadResult.unknownMacros.join(", ")}`
          : `Missing required template macro(s): ${payloadResult.missingMacros.join(", ")}`,
    };
  }

  const headers = buildHeaders(
    profile.headers || {},
    provider,
    primaryToken,
    primaryMetadata,
    {},
    { username: profile.username_override }
  );

  const response = await fetch(profile.login_url, {
    method,
    headers: withJsonContentType(headers),
    body: method === "GET" ? undefined : JSON.stringify(payloadResult.value),
    cache: "no-store",
  });
  const { data, responseType } = await readSafeSupplementalResponse(response);
  const tokenPaths =
    Array.isArray(profile.token_paths) && profile.token_paths.length > 0
      ? profile.token_paths
      : defaultTokenPaths();
  const token = getByPaths(data, tokenPaths);
  const metadata = buildSupplementalAuthProfileMetadata(provider, profile, data);
  const diagnostics = buildSupplementalAuthDiagnostics(
    provider,
    data,
    response.status,
    responseType,
    tokenPaths,
    profile,
    payloadResult.value
  );

  if (!response.ok || !token) {
    return {
      success: false,
      message: "No token returned by supplemental auth profile",
      debug: diagnostics,
    };
  }

  return {
    success: true,
    token,
    metadata,
    debug: {
      ...diagnostics,
      auth_metadata_available: Object.keys(metadata),
    },
  };
}

function buildSupplementalAuthDiagnostics(
  provider: ProviderRecord,
  data: any,
  httpStatus: number,
  responseType: SupplementalResponseDiagnostics["response_type"],
  tokenPaths: string[],
  profile: SupplementalAuthProfileConfig,
  renderedPayload: any
): SupplementalAuthDiagnostics {
  const responseData = getByPath(data, "data");
  const credentialDiagnostics = buildSupplementalCredentialDiagnostics(
    provider,
    profile,
    renderedPayload
  );
  const variableDiagnostics = buildAuthVariableDiagnostics(renderedPayload);

  return {
    auth_http_status: httpStatus,
    auth_response_type: responseType,
    auth_top_level_keys: collectTopLevelKeys(data),
    auth_data_is_null: responseData === null,
    auth_data_is_empty_object:
      Boolean(responseData) &&
      typeof responseData === "object" &&
      !Array.isArray(responseData) &&
      Object.keys(responseData).length === 0,
    auth_data_keys: collectTopLevelKeys(responseData),
    auth_data_array_paths_found: collectArrayPathCounts(responseData),
    auth_data_object_paths_found: collectObjectPaths(responseData),
    auth_data_result_paths_found: collectAuthDataResultPaths(responseData),
    auth_error_keys: collectResponseErrorKeys(data),
    auth_operation_name_sent:
      typeof renderedPayload?.operationName === "string"
        ? renderedPayload.operationName.slice(0, 120)
        : null,
    auth_payload_key_paths_sent: collectAuthPayloadKeyPaths(renderedPayload),
    auth_variable_keys_sent: variableDiagnostics.keys,
    auth_variable_value_types: variableDiagnostics.types,
    auth_variable_value_lengths: variableDiagnostics.lengths,
    ...credentialDiagnostics,
    auth_token_paths_checked: tokenPaths.map((path) => String(path)).slice(0, 20),
    auth_metadata_paths_checked: collectMetadataPathsChecked(profile),
    auth_token_candidate_paths_found: collectTokenCandidatePaths(data),
  };
}

function applySupplementalAuthDiagnostics(
  feedDiagnostics: SupplementalDiagnostics["feeds"][number] | undefined,
  diagnostics: any
) {
  if (!feedDiagnostics || !diagnostics || typeof diagnostics !== "object") return;

  if (diagnostics.auth_http_status) {
    feedDiagnostics.auth_http_status = Number(diagnostics.auth_http_status);
  }
  if (diagnostics.auth_response_type) {
    feedDiagnostics.auth_response_type = String(diagnostics.auth_response_type);
  }
  feedDiagnostics.auth_top_level_keys = Array.isArray(diagnostics.auth_top_level_keys)
    ? diagnostics.auth_top_level_keys.map((key: any) => String(key)).slice(0, 50)
    : [];
  if (typeof diagnostics.auth_data_is_null === "boolean") {
    feedDiagnostics.auth_data_is_null = diagnostics.auth_data_is_null;
  }
  if (typeof diagnostics.auth_data_is_empty_object === "boolean") {
    feedDiagnostics.auth_data_is_empty_object =
      diagnostics.auth_data_is_empty_object;
  }
  feedDiagnostics.auth_data_keys = Array.isArray(diagnostics.auth_data_keys)
    ? diagnostics.auth_data_keys.map((key: any) => String(key)).slice(0, 50)
    : [];
  feedDiagnostics.auth_data_array_paths_found =
    diagnostics.auth_data_array_paths_found &&
    typeof diagnostics.auth_data_array_paths_found === "object"
      ? Object.fromEntries(
          Object.entries(diagnostics.auth_data_array_paths_found)
            .slice(0, 50)
            .map(([path, count]) => [String(path), Number(count || 0)])
        )
      : {};
  feedDiagnostics.auth_data_object_paths_found = Array.isArray(
    diagnostics.auth_data_object_paths_found
  )
    ? diagnostics.auth_data_object_paths_found
        .map((path: any) => String(path))
        .slice(0, 50)
    : [];
  feedDiagnostics.auth_data_result_paths_found =
    diagnostics.auth_data_result_paths_found &&
    typeof diagnostics.auth_data_result_paths_found === "object"
      ? Object.fromEntries(
          Object.entries(diagnostics.auth_data_result_paths_found)
            .slice(0, 50)
            .map(([path, detail]) => [
              String(path),
              typeof detail === "number" ? Number(detail) : String(detail),
            ])
        )
      : {};
  feedDiagnostics.auth_error_keys = Array.isArray(diagnostics.auth_error_keys)
    ? diagnostics.auth_error_keys.map((key: any) => String(key)).slice(0, 50)
    : [];
  feedDiagnostics.auth_operation_name_sent =
    typeof diagnostics.auth_operation_name_sent === "string"
      ? diagnostics.auth_operation_name_sent.slice(0, 120)
      : null;
  feedDiagnostics.auth_payload_key_paths_sent = Array.isArray(
    diagnostics.auth_payload_key_paths_sent
  )
    ? diagnostics.auth_payload_key_paths_sent
        .map((path: any) => String(path))
        .slice(0, 100)
    : [];
  feedDiagnostics.auth_variable_keys_sent = Array.isArray(
    diagnostics.auth_variable_keys_sent
  )
    ? diagnostics.auth_variable_keys_sent
        .map((key: any) => String(key))
        .slice(0, 50)
    : [];
  feedDiagnostics.auth_variable_value_types =
    diagnostics.auth_variable_value_types &&
    typeof diagnostics.auth_variable_value_types === "object"
      ? Object.fromEntries(
          Object.entries(diagnostics.auth_variable_value_types)
            .slice(0, 50)
            .map(([key, value]) => [String(key), String(value)])
        )
      : {};
  feedDiagnostics.auth_variable_value_lengths =
    diagnostics.auth_variable_value_lengths &&
    typeof diagnostics.auth_variable_value_lengths === "object"
      ? Object.fromEntries(
          Object.entries(diagnostics.auth_variable_value_lengths)
            .slice(0, 50)
            .map(([key, value]) => [String(key), Number(value || 0)])
        )
      : {};
  feedDiagnostics.auth_username_source =
    typeof diagnostics.auth_username_source === "string"
      ? diagnostics.auth_username_source
      : null;
  feedDiagnostics.auth_password_source =
    typeof diagnostics.auth_password_source === "string"
      ? diagnostics.auth_password_source
      : null;
  if (typeof diagnostics.auth_username_present === "boolean") {
    feedDiagnostics.auth_username_present = diagnostics.auth_username_present;
  }
  if (typeof diagnostics.auth_password_present === "boolean") {
    feedDiagnostics.auth_password_present = diagnostics.auth_password_present;
  }
  feedDiagnostics.auth_username_length =
    typeof diagnostics.auth_username_length === "number"
      ? diagnostics.auth_username_length
      : null;
  feedDiagnostics.auth_password_length =
    typeof diagnostics.auth_password_length === "number"
      ? diagnostics.auth_password_length
      : null;
  feedDiagnostics.auth_token_paths_checked = Array.isArray(diagnostics.auth_token_paths_checked)
    ? diagnostics.auth_token_paths_checked.map((path: any) => String(path)).slice(0, 20)
    : [];
  feedDiagnostics.auth_metadata_paths_checked = Array.isArray(diagnostics.auth_metadata_paths_checked)
    ? diagnostics.auth_metadata_paths_checked.map((path: any) => String(path)).slice(0, 20)
    : [];
  feedDiagnostics.auth_token_candidate_paths_found = Array.isArray(diagnostics.auth_token_candidate_paths_found)
    ? diagnostics.auth_token_candidate_paths_found.map((path: any) => String(path)).slice(0, 20)
    : [];
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
      auth_profile: config.current_status_auth_profile,
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
      auth_profile: config.fuel_status_auth_profile || config.current_status_auth_profile,
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
    auth_profile: feed.auth_profile ? String(feed.auth_profile).trim() : undefined,
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

function getSupplementalAuthProfile(
  provider: ProviderRecord,
  profileName: string
): SupplementalAuthProfileConfig | null {
  const profiles = provider.fleet_config?.supplemental_auth_profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return null;
  }

  const profile = profiles[profileName];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  return {
    name: profileName,
    type: profile.type || "post_login",
    username_override:
      typeof profile.username_override === "string"
        ? profile.username_override.trim()
        : undefined,
    login_url: profile.login_url,
    method: profile.method || "POST",
    headers: profile.headers || {},
    payload: profile.payload || {},
    token_paths: Array.isArray(profile.token_paths) ? profile.token_paths : undefined,
    metadata_paths:
      profile.metadata_paths && typeof profile.metadata_paths === "object"
        ? profile.metadata_paths
        : undefined,
  };
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
      auth_profile_used: feed.auth_profile || undefined,
      auth_profile_attempted: false,
      auth_profile_token_captured: feed.auth_profile ? false : undefined,
      auth_profile_metadata_available: [],
      auth_profile_credential_macros_available: feed.auth_profile
        ? []
        : undefined,
      auth_profile_username_override_configured: feed.auth_profile
        ? false
        : undefined,
    })),
  };
}

function applySupplementalResponseDiagnostics(
  feedDiagnostics: SupplementalDiagnostics["feeds"][number],
  responseDiagnostics: SupplementalResponseDiagnostics
) {
  feedDiagnostics.http_status = responseDiagnostics.http_status;
  feedDiagnostics.response_type = responseDiagnostics.response_type;
  feedDiagnostics.top_level_keys = responseDiagnostics.top_level_keys;
  feedDiagnostics.candidate_row_paths_checked =
    responseDiagnostics.candidate_row_paths_checked;
  feedDiagnostics.first_array_paths_found =
    responseDiagnostics.first_array_paths_found;
  feedDiagnostics.response_error_keys =
    responseDiagnostics.response_error_keys;
}

function buildSupplementalRequestDiagnostics(
  url: string,
  method: string,
  headers: Record<string, string>,
  payload: any
): SupplementalRequestDiagnostics {
  const parsedUrl = parseSafeUrlParts(url);

  return {
    method,
    url_host: parsedUrl.host,
    url_path: parsedUrl.path,
    content_type: getHeaderValue(headers, "content-type"),
    payload_top_level_keys: collectTopLevelKeys(payload),
    payload_key_paths: collectPayloadKeyPaths(payload),
    payload_value_types: collectPayloadValueTypes(payload),
    allowed_values: collectAllowedPayloadValues(payload),
  };
}

function parseSafeUrlParts(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      path: parsed.pathname || "/",
    };
  } catch {
    return { host: null, path: null };
  }
}

function getHeaderValue(headers: Record<string, string>, targetName: string) {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === targetName.toLowerCase()
  );

  return entry ? String(entry[1]).slice(0, 120) : null;
}

function collectPayloadKeyPaths(value: any) {
  const paths: string[] = [];

  function walk(current: any, path: string, depth: number) {
    if (paths.length >= 100 || depth > 8) return;

    if (Array.isArray(current)) {
      if (path) paths.push(`${path}[]`);
      for (const item of current.slice(0, 3)) {
        if (item && typeof item === "object") {
          walk(item, path ? `${path}[]` : "[]", depth + 1);
        }
      }
      return;
    }

    if (!current || typeof current !== "object") return;

    for (const [key, nested] of Object.entries(current)) {
      if (isSensitiveProviderKey(normalizeProviderKey(key))) continue;
      const nextPath = path ? `${path}.${key}` : key;
      paths.push(nextPath);
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(value, "", 0);
  return paths;
}

function collectPayloadValueTypes(value: any) {
  const types: Record<string, string> = {};

  function walk(current: any, path: string, depth: number) {
    if (Object.keys(types).length >= 120 || depth > 8) return;

    if (Array.isArray(current)) {
      if (path) types[path] = describePayloadValueType(current);
      for (const item of current.slice(0, 3)) {
        if (item && typeof item === "object") {
          walk(item, path ? `${path}[]` : "[]", depth + 1);
        }
      }
      return;
    }

    if (current && typeof current === "object") {
      for (const [key, nested] of Object.entries(current)) {
        if (isSensitiveProviderKey(normalizeProviderKey(key))) continue;
        const nextPath = path ? `${path}.${key}` : key;
        walk(nested, nextPath, depth + 1);
      }
      return;
    }

    if (path) types[path] = describePayloadValueType(current);
  }

  walk(value, "", 0);
  return types;
}

function describePayloadValueType(value: any) {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "array(empty)" : "array";
  return typeof value;
}

function collectAllowedPayloadValues(payload: any) {
  const allowedPaths = [
    "request.reportType",
    "pageIndex",
    "pageSize",
    "channel",
    "request.startDate",
    "request.endDate",
  ];
  const values: Record<string, string | number> = {};

  for (const path of allowedPaths) {
    const value = getByPath(payload, path);
    if (typeof value === "string" || typeof value === "number") {
      values[path] = value;
    }
  }

  return values;
}

async function readSafeSupplementalResponse(response: Response): Promise<{
  data: any;
  responseType: SupplementalResponseDiagnostics["response_type"];
}> {
  let text = "";

  try {
    text = await response.text();
  } catch {
    return { data: null, responseType: "error" };
  }

  const trimmed = text.trim();
  if (!trimmed) return { data: null, responseType: "null" };

  const contentType = response.headers.get("content-type") || "";
  const looksJson =
    contentType.toLowerCase().includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed === "null";

  if (looksJson) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) return { data, responseType: "array" };
      if (data === null) return { data, responseType: "null" };
      if (typeof data === "object") return { data, responseType: "object" };
      return { data: null, responseType: "text" };
    } catch {
      return { data: null, responseType: "error" };
    }
  }

  if (
    contentType.toLowerCase().includes("html") ||
    /<html[\s>]/i.test(trimmed) ||
    /<!doctype html/i.test(trimmed)
  ) {
    return { data: null, responseType: "html" };
  }

  return { data: null, responseType: "text" };
}

function buildSupplementalResponseDiagnostics(
  data: any,
  httpStatus: number,
  responseType: SupplementalResponseDiagnostics["response_type"],
  candidatePaths: string[]
): SupplementalResponseDiagnostics {
  return {
    http_status: httpStatus,
    response_type: responseType,
    top_level_keys: collectTopLevelKeys(data),
    candidate_row_paths_checked: candidatePaths,
    first_array_paths_found: collectArrayPathCounts(data),
    response_error_keys: collectResponseErrorKeys(data),
  };
}

function collectTopLevelKeys(data: any) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];

  return Object.keys(data)
    .filter((key) => !isSensitiveProviderKey(normalizeProviderKey(key)))
    .slice(0, MAX_UNMAPPED_AVAILABLE_KEYS);
}

function collectArrayPathCounts(data: any) {
  const counts: Record<string, number> = {};

  function walk(value: any, path: string, depth: number) {
    if (Object.keys(counts).length >= MAX_UNMAPPED_AVAILABLE_KEYS || depth > 5) {
      return;
    }

    if (Array.isArray(value)) {
      counts[path || "$"] = value.length;

      for (const item of value.slice(0, 3)) {
        if (item && typeof item === "object") {
          walk(item, path || "$", depth + 1);
        }
      }
      return;
    }

    if (!value || typeof value !== "object") return;

    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveProviderKey(normalizeProviderKey(key))) continue;
      const nextPath = path ? `${path}.${key}` : key;
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(data, "", 0);
  return counts;
}

function collectObjectPaths(data: any) {
  const paths = new Set<string>();

  function walk(value: any, path: string, depth: number) {
    if (!value || typeof value !== "object" || depth > 3 || paths.size >= 50) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 3)) {
        walk(item, path, depth + 1);
      }
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeProviderKey(key);
      if (!normalized || isSensitiveProviderKey(normalized)) continue;

      const nextPath = path ? `${path}.${key}` : key;
      if (nested && typeof nested === "object") paths.add(nextPath);
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(data, "", 0);
  return Array.from(paths);
}

function collectAuthDataResultPaths(data: any) {
  const paths: Record<string, string | number> = {};

  function walk(value: any, path: string, depth: number) {
    if (!value || typeof value !== "object" || depth > 4) return;
    if (Object.keys(paths).length >= 50) return;

    if (Array.isArray(value)) {
      if (path) paths[path] = value.length;

      for (const item of value.slice(0, 3)) {
        walk(item, path, depth + 1);
      }
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeProviderKey(key);
      const nextPath = path ? `${path}.${key}` : key;

      if (isSensitiveProviderKey(normalized)) {
        if (normalized === "token" || normalized.includes("token")) {
          paths[nextPath] = "token-like key present";
        } else if (Array.isArray(nested)) {
          paths[nextPath] = nested.length;
        } else if (nested === null) {
          paths[nextPath] = "null";
        } else {
          paths[nextPath] = typeof nested;
        }
        continue;
      }

      if (Array.isArray(nested)) {
        paths[nextPath] = nested.length;
      } else if (nested === null) {
        paths[nextPath] = "null";
      } else if (nested && typeof nested === "object") {
        paths[nextPath] = "object";
      } else {
        paths[nextPath] = typeof nested;
      }

      walk(nested, nextPath, depth + 1);
    }
  }

  walk(data, "", 0);
  return paths;
}

function collectAuthPayloadKeyPaths(payload: any) {
  const paths: string[] = [];

  function walk(value: any, path: string, depth: number) {
    if (paths.length >= 120 || depth > 8) return;

    if (Array.isArray(value)) {
      if (path) paths.push(`${path}[]`);
      for (const item of value.slice(0, 3)) {
        if (item && typeof item === "object") {
          walk(item, path ? `${path}[]` : "[]", depth + 1);
        }
      }
      return;
    }

    if (!value || typeof value !== "object") return;

    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      paths.push(nextPath);
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(payload, "", 0);
  return paths;
}

function buildAuthVariableDiagnostics(payload: any) {
  const variables = payload?.variables;
  const keys: string[] = [];
  const types: Record<string, string> = {};
  const lengths: Record<string, number> = {};

  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    return { keys, types, lengths };
  }

  for (const [key, value] of Object.entries(variables).slice(0, 50)) {
    const safeKey = String(key);
    keys.push(safeKey);
    types[safeKey] = describePayloadValueType(value);

    if (value === null || value === undefined) {
      lengths[safeKey] = 0;
    } else if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      lengths[safeKey] = String(value).length;
    }
  }

  return { keys, types, lengths };
}

function buildSupplementalCredentialDiagnostics(
  provider: ProviderRecord,
  profile: SupplementalAuthProfileConfig,
  renderedPayload: any
) {
  const anyProvider = provider as any;
  const authConfig = provider.auth_config || {};
  const usernameSource = firstCredentialDiagnostic([
    { source: "username_override", value: profile.username_override },
    { source: "provider.username", value: provider.username },
    { source: "auth_config.username", value: authConfig.username },
    { source: "auth_config.user_name", value: authConfig.user_name },
  ]);
  const passwordSource = firstCredentialDiagnostic([
    { source: "provider.password", value: provider.password },
    { source: "provider_secret", value: anyProvider.provider_secret },
    { source: "auth_config.provider_secret", value: authConfig.provider_secret },
    { source: "auth_config.password", value: authConfig.password },
    { source: "api_key", value: provider.api_key },
  ]);
  const variables = renderedPayload?.variables;
  const usernameValue =
    variables && typeof variables === "object" && !Array.isArray(variables)
      ? sanitizeMacroScalar((variables as any).user_name ?? (variables as any).username)
      : null;
  const passwordValue =
    variables && typeof variables === "object" && !Array.isArray(variables)
      ? sanitizeMacroScalar((variables as any).password)
      : null;

  return {
    auth_username_source: usernameSource.source,
    auth_password_source: passwordSource.source,
    auth_username_present: usernameValue !== null,
    auth_password_present: passwordValue !== null,
    auth_username_length: usernameValue !== null ? String(usernameValue).length : null,
    auth_password_length: passwordValue !== null ? String(passwordValue).length : null,
  };
}

function firstCredentialDiagnostic(
  candidates: Array<{ source: string; value: any }>
) {
  for (const candidate of candidates) {
    const value = sanitizeMacroScalar(candidate.value);
    if (value !== null) {
      return {
        source: candidate.source,
        length: String(value).length,
      };
    }
  }

  return { source: null, length: null };
}

function collectResponseErrorKeys(data: any) {
  const keys = new Set<string>();
  const interesting = new Set([
    "error",
    "errors",
    "message",
    "status",
    "statuscode",
    "code",
    "errorcode",
    "errormessage",
  ]);

  function walk(value: any, path: string, depth: number) {
    if (!value || typeof value !== "object" || depth > 4 || keys.size >= 30) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 3)) walk(item, path, depth + 1);
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeProviderKey(key);
      if (isSensitiveProviderKey(normalized)) continue;

      const nextPath = path ? `${path}.${key}` : key;
      if (interesting.has(normalized)) keys.add(nextPath);
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(data, "", 0);
  return Array.from(keys);
}

function collectMetadataPathsChecked(profile: SupplementalAuthProfileConfig) {
  const metadataPaths = profile.metadata_paths || {};
  return Object.entries(metadataPaths)
    .map(([key, path]) => `${key}: ${path}`)
    .slice(0, 20);
}

function collectTokenCandidatePaths(data: any) {
  const paths = new Set<string>();
  const interesting = new Set([
    "token",
    "accesstoken",
    "access_token",
    "jwt",
    "bearertoken",
    "bearer_token",
  ]);

  function walk(value: any, path: string, depth: number) {
    if (!value || typeof value !== "object" || depth > 6 || paths.size >= 20) {
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 3).forEach((item, index) => {
        walk(item, path ? `${path}.${index}` : String(index), depth + 1);
      });
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      const normalized = normalizeProviderKey(key);
      const nextPath = path ? `${path}.${key}` : key;
      if (interesting.has(normalized)) paths.add(nextPath);
      walk(nested, nextPath, depth + 1);
    }
  }

  walk(data, "", 0);
  return Array.from(paths);
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
  diagnostics: SupplementalDiagnostics,
  providerCapabilityProfile?: ProviderCapabilityProfile | null
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
      if (!isMeaningfulSupplementalValue(field, value, providerCapabilityProfile)) continue;

      if (!PERSISTED_SUPPLEMENTAL_FIELDS.has(field)) {
        incrementFieldCount(feedDiagnostics?.mapped_fields_skipped, field);
        continue;
      }

      if (field === "fuel_level") {
        if (
          !isMeaningfulSupplementalValue(
            field,
            normalized.fuel_level,
            providerCapabilityProfile
          )
        ) {
          normalized.fuel_level = value;
          mergedFields.push(field);
        } else {
          incrementFieldCount(feedDiagnostics?.mapped_fields_skipped, field);
        }
        continue;
      }

      if (!isMeaningfulSupplementalValue(field, normalized[field], providerCapabilityProfile)) {
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

    if (DISTANCE_SUMMARY_FIELDS.includes(field)) {
      const text = String(value).trim();
      if (text) output[field] = text.slice(0, 240);
      continue;
    }

    if (field === "engine_on" || field === "ignition_on") {
      const parsedBoolean = parseProviderBoolean(value);
      if (parsedBoolean !== null) output[field] = parsedBoolean;
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

  if (field === "engine_rpm") {
    return ["engine_rpm", "engineRpm", "rpm", "RPM", "Engine RPM"];
  }

  if (field === "engine_on") {
    return ["engine_on", "engineOn", "engine", "engine_status", "engineStatus"];
  }

  if (field === "ignition_on") {
    return ["ignition_on", "ignitionOn", "ignition", "ignition_status", "ignitionStatus"];
  }

  if (field === "fuel_rate") {
    return ["fuel_rate", "fuelRate", "fuel consumption", "fuel_consumption"];
  }

  if (field === "lifetime_fuel_used") {
    return ["lifetime_fuel_used", "lifetimeFuelUsed", "total_fuel_used", "totalFuelUsed"];
  }

  if (field === "fuel_raw") {
    return ["fuel_raw", "fuelRaw", "fuel_adc", "fuelAdc", "tank_raw", "tankRaw"];
  }

  if (field === "fuel_volume_liters") {
    return [
      "fuel_volume_liters",
      "fuelVolumeLiters",
      "fuel_liters",
      "fuelLiters",
      "fuel_litres",
      "litres",
      "liters",
      "tank_volume_liters",
    ];
  }

  if (field === "driver_name") {
    return ["driver_name", "driverName", "driver", "Driver"];
  }

  if (DISTANCE_SUMMARY_FIELDS.includes(field)) {
    return getDistanceFieldFallbackKeys(field);
  }

  if (field === "battery_voltage") {
    return ["battery_voltage", "batteryVoltage", "battery voltage", "voltage"];
  }

  if (field === "temperature") {
    return ["temperature", "temp", "Temperature"];
  }

  return [field];
}

function isMeaningfulSupplementalValue(
  field: string,
  value: any,
  providerCapabilityProfile?: ProviderCapabilityProfile | null
) {
  if (value === null || value === undefined || value === "") return false;
  if (field === "engine_on" || field === "ignition_on") {
    if (value === true) return true;
    if (value === false) return isSignalSupported(providerCapabilityProfile, field);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (field === "temperature") return true;
    if (value === 0) return isSignalSupported(providerCapabilityProfile, field);
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
  if (field === "engine_rpm") return value >= 0 && value <= 10000;
  if (field === "fuel_rate") return value >= 0 && value <= 500;
  if (field === "lifetime_fuel_used") return value >= 0 && value <= 100000000;
  if (field === "fuel_raw") return value >= 0 && value <= 10000000;
  if (field === "fuel_volume_liters") return value >= 0 && value <= 5000;
  if (field === "battery_voltage") return value >= 0 && value <= 1000;
  if (field === "temperature") return value >= -100 && value <= 1000;

  return true;
}

function parseProviderBoolean(value: any): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (!text || text === "-" || text === "--" || text === "n/a" || text === "na") {
    return null;
  }
  if (["on", "true", "yes", "running", "engine_on", "ignition_on", "1"].includes(text)) {
    return true;
  }
  if (["off", "false", "no", "stopped", "engine_off", "ignition_off", "0"].includes(text)) {
    return false;
  }
  return null;
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
  authMetadata: AuthMetadata = {},
  fallbackAuthMetadata: AuthMetadata = {}
) {
  return buildPayloadWithDiagnostics(
    template,
    provider,
    token,
    authMetadata,
    fallbackAuthMetadata
  )
    .value;
}

function buildPayloadWithDiagnostics(
  template: any,
  provider: ProviderRecord,
  token: string | null = null,
  authMetadata: AuthMetadata = {},
  fallbackAuthMetadata: AuthMetadata = {},
  credentialOverrides: TemplateCredentialOverrides = {}
): TemplateRenderResult {
  return renderTemplateValue(template || {}, {
    provider,
    token,
    authMetadata,
    fallbackAuthMetadata,
    credentialOverrides,
    now: new Date(),
  });
}

function buildHeaders(
  template: any,
  provider: ProviderRecord,
  token: string | null,
  authMetadata: AuthMetadata = {},
  fallbackAuthMetadata: AuthMetadata = {},
  credentialOverrides: TemplateCredentialOverrides = {}
) {
  const output: Record<string, string> = {};
  const rendered = renderTemplateValue(template || {}, {
    provider,
    token,
    authMetadata,
    fallbackAuthMetadata,
    credentialOverrides,
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
    fallbackAuthMetadata: AuthMetadata;
    credentialOverrides: TemplateCredentialOverrides;
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
    fallbackAuthMetadata: AuthMetadata;
    credentialOverrides: TemplateCredentialOverrides;
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
    fallbackAuthMetadata: AuthMetadata;
    credentialOverrides: TemplateCredentialOverrides;
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
    fallbackAuthMetadata: AuthMetadata;
    credentialOverrides: TemplateCredentialOverrides;
    now: Date;
  }
) {
  const {
    provider,
    token,
    authMetadata,
    fallbackAuthMetadata,
    credentialOverrides,
    now,
  } = context;

  if (
    macro === "username" ||
    macro === "password" ||
    macro === "provider_secret" ||
    macro === "api_secret"
  ) {
    return getCredentialMacroValue(provider, macro, credentialOverrides);
  }

  if (macro === "api_key") return provider.api_key || "";
  if (macro === "bearer_token") return provider.bearer_token || "";
  if (macro === "token") return token || "";

  const dateValue = getDateMacroValue(macro, now);
  if (dateValue) return dateValue;

  if (
    macro === "auth_user_id" ||
    macro === "provider_user_id" ||
    macro === "analytics_user_id"
  ) {
    return getAuthMacroValue(macro, provider, authMetadata, fallbackAuthMetadata);
  }

  return "";
}

function getCredentialMacroValue(
  provider: ProviderRecord,
  macro: string,
  overrides: TemplateCredentialOverrides = {}
) {
  const anyProvider = provider as any;
  const authConfig = provider.auth_config || {};

  if (macro === "username") {
    return firstNonEmptyCredentialValue([
      overrides.username,
      provider.username,
      authConfig.username,
      authConfig.user_name,
    ], true);
  }

  if (macro === "password") {
    return firstNonEmptyCredentialValue([
      provider.password,
      anyProvider.provider_secret,
      authConfig.provider_secret,
      authConfig.password,
      provider.api_key,
    ], false);
  }

  if (macro === "provider_secret") {
    return firstNonEmptyCredentialValue([
      anyProvider.provider_secret,
      authConfig.provider_secret,
      provider.api_key,
    ], false);
  }

  if (macro === "api_secret") {
    return firstNonEmptyCredentialValue([
      anyProvider.api_secret,
      authConfig.api_secret,
    ], false);
  }

  return "";
}

function firstNonEmptyCredentialValue(values: any[], trim: boolean) {
  for (const value of values) {
    const scalar = sanitizeCredentialMacroScalar(value, trim);
    if (scalar !== null) return scalar;
  }

  return "";
}

function sanitizeCredentialMacroScalar(
  value: any,
  trim: boolean
): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const text = trim ? value.trim() : value;
  if (!text || text.length > 240) return null;
  return text;
}

function getAvailableCredentialMacroNames(provider: ProviderRecord) {
  return ["username", "password", "provider_secret", "api_secret"].filter(
    (macro) => getCredentialMacroValue(provider, macro) !== ""
  );
}

function firstNonEmptyValue(values: any[]) {
  for (const value of values) {
    const scalar = sanitizeMacroScalar(value);
    if (scalar !== null) return scalar;
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
  authMetadata: AuthMetadata,
  fallbackAuthMetadata: AuthMetadata = {}
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

  const fleetConfigValue = getConfiguredAuthMacroValueFromSource(
    provider.fleet_config || {},
    macro
  );
  if (fleetConfigValue !== null) return fleetConfigValue;

  for (const key of metadataPriority) {
    const value = sanitizeMacroScalar(fallbackAuthMetadata[key]);
    if (value !== null) return value;
  }

  const authConfigValue = getConfiguredAuthMacroValueFromSource(
    provider.auth_config || {},
    macro
  );
  return authConfigValue !== null ? authConfigValue : "";
}

function getConfiguredAuthMacroValue(
  provider: ProviderRecord,
  macro: keyof AuthMetadata
) {
  const sources = [provider.fleet_config || {}, provider.auth_config || {}];

  for (const source of sources) {
    const value = getConfiguredAuthMacroValueFromSource(source, macro);
    if (value !== null) return value;
  }

  return "";
}

function getConfiguredAuthMacroValueFromSource(
  source: any,
  macro: keyof AuthMetadata
) {
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

  return firstSafeValueByPaths(source, paths);
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

function buildSupplementalAuthProfileMetadata(
  provider: ProviderRecord,
  profile: SupplementalAuthProfileConfig,
  authResponse?: any
): AuthMetadata {
  const metadata = buildAuthMetadata(provider, authResponse);
  const metadataPaths = profile.metadata_paths || {};
  const allowedKeys: Array<keyof AuthMetadata> = [
    "auth_user_id",
    "provider_user_id",
    "analytics_user_id",
  ];

  for (const key of allowedKeys) {
    const path = metadataPaths[key];
    if (!path) continue;
    const value = sanitizeMacroScalar(getByPath(authResponse, path));
    if (value !== null) metadata[key] = value;
  }

  return metadata;
}

function sanitizeDiagnosticMessage(message: any) {
  return String(message || "Supplemental feed auth failed")
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "bearer [redacted]")
    .replace(/token['"]?\s*[:=]\s*['"]?[^,'"\s}]+/gi, "token=[redacted]")
    .slice(0, 240);
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
