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
  normalizeDistanceTruckKey,
  normalizeProviderTripSummary,
  type DistanceDiagnostics,
  type ProviderTripSummary,
} from "../telemetry/distance";
import {
  dedupeRowPaths,
  extractRowsByPath as extractRowsByNormalizedPath,
  isVehicleLikeRow as isNormalizedVehicleLikeRow,
  normalizeFieldMappingsRelativeToRow,
  normalizeRowPath,
} from "./configNormalization";

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
  failure_stage?: ProviderExecutionFailureStage;
  skipped_missing_identifier?: number;
  matched_vehicle_rows?: number;
  vehicle_match_review?: ProviderVehicleMatchReview;
  cross_provider_asset_matches?: number;
  cross_provider_asset_match_samples?: Array<{
    truck_id: string;
    existing_provider_name?: string | null;
    incoming_provider_name?: string | null;
  }>;
  capability_upgrades_applied?: number;
  sample_normalized?: any;
  supplemental_diagnostics?: SupplementalDiagnostics;
  capability_summary?: any;
  distance_diagnostics?: DistanceDiagnostics;
  debug?: any;
};

type ProviderSyncOptions = {
  writeDistanceSummaries?: boolean;
};

type ProviderVehicleMatchReviewRow = {
  provider_vehicle_label: string;
  matched_truck_id: string | null;
  match_source: string;
  confidence: "high" | "needs_review";
  status: "matched" | "unmatched" | "needs_review";
};

type ProviderVehicleMatchReview = {
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  needs_review_rows: number;
  rows: ProviderVehicleMatchReviewRow[];
  truncated: boolean;
};

const VEHICLE_MATCH_REVIEW_LIMIT = 100;

export type ProviderDiscoveryEndpointInput = {
  name?: string;
  url: string;
  method?: string;
  row_paths?: string[];
};

export type ProviderDataDiscoveryEndpointDiagnostics = {
  name: string;
  endpoint_source: "configured_primary" | "configured_supplemental" | "candidate";
  endpoint_tested: string;
  auth_used: string;
  http_status?: number;
  success: boolean;
  response_type?: SupplementalResponseDiagnostics["response_type"];
  content_type?: string | null;
  top_level_keys: string[];
  candidate_row_paths: string[];
  candidate_row_paths_found: Record<string, number>;
  detected_useful_fields: string[];
  field_mapping_suggestions?: Record<string, string>;
  sanitized_sample_shape: any;
  rows_detected: number;
  body_truncated?: boolean;
  setup_blocker?: string;
  error?: string;
};

export type ProviderDataDiscoveryDiagnostics = {
  endpoints_configured: number;
  endpoints_attempted: number;
  endpoints_succeeded: number;
  useful_fields_detected: string[];
  setup_blockers: string[];
  endpoints: ProviderDataDiscoveryEndpointDiagnostics[];
};

type AuthResult = {
  success: boolean;
  token?: string | null;
  metadata?: AuthMetadata;
  message?: string;
  debug?: any;
};

type ProviderExecutionFailureStage =
  | "auth"
  | "request"
  | "feed"
  | "rows"
  | "mapping";

export type ProviderFeedExecutionConfig = {
  name: string;
  feed_type: "current_vehicles" | "reports" | "trip_summary" | "distance_report" | string;
  url: string;
  method?: string;
  headers?: Record<string, any>;
  payload?: Record<string, any>;
  row_paths?: string[];
  token_placement?: string;
  api_key_header?: string;
  require_rows?: boolean;
};

export type ProviderRequestExecutionResult = {
  success: boolean;
  feed_name: string;
  feed_type: string;
  failure_stage?: ProviderExecutionFailureStage;
  message?: string;
  setup_blocker?: string;
  http_status?: number;
  response_type?: SupplementalResponseDiagnostics["response_type"];
  content_type?: string | null;
  rows: any[];
  data: any;
  request_diagnostics?: SupplementalRequestDiagnostics;
  response_diagnostics?: SupplementalResponseDiagnostics;
  effective_url_masked?: string;
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
  feed_type?: string;
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
    feed_type?: string;
    distance_report?: boolean;
    setup_requirement?: string;
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
  "access_token",
  "user_api_hash",
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
  provider: ProviderRecord,
  options: ProviderSyncOptions = {}
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
        message: plainProviderFailureMessage(auth.message || "Provider authentication failed"),
        vehicleCount: 0,
        failure_stage: "auth",
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
        failure_stage: "feed",
        debug: fleet.debug || null,
      };
    }

    const currentVehicleFieldMapping = buildCurrentVehicleFieldMapping(provider);
    const supplemental = await fetchSupplementalFeeds(
      provider,
      auth.token || null,
      authMetadata
    );
    let sample_normalized = null;
    let syncedCount = 0;
    let skippedMissingIdentifier = 0;
    let capabilityRowsProcessed = 0;
    let crossProviderAssetMatches = 0;
    let capabilityUpgradesApplied = 0;
    const capabilityCounts: Record<string, number> = {};
    const placeholderZeroSignalCounts: Record<string, number> = {};
    const meaningfulSignalCounts: Record<string, number> = {};
    const errors: string[] = [];
    const matchedVehicleRowKeys = new Set<string>();
    const unmatchedVehicleRowKeys = new Set<string>();
    const vehicleMatchReviewKeys = new Set<string>();
    const vehicleMatchReviewRows: ProviderVehicleMatchReviewRow[] = [];
    let needsReviewVehicleRows = 0;
    let vehicleMatchReviewTruncated = false;
    const crossProviderAssetMatchSamples: SyncResult["cross_provider_asset_match_samples"] = [];
    const providerAssetLookup = await loadProviderAssetLookup(provider.company_id);

    for (const rawVehicle of fleet.vehicles) {
      try {
        const normalized = normalizeVehicle(
          rawVehicle,
          currentVehicleFieldMapping,
          provider.provider_name,
          providerCapabilityProfile
        );

        if (normalized.validation.missing_fields.includes("truck_id")) {
          skippedMissingIdentifier++;
          needsReviewVehicleRows++;
          addVehicleMatchReviewRow(
            vehicleMatchReviewRows,
            vehicleMatchReviewKeys,
            {
              provider_vehicle_label: "Vehicle identifier missing",
              matched_truck_id: null,
              match_source: "missing_vehicle_identifier",
              confidence: "needs_review",
              status: "needs_review",
            }
          );
          if (vehicleMatchReviewRows.length >= VEHICLE_MATCH_REVIEW_LIMIT) {
            vehicleMatchReviewTruncated = true;
          }
          continue;
        }

        mergeSupplementalData(
          normalized,
          rawVehicle,
          currentVehicleFieldMapping,
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
        for (const signal of normalized.signal_quality?.meaningful_signals || []) {
          meaningfulSignalCounts[signal] = (meaningfulSignalCounts[signal] || 0) + 1;
        }

        const existingAsset = findProviderAssetMatch(
          providerAssetLookup,
          provider.id,
          normalized.truck_id
        );
        const crossProviderAsset = existingAsset
          ? null
          : findCrossProviderAssetMatch(
              providerAssetLookup,
              provider.id,
              normalized.truck_id
            );
        const currentVehicleMatchKey = normalizeDistanceTruckKey(normalized.truck_id);
        if ((existingAsset || crossProviderAsset) && currentVehicleMatchKey) {
          matchedVehicleRowKeys.add(currentVehicleMatchKey);
        } else if (currentVehicleMatchKey) {
          unmatchedVehicleRowKeys.add(currentVehicleMatchKey);
        }
        const matchedAsset = existingAsset || crossProviderAsset;
        const reviewAdded = addVehicleMatchReviewRow(
          vehicleMatchReviewRows,
          vehicleMatchReviewKeys,
          {
            provider_vehicle_label: normalized.provider_label || normalized.truck_id,
            matched_truck_id: matchedAsset
              ? matchedAsset.truck_id || matchedAsset.registration || null
              : null,
            match_source: existingAsset
              ? "same_provider_registration_match"
              : crossProviderAsset
                ? "cross_provider_registration_match"
                : "no_existing_asset_match",
            confidence: matchedAsset ? "high" : "needs_review",
            status: matchedAsset ? "matched" : "unmatched",
          }
        );
        if (!reviewAdded && vehicleMatchReviewRows.length >= VEHICLE_MATCH_REVIEW_LIMIT) {
          vehicleMatchReviewTruncated = true;
        }

        const providerTimestampTrusted =
          normalized.timestamp_quality?.status === "valid";
        const assetPayload: Record<string, any> = {
          provider_id: provider.id,
          provider_name: provider.provider_name,
          company_id: provider.company_id,
          truck_id: normalized.truck_id,
          registration: normalized.truck_id,
          status: "active",                              // 🔥 needed for dashboard filtering
          latitude: normalized.latitude,
          longitude: normalized.longitude,
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
        if (providerTimestampTrusted) {
          assetPayload.last_seen_at = normalized.recorded_at;
        } else if (
          !existingAsset ||
          isSuspiciousProviderTimestamp(existingAsset.last_seen_at)
        ) {
          assetPayload.last_seen_at = null;
        }

        if (!existingAsset && !crossProviderAsset) {
          assetPayload.asset_category = normalized.attached_trailer_plate ? "truck" : "unknown";
          assetPayload.billing_status = "unreviewed";
          assetPayload.intelligence_enabled = false;
          assetPayload.first_seen_at = new Date().toISOString();
        }

        if (normalized.location_label) {
          assetPayload.provider_location_label = normalized.location_label;
        }

        // ✅ Upsert telemetry fields only; reviewed billing/classification fields are not overwritten.
        if (crossProviderAsset) {
          crossProviderAssetMatches++;
          if (crossProviderAssetMatchSamples.length < 10) {
            crossProviderAssetMatchSamples.push({
              truck_id: normalized.truck_id,
              existing_provider_name: crossProviderAsset.provider_name || null,
              incoming_provider_name: provider.provider_name || null,
            });
          }

          const upgradeResult = await maybeUpgradeCanonicalAssetCapability(
            crossProviderAsset,
            normalized,
            provider.company_id
          );
          if (upgradeResult.error) {
            errors.push(upgradeResult.error);
          } else if (upgradeResult.upgraded) {
            capabilityUpgradesApplied++;
          }
        } else {
          const assetError = existingAsset?.id
            ? await updateFleetAssetByIdWithCapabilityFallback(
                existingAsset.id,
                assetPayload,
                provider.company_id
              )
            : await upsertFleetAssetWithCapabilityFallback(assetPayload);

          if (assetError) throw new Error(`Asset registry write failed: ${assetError.message}`);

          if (!existingAsset) {
            const insertedAsset = await loadProviderAssetByExactTruckId(
              provider.id,
              provider.company_id,
              normalized.truck_id
            );
            if (insertedAsset) providerAssetLookup.push(insertedAsset);
          }
        }

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
      providerCapabilityProfile,
      supplemental.diagnostics,
      {
        write: options.writeDistanceSummaries !== false,
      }
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
      matched_vehicle_rows: Math.min(matchedVehicleRowKeys.size, syncedCount),
      vehicle_match_review: {
        total_rows: fleet.vehicles.length,
        matched_rows: Math.min(matchedVehicleRowKeys.size, syncedCount),
        unmatched_rows: unmatchedVehicleRowKeys.size,
        needs_review_rows: needsReviewVehicleRows,
        rows: vehicleMatchReviewRows,
        truncated: vehicleMatchReviewTruncated,
      },
      cross_provider_asset_matches: crossProviderAssetMatches,
      cross_provider_asset_match_samples: crossProviderAssetMatchSamples,
      capability_upgrades_applied: capabilityUpgradesApplied,
      sample_normalized,
      supplemental_diagnostics: supplemental.diagnostics,
      capability_summary: buildCapabilitySummary({
        rows_processed: capabilityRowsProcessed,
        capability_counts: capabilityCounts,
        placeholder_zero_signal_counts: placeholderZeroSignalCounts,
        meaningful_signal_counts: meaningfulSignalCounts,
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
          meaningful_signal_counts: meaningfulSignalCounts,
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

export async function runProviderDataDiscovery(
  provider: ProviderRecord,
  options: { candidateEndpoints?: ProviderDiscoveryEndpointInput[] } = {}
): Promise<ProviderDataDiscoveryDiagnostics> {
  const endpoints = buildProviderDiscoveryEndpoints(
    provider,
    options.candidateEndpoints || []
  );
  const setupBlockers: string[] = [];
  const diagnostics: ProviderDataDiscoveryDiagnostics = {
    endpoints_configured: endpoints.length,
    endpoints_attempted: 0,
    endpoints_succeeded: 0,
    useful_fields_detected: [],
    setup_blockers: setupBlockers,
    endpoints: [],
  };

  if (endpoints.length === 0) {
    setupBlockers.push(buildNoAdditionalReportEndpointMessage(provider));
    return diagnostics;
  }

  const primaryAuth = await authenticateProvider(provider);
  if (!primaryAuth.success) {
    setupBlockers.push(
      sanitizeDiagnosticMessage(
        primaryAuth.message || "Provider authentication failed"
      )
    );
    diagnostics.endpoints = endpoints.map((endpoint) =>
      buildSkippedDiscoveryEndpoint(endpoint, "Saved provider authentication failed")
    );
    return diagnostics;
  }

  const primaryAuthMetadata = primaryAuth.metadata || {};
  const supplementalProfileCache = new Map<string, Promise<AuthResult>>();
  const usefulFields = new Set<string>();

  for (const endpoint of endpoints) {
    diagnostics.endpoints_attempted++;
    const endpointDiagnostic = await testProviderDiscoveryEndpoint(
      provider,
      endpoint,
      primaryAuth.token || null,
      primaryAuthMetadata,
      supplementalProfileCache
    );
    diagnostics.endpoints.push(endpointDiagnostic);

    if (endpointDiagnostic.success) diagnostics.endpoints_succeeded++;
    for (const field of endpointDiagnostic.detected_useful_fields || []) {
      usefulFields.add(field);
    }
    if (endpointDiagnostic.setup_blocker) {
      setupBlockers.push(endpointDiagnostic.setup_blocker);
    }
  }

  const hasAdditionalReportEndpoint = endpoints.some(
    (endpoint) =>
      endpoint.source !== "configured_primary" &&
      (isDistanceSummaryFeed(endpoint.supplementalConfig || ({} as any)) ||
        endpoint.source === "candidate")
  );

  if (!hasAdditionalReportEndpoint) {
    setupBlockers.push(buildNoAdditionalReportEndpointMessage(provider));
  }

  diagnostics.useful_fields_detected = Array.from(usefulFields).slice(0, 50);
  diagnostics.setup_blockers = Array.from(new Set(setupBlockers)).slice(0, 8);
  return diagnostics;
}

export async function executeProviderRequest(
  provider: ProviderRecord,
  feedConfig: ProviderFeedExecutionConfig,
  options: {
    authContext?: SupplementalAuthContext;
    requireRows?: boolean;
    fallbackAuthMetadata?: AuthMetadata;
  } = {}
): Promise<ProviderRequestExecutionResult> {
  const feedName = feedConfig.name || "provider_feed";
  const feedType = feedConfig.feed_type || "current_vehicles";
  let authContext = options.authContext;

  if (!authContext) {
    const auth = await authenticateProvider(provider);
    if (!auth.success) {
      return {
        success: false,
        feed_name: feedName,
        feed_type: feedType,
        failure_stage: "auth",
        message: plainProviderFailureMessage(auth.message || "Provider sign-in failed"),
        setup_blocker: plainProviderFailureMessage(auth.message || "Provider sign-in failed"),
        rows: [],
        data: null,
      };
    }

    authContext = {
      token: auth.token || null,
      metadata: auth.metadata || {},
      fallbackMetadata: options.fallbackAuthMetadata || {},
      authType: (provider.auth_type || "POST_LOGIN").toUpperCase(),
      profileName: null,
    };
  }

  const method = normalizeDiscoveryMethod(feedConfig.method || "GET");
  const renderedUrlResult = renderTemplateValue(feedConfig.url, {
    provider,
    token: authContext.token,
    authMetadata: authContext.metadata,
    fallbackAuthMetadata: authContext.fallbackMetadata || {},
    credentialOverrides: {},
    now: new Date(),
  });
  const renderedUrl = String(renderedUrlResult.value || feedConfig.url || "");
  const payloadResult = buildPayloadWithDiagnostics(
    feedConfig.payload || {},
    provider,
    authContext.token,
    authContext.metadata,
    authContext.fallbackMetadata || {}
  );

  if (
    renderedUrlResult.missingMacros.length > 0 ||
    renderedUrlResult.unknownMacros.length > 0 ||
    payloadResult.missingMacros.length > 0 ||
    payloadResult.unknownMacros.length > 0
  ) {
    const macros = [
      ...renderedUrlResult.missingMacros,
      ...renderedUrlResult.unknownMacros,
      ...payloadResult.missingMacros,
      ...payloadResult.unknownMacros,
    ];
    const message = `Provider feed setup is missing required value(s): ${Array.from(new Set(macros)).join(", ")}`;
    return {
      success: false,
      feed_name: feedName,
      feed_type: feedType,
      failure_stage: "request",
      message,
      setup_blocker: sanitizeDiagnosticMessage(message),
      rows: [],
      data: null,
      effective_url_masked: maskUrlToken(renderedUrl, authContext.token),
    };
  }

  const headers = buildProviderExecutionHeaders(provider, feedConfig, authContext);
  const requestUrl = applyProviderTokenPlacementToUrl(
    renderedUrl,
    feedConfig.token_placement,
    authContext.token
  );
  const unresolvedUrlPlaceholder = findUnresolvedUrlPlaceholder(requestUrl);
  if (unresolvedUrlPlaceholder) {
    const message = `Provider endpoint still has an unresolved placeholder: ${unresolvedUrlPlaceholder}. Set a value before testing.`;
    return {
      success: false,
      feed_name: feedName,
      feed_type: feedType,
      failure_stage: "request",
      message,
      setup_blocker: message,
      rows: [],
      data: null,
      effective_url_masked: maskUrlToken(requestUrl, authContext.token),
    };
  }
  const requestHeaders = withJsonContentType(headers);
  const requestDiagnostics = buildSupplementalRequestDiagnostics(
    requestUrl,
    method,
    requestHeaders,
    payloadResult.value || {}
  );
  const rowPaths =
    Array.isArray(feedConfig.row_paths) && feedConfig.row_paths.length > 0
      ? dedupeRowPaths(feedConfig.row_paths)
      : feedType === "current_vehicles"
        ? defaultVehiclePaths()
        : defaultSupplementalVehiclePaths();

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method,
      headers: requestHeaders,
      body: method === "GET" ? undefined : JSON.stringify(payloadResult.value || {}),
      cache: "no-store",
    });
  } catch (err: any) {
    const message = plainProviderFailureMessage(err?.message || "Provider endpoint request failed");
    return {
      success: false,
      feed_name: feedName,
      feed_type: feedType,
      failure_stage: "feed",
      message,
      setup_blocker: message,
      rows: [],
      data: null,
      request_diagnostics: requestDiagnostics,
      effective_url_masked: maskUrlToken(requestUrl, authContext.token),
    };
  }

  const { data, responseType } = await readSafeSupplementalResponse(response);
  const responseDiagnostics = buildSupplementalResponseDiagnostics(
    data,
    response.status,
    responseType,
    rowPaths
  );
  const rows = getRowsByPaths(data, rowPaths);
  const effectiveUrlMasked = maskUrlToken(requestUrl, authContext.token);

  if (!response.ok) {
    const message = plainProviderHttpFailure(feedType, response.status);
    return {
      success: false,
      feed_name: feedName,
      feed_type: feedType,
      failure_stage: "feed",
      message,
      setup_blocker: message,
      http_status: response.status,
      response_type: responseType,
      content_type: response.headers.get("content-type"),
      rows,
      data,
      request_diagnostics: requestDiagnostics,
      response_diagnostics: responseDiagnostics,
      effective_url_masked: effectiveUrlMasked,
    };
  }

  const requireRows = options.requireRows ?? feedConfig.require_rows ?? false;
  if (requireRows && rows.length === 0) {
    const message =
      feedType === "current_vehicles"
        ? buildVehicleRowsNotFoundMessage(rowPaths, responseDiagnostics)
        : "No report rows found. Check report parameters and row path.";
    return {
      success: false,
      feed_name: feedName,
      feed_type: feedType,
      failure_stage: "rows",
      message,
      setup_blocker: message,
      http_status: response.status,
      response_type: responseType,
      content_type: response.headers.get("content-type"),
      rows,
      data,
      request_diagnostics: requestDiagnostics,
      response_diagnostics: responseDiagnostics,
      effective_url_masked: effectiveUrlMasked,
    };
  }

  return {
    success: true,
    feed_name: feedName,
    feed_type: feedType,
    http_status: response.status,
    response_type: responseType,
    content_type: response.headers.get("content-type"),
    rows,
    data,
    request_diagnostics: requestDiagnostics,
    response_diagnostics: responseDiagnostics,
    effective_url_masked: effectiveUrlMasked,
  };
}

function buildVehicleRowsNotFoundMessage(
  rowPaths: string[],
  responseDiagnostics: SupplementalResponseDiagnostics
) {
  const configuredPaths = dedupeRowPaths(rowPaths);
  const configured =
    configuredPaths.length > 0 ? configuredPaths.join(", ") : "not set";
  const alternatives = Object.entries(
    responseDiagnostics.first_array_paths_found || {}
  )
    .filter(([path, count]) => {
      const normalizedPath = normalizeProviderRowPath(path);
      return (
        Number(count || 0) > 0 &&
        !configuredPaths.includes(normalizedPath)
      );
    })
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 4)
    .map(([path, count]) => `${normalizeProviderRowPath(path)} (${Number(count || 0)} rows)`);

  return alternatives.length > 0
    ? `Configured row path ${configured} did not resolve to vehicle rows. Safe discovered alternatives: ${alternatives.join(", ")}.`
    : `Configured row path ${configured} did not resolve to vehicle rows.`;
}

type ProviderDiscoveryEndpointConfig = {
  name: string;
  source: ProviderDataDiscoveryEndpointDiagnostics["endpoint_source"];
  url: string;
  method: string;
  rowPaths: string[];
  headers?: Record<string, any>;
  payload?: Record<string, any>;
  apiKeyHeader?: string;
  tokenPlacement?: string;
  supplementalConfig?: SupplementalFeedConfig;
};

function buildProviderDiscoveryEndpoints(
  provider: ProviderRecord,
  candidateEndpoints: ProviderDiscoveryEndpointInput[]
): ProviderDiscoveryEndpointConfig[] {
  const endpoints: ProviderDiscoveryEndpointConfig[] = [];
  const currentFeed = provider.fleet_config?.current_vehicle_feed || {};
  const fleetUrl =
    currentFeed.endpoint_url ||
    provider.fleet_url ||
    provider.fleet_config?.fleet_url ||
    provider.default_fleet_url;

  if (fleetUrl) {
    endpoints.push({
      name: "Configured current/fleet endpoint",
      source: "configured_primary",
      url: String(fleetUrl),
      method: String(currentFeed.method || provider.fleet_config?.method || "POST").toUpperCase(),
      rowPaths: buildDiscoveryCandidateRowPaths(
        buildCurrentVehicleRowPaths(provider)
      ),
      headers: currentFeed.headers || provider.fleet_config?.headers || {},
      payload: currentFeed.payload || provider.fleet_config?.payload || {},
      apiKeyHeader: currentFeed.api_key_header || provider.fleet_config?.api_key_header,
      tokenPlacement: currentFeed.token_placement || provider.fleet_config?.token_placement,
    });
  }

  for (const feed of getSupplementalFeedConfigs(provider)) {
    endpoints.push({
      name: `Configured ${feed.name}`,
      source: "configured_supplemental",
      url: feed.url,
      method: String(feed.method || "GET").toUpperCase(),
      rowPaths: buildDiscoveryCandidateRowPaths(
        feed.vehicle_paths || defaultSupplementalVehiclePaths()
      ),
      headers: feed.headers || {},
      payload: feed.payload || {},
      apiKeyHeader: feed.api_key_header,
      supplementalConfig: feed,
    });
  }

  for (const candidate of candidateEndpoints) {
    const url = String(candidate.url || "").trim();
    if (!url) continue;
    endpoints.push({
      name: String(candidate.name || "Candidate report endpoint").slice(0, 80),
      source: "candidate",
      url,
      method: normalizeDiscoveryMethod(candidate.method),
      rowPaths: buildDiscoveryCandidateRowPaths(candidate.row_paths || []),
      headers: {},
      payload: {},
    });
  }

  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.source}:${endpoint.method}:${endpoint.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDiscoveryCandidateRowPaths(paths: any) {
  const configured = Array.isArray(paths) ? dedupeRowPaths(paths) : [];
  return dedupeRowPaths([
      ...configured,
      ...defaultSupplementalVehiclePaths(),
      "reports",
      "trips",
      "records",
      "data.reports",
      "data.trips",
      "data.records",
      "result.reports",
      "result.trips",
      "result.records",
    ]).slice(0, 40);
}

function buildCurrentVehicleRowPaths(provider: ProviderRecord) {
  const config = provider.fleet_config || {};
  const currentFeed = config.current_vehicle_feed || {};
  const paths = [
    currentFeed.row_path,
    ...(Array.isArray(currentFeed.row_paths) ? currentFeed.row_paths : []),
    ...(Array.isArray(config.vehicle_paths) ? config.vehicle_paths : []),
    config.data_group,
  ];
  const normalizedPaths = dedupeRowPaths(paths);

  return normalizedPaths.length > 0 ? normalizedPaths : defaultVehiclePaths();
}

function buildCurrentVehicleFieldMapping(provider: ProviderRecord) {
  const config = provider.fleet_config || {};
  const currentFeed = config.current_vehicle_feed || {};
  const rowPath = buildCurrentVehicleRowPaths(provider)[0] || "$";
  const feedMapping =
    currentFeed.mapping && typeof currentFeed.mapping === "object"
      ? currentFeed.mapping
      : {};
  const topLevelMapping =
    provider.field_mapping && typeof provider.field_mapping === "object"
      ? provider.field_mapping
      : {};
  const rawMapping =
    Object.keys(topLevelMapping).length > 0
      ? { ...feedMapping, ...topLevelMapping }
      : feedMapping;

  return normalizeFieldMappingsRelativeToRow(rawMapping, rowPath);
}

function normalizeProviderRowPath(value: any) {
  return normalizeRowPath(value);
}

function toDisplayJsonPath(path: string) {
  const normalized = normalizeProviderRowPath(path);
  if (!normalized || normalized === "$") return "$";
  if (normalized.startsWith("$.")) return normalized;
  return `$.${normalized}`;
}

function buildSkippedDiscoveryEndpoint(
  endpoint: ProviderDiscoveryEndpointConfig,
  reason: string
): ProviderDataDiscoveryEndpointDiagnostics {
  return {
    name: endpoint.name,
    endpoint_source: endpoint.source,
    endpoint_tested: sanitizeDiscoveryUrl(endpoint.url),
    auth_used: "saved provider auth",
    success: false,
    top_level_keys: [],
    candidate_row_paths: endpoint.rowPaths,
    candidate_row_paths_found: {},
    detected_useful_fields: [],
    sanitized_sample_shape: null,
    rows_detected: 0,
    setup_blocker: sanitizeDiagnosticMessage(reason),
  };
}

async function testProviderDiscoveryEndpoint(
  provider: ProviderRecord,
  endpoint: ProviderDiscoveryEndpointConfig,
  primaryToken: string | null,
  primaryMetadata: AuthMetadata,
  profileCache: Map<string, Promise<AuthResult>>
): Promise<ProviderDataDiscoveryEndpointDiagnostics> {
  const baseDiagnostic: ProviderDataDiscoveryEndpointDiagnostics = {
    name: endpoint.name,
    endpoint_source: endpoint.source,
    endpoint_tested: sanitizeDiscoveryUrl(endpoint.url),
    auth_used: describeDiscoveryAuth(provider, endpoint),
    success: false,
    top_level_keys: [],
    candidate_row_paths: endpoint.rowPaths,
    candidate_row_paths_found: {},
    detected_useful_fields: [],
    sanitized_sample_shape: null,
    rows_detected: 0,
  };

  const validationError = validateSafeDiscoveryUrl(endpoint.url);
  if (validationError) {
    return {
      ...baseDiagnostic,
      setup_blocker: validationError,
      error: validationError,
    };
  }

  let authContext: SupplementalAuthContext = {
    token: primaryToken,
    metadata: primaryMetadata,
    fallbackMetadata: {},
    authType: (provider.auth_type || "POST_LOGIN").toUpperCase(),
    profileName: null,
  };

  if (endpoint.supplementalConfig) {
    const supplementalAuth = await resolveSupplementalAuthContext(
      provider,
      endpoint.supplementalConfig,
      primaryToken,
      primaryMetadata,
      profileCache
    );

    if (!supplementalAuth) {
      return {
        ...baseDiagnostic,
        setup_blocker:
          "Configured supplemental auth profile did not return a usable token.",
        error: "Supplemental auth failed",
      };
    }

    authContext = supplementalAuth;
  }

  const renderedUrl = String(
    renderTemplateValue(endpoint.url, {
      provider,
      token: authContext.token,
      authMetadata: authContext.metadata,
      fallbackAuthMetadata: authContext.fallbackMetadata,
      credentialOverrides: {},
      now: new Date(),
    }).value || endpoint.url
  );
  const renderedUrlValidationError = validateSafeDiscoveryUrl(renderedUrl);
  if (renderedUrlValidationError) {
    return {
      ...baseDiagnostic,
      endpoint_tested: sanitizeDiscoveryUrl(renderedUrl),
      setup_blocker: renderedUrlValidationError,
      error: renderedUrlValidationError,
    };
  }

  const payloadResult = buildPayloadWithDiagnostics(
    endpoint.payload || {},
    provider,
    authContext.token,
    authContext.metadata,
    authContext.fallbackMetadata
  );
  if (
    payloadResult.missingMacros.length > 0 ||
    payloadResult.unknownMacros.length > 0
  ) {
    const macroMessage =
      payloadResult.unknownMacros.length > 0
        ? `Unknown template macro(s): ${payloadResult.unknownMacros.join(", ")}`
        : `Missing required template macro(s): ${payloadResult.missingMacros.join(", ")}`;
    return {
      ...baseDiagnostic,
      endpoint_tested: sanitizeDiscoveryUrl(renderedUrl),
      setup_blocker: sanitizeDiagnosticMessage(macroMessage),
      error: sanitizeDiagnosticMessage(macroMessage),
    };
  }

  try {
    const execution = await executeProviderRequest(
      provider,
      {
        name: endpoint.name,
        feed_type: endpoint.supplementalConfig?.feed_type || "discovery",
        url: renderedUrl,
        method: endpoint.method,
        headers: endpoint.headers || {},
        payload: payloadResult.value || {},
        row_paths: endpoint.rowPaths,
        token_placement: endpoint.tokenPlacement,
        api_key_header: endpoint.apiKeyHeader,
      },
      { authContext }
    );
    const rowPaths = endpoint.rowPaths;
    const rows = execution.rows;
    const usefulFields = detectUsefulDiscoveryFields(execution.data, rows);
    const fieldMappingSuggestions = buildDiscoveryFieldMappingSuggestions(rows);
    const blocker = buildDiscoverySetupBlocker({
      httpStatus: execution.http_status || 0,
      responseType: execution.response_type || "error",
      rowsDetected: rows.length,
      usefulFields,
      endpoint,
    });

    return {
      ...baseDiagnostic,
      endpoint_tested: sanitizeDiscoveryUrl(execution.effective_url_masked || renderedUrl),
      http_status: execution.http_status,
      success: execution.success,
      response_type: execution.response_type,
      content_type: execution.content_type,
      top_level_keys: collectTopLevelKeys(execution.data),
      candidate_row_paths_found: collectArrayPathCounts(execution.data),
      detected_useful_fields: usefulFields,
      field_mapping_suggestions: fieldMappingSuggestions,
      sanitized_sample_shape: buildSanitizedSampleShape(rows[0] || execution.data),
      rows_detected: rows.length,
      setup_blocker: blocker || execution.setup_blocker,
    };
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? "Endpoint timed out during safe discovery."
        : sanitizeDiagnosticMessage(err?.message || "Endpoint discovery failed");
    return {
      ...baseDiagnostic,
      endpoint_tested: sanitizeDiscoveryUrl(renderedUrl),
      setup_blocker: message,
      error: message,
    };
  }
}

function buildDiscoveryHeaders(
  provider: ProviderRecord,
  endpoint: ProviderDiscoveryEndpointConfig,
  authContext: SupplementalAuthContext
) {
  const headers = buildHeaders(
    endpoint.headers || {},
    provider,
    authContext.token,
    authContext.metadata,
    authContext.fallbackMetadata
  );
  const token = authContext.token;
  if (!token) return headers;
  if (/\{\{\s*(token|access_token|user_api_hash)\s*\}\}/i.test(endpoint.url)) {
    return headers;
  }

  if (endpoint.supplementalConfig) {
    if (authContext.authType === "API_KEY") {
      headers[
        endpoint.apiKeyHeader ||
          provider.fleet_config?.api_key_header ||
          "x-api-key"
      ] = token;
    } else if (authContext.authType === "BASIC_AUTH") {
      headers.Authorization = `Basic ${token}`;
    } else {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const tokenPlacement = String(endpoint.tokenPlacement || "").toLowerCase();
  if (
    tokenPlacement === "query_user_api_hash" ||
    tokenPlacement === "query_token" ||
    tokenPlacement === "none"
  ) {
    return headers;
  }
  if (tokenPlacement === "x_api_key") {
    headers[endpoint.apiKeyHeader || "X-API-Key"] = token;
  } else if (tokenPlacement === "authorization_bearer") {
    headers.Authorization = `Bearer ${token}`;
  } else if (authType === "API_KEY") {
    headers[endpoint.apiKeyHeader || "x-api-key"] = token;
  } else if (authType === "BASIC_AUTH") {
    headers.Authorization = `Basic ${token}`;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildProviderExecutionHeaders(
  provider: ProviderRecord,
  feedConfig: ProviderFeedExecutionConfig,
  authContext: SupplementalAuthContext
) {
  const headers = buildHeaders(
    feedConfig.headers || {},
    provider,
    authContext.token,
    authContext.metadata,
    authContext.fallbackMetadata || {}
  );
  const token = authContext.token;
  if (!token) return headers;

  const tokenPlacement = String(feedConfig.token_placement || "").toLowerCase();
  const rawUrl = String(feedConfig.url || "");
  if (
    tokenPlacement === "query_user_api_hash" ||
    tokenPlacement === "query_token" ||
    tokenPlacement === "none" ||
    /\{\{\s*(token|access_token|user_api_hash|api_key|hash)\s*\}\}/i.test(rawUrl)
  ) {
    return headers;
  }

  if (tokenPlacement === "x_api_key") {
    headers[feedConfig.api_key_header || "X-API-Key"] = token;
  } else if (tokenPlacement === "authorization_bearer") {
    headers.Authorization = `Bearer ${token}`;
  } else if (authContext.authType === "API_KEY") {
    headers[feedConfig.api_key_header || "x-api-key"] = token;
  } else if (authContext.authType === "BASIC_AUTH") {
    headers.Authorization = `Basic ${token}`;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function applyProviderTokenPlacementToUrl(
  rawUrl: string,
  tokenPlacement: any,
  token: string | null
) {
  if (!token) return rawUrl;
  const placement = String(tokenPlacement || "").toLowerCase();
  if (placement === "query_user_api_hash") {
    return appendPayloadToUrl(rawUrl, { user_api_hash: token });
  }
  if (placement === "query_token") {
    return appendPayloadToUrl(rawUrl, { token });
  }
  return rawUrl;
}

function plainProviderHttpFailure(feedType: string, status: number) {
  const normalized = normalizeProviderKey(feedType || "");
  if (status === 401 || status === 403) {
    if (normalized.includes("current") || normalized.includes("vehicle")) {
      return "Provider sign-in worked, but the vehicle endpoint rejected access. Check token placement or vehicle endpoint parameters.";
    }
    if (
      normalized.includes("report") ||
      normalized.includes("trip") ||
      normalized.includes("distance")
    ) {
      return "Report endpoint rejected access or parameters. Check token placement, date range, report type, vehicle id, and row path.";
    }
    return "Provider endpoint rejected access. Check token placement and endpoint parameters.";
  }
  if (status >= 400) {
    if (
      normalized.includes("report") ||
      normalized.includes("trip") ||
      normalized.includes("distance")
    ) {
      return "Report endpoint rejected parameters. Ask the provider for get_reports date range, report type, vehicle id, row path, and sample JSON.";
    }
    return "Provider endpoint rejected the request. Check the endpoint URL and request shape.";
  }
  return "Provider endpoint did not return usable data.";
}

function plainProviderFailureMessage(message: string) {
  const text = String(message || "").toLowerCase();
  if (text.includes("token") && (text.includes("not found") || text.includes("no token"))) {
    return "Access token not found. Ask the provider which token or hash field is returned after login.";
  }
  if (text.includes("login") || text.includes("auth") || text.includes("credential")) {
    return "Sign-in failed. Check username/password and the provider login request shape.";
  }
  if (text.includes("vehicle rows") || text.includes("row path")) {
    return "No vehicle rows found. Check the vehicle endpoint and row path.";
  }
  return sanitizeDiagnosticMessage(message || "Provider connection failed");
}

async function fetchDiscoveryResponse(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: stripUnsafeDiscoveryHeaders(init.headers),
      body: init.body,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    const { text, truncated } = await readDiscoveryText(response, 200_000);
    const parsed = parseDiscoveryResponseText(text, response);
    return {
      ok: response.ok,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      bodyTruncated: truncated,
      ...parsed,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readDiscoveryText(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return {
      text: text.slice(0, maxBytes),
      truncated: text.length > maxBytes,
    };
  }

  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      truncated = true;
      const remaining = Math.max(0, maxBytes - (received - value.byteLength));
      if (remaining > 0) text += decoder.decode(value.slice(0, remaining));
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { text, truncated };
}

function parseDiscoveryResponseText(text: string, response: Response): {
  data: any;
  responseType: SupplementalResponseDiagnostics["response_type"];
} {
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

function stripUnsafeDiscoveryHeaders(headers: Record<string, string>) {
  const blocked = new Set([
    "host",
    "cookie",
    "set-cookie",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "forwarded",
  ]);

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !blocked.has(key.toLowerCase())
    )
  );
}

function normalizeDiscoveryMethod(method: any) {
  const value = String(method || "GET").toUpperCase();
  return value === "POST" ? "POST" : "GET";
}

function detectUsefulDiscoveryFields(data: any, rows: any[]) {
  const source = rows.length > 0 ? rows.slice(0, 3) : data;
  const keys = new Map<string, string>();
  collectSafeKeyNames(source, keys, 0);

  const detected: string[] = [];
  for (const field of DISCOVERY_USEFUL_FIELD_ALIASES) {
    const match = field.aliases.find((alias) =>
      keys.has(normalizeProviderKey(alias))
    );
    if (match) {
      const originalKey = keys.get(normalizeProviderKey(match));
      detected.push(originalKey ? `${field.label}: ${originalKey}` : field.label);
    }
  }

  return detected.slice(0, 50);
}

function buildDiscoveryFieldMappingSuggestions(rows: any[]) {
  const source = rows.length > 0 ? rows.slice(0, 3) : [];
  const keys = new Map<string, string>();
  collectSafeKeyNames(source, keys, 0);

  const mappingTargets: Array<{ target: string; aliases: string[] }> = [
    {
      target: "truck",
      aliases: ["vehicle", "truck", "truck_id", "reg", "reg_no", "registration", "plate", "unit_id"],
    },
    { target: "latitude", aliases: ["latitude", "lat", "gps_lat", "y"] },
    { target: "longitude", aliases: ["longitude", "lng", "lon", "gps_lng", "gps_lon", "x"] },
    { target: "speed", aliases: ["speed", "velocity", "kph", "speed_kph"] },
    {
      target: "recorded_at",
      aliases: ["timestamp", "time", "fixtime", "currenttime", "current_time", "recorded_at", "gps_time"],
    },
    {
      target: "location_label",
      aliases: ["location", "currentlocation", "address", "place", "label"],
    },
    { target: "driver", aliases: ["driver", "drivername", "driver_name"] },
    { target: "ignition_on", aliases: ["ignition", "ignition_on", "acc", "accstatus", "engine_on"] },
    { target: "engine_rpm", aliases: ["rpm", "engine_rpm", "enginerpm"] },
    { target: "fuel_level", aliases: ["fuel", "fuellevel", "currentfuellevel", "fuel_level"] },
  ];

  const suggestions: Record<string, string> = {};
  for (const field of mappingTargets) {
    const match = field.aliases.find((alias) =>
      keys.has(normalizeProviderKey(alias))
    );
    if (match) {
      const originalKey = keys.get(normalizeProviderKey(match));
      if (originalKey) suggestions[field.target] = originalKey;
    }
  }

  return suggestions;
}

function buildSanitizedSampleShape(value: any, depth = 0): any {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value === null ? "null" : "undefined";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "array(empty)"
      : [`array(${value.length})`, buildSanitizedSampleShape(value[0], depth + 1)];
  }
  if (typeof value !== "object") return typeof value;

  const output: Record<string, any> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 30)) {
    const normalized = normalizeProviderKey(key);
    if (!normalized || isSensitiveProviderKey(normalized)) continue;
    output[key] = buildSanitizedSampleShape(nested, depth + 1);
  }
  return output;
}

function buildDiscoverySetupBlocker(input: {
  httpStatus: number;
  responseType: SupplementalResponseDiagnostics["response_type"];
  rowsDetected: number;
  usefulFields: string[];
  endpoint: ProviderDiscoveryEndpointConfig;
}) {
  if (input.httpStatus === 401 || input.httpStatus === 403) {
    return "Provider rejected this endpoint. Confirm the auth method, token placement, and report API access.";
  }
  if (input.httpStatus >= 400) {
    return `Endpoint returned HTTP ${input.httpStatus}. Confirm the report URL and required request shape.`;
  }
  if (input.responseType === "html") {
    return "Endpoint returned HTML, not a provider API response. Confirm this is an API URL, not a web page.";
  }
  if (input.responseType === "text" || input.responseType === "error") {
    return "Endpoint did not return readable JSON. Ask the provider for the JSON report endpoint and sample response.";
  }
  if (input.rowsDetected === 0) {
    return "No vehicle/report row array was detected. Confirm the row path or ask the provider for the report response sample.";
  }
  if (input.usefulFields.length === 0) {
    return "Rows were detected, but no useful telemetry or report fields were found from safe key names.";
  }
  return undefined;
}

function validateSafeDiscoveryUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Endpoint URL is invalid.";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP or HTTPS provider API URLs can be tested.";
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    return "HTTPS is required for provider discovery in production.";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrInternalDiscoveryHost(hostname)) {
    return "Private, local, link-local, or metadata endpoints cannot be tested.";
  }

  return null;
}

function isPrivateOrInternalDiscoveryHost(hostname: string) {
  if (!hostname) return true;
  const trimmed = hostname.replace(/^\[|\]$/g, "");
  if (
    trimmed === "localhost" ||
    trimmed.endsWith(".localhost") ||
    trimmed.endsWith(".local") ||
    trimmed === "::1" ||
    trimmed === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    const parts = trimmed.split(".").map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  return !trimmed.includes(".");
}

function sanitizeDiscoveryUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalized = normalizeProviderKey(key);
      const value = parsed.searchParams.get(key) || "";
      parsed.searchParams.set(
        key,
        isSensitiveProviderKey(normalized) || normalized.includes("hash")
          ? "[redacted]"
          : safeDisplayQueryValue(value)
      );
    }
    return parsed.toString().replace(/%5B(redacted|set)%5D/gi, "[$1]");
  } catch {
    return String(rawUrl || "")
      .replace(
        /([?&](?:token|access_token|user_api_hash|api_key|apikey|hash|jwt|bearer)=)[^&\s]+/gi,
        "$1[redacted]"
      )
      .slice(0, 120);
  }
}

function safeDisplayQueryValue(value: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "[set]" || text === "[redacted]") return text;
  if (/^\{\{.+\}\}$/.test(text)) return "[set]";
  if (/^[A-Za-z0-9._:-]{1,60}$/.test(text)) return text;
  return "[set]";
}

function findUnresolvedUrlPlaceholder(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const [key, value] of Array.from(parsed.searchParams.entries())) {
    const text = String(value || "").trim();
    if (
      text === "[set]" ||
      text === "%5Bset%5D" ||
      /\{\{.+\}\}/.test(text)
    ) {
      return key;
    }
  }

  return null;
}

function describeDiscoveryAuth(
  provider: ProviderRecord,
  endpoint: ProviderDiscoveryEndpointConfig
) {
  if (endpoint.supplementalConfig?.auth_profile) {
    return `supplemental auth profile: ${endpoint.supplementalConfig.auth_profile}`;
  }

  const authType = String(provider.auth_type || "POST_LOGIN").toUpperCase();
  if (authType === "POST_LOGIN") return "saved POST login token";
  if (authType === "API_KEY") return "saved API key";
  if (authType === "BEARER") return "saved bearer token";
  if (authType === "BASIC_AUTH") return "saved basic auth";
  if (authType === "NONE") return "no auth";
  return "saved provider auth";
}

function buildNoAdditionalReportEndpointMessage(_provider: ProviderRecord) {
  return "No additional provider report endpoints configured yet. Ask the provider for trip/report endpoint, auth method, token path, row path, and sample response.";
}

const DISCOVERY_USEFUL_FIELD_ALIASES = [
  {
    label: "vehicle/reg/truck",
    aliases: ["vehicle", "truck", "truck_id", "reg", "reg_no", "registration", "plate", "unit_id"],
  },
  { label: "latitude", aliases: ["latitude", "lat", "gps_lat", "y"] },
  { label: "longitude", aliases: ["longitude", "lng", "lon", "gps_lng", "gps_lon", "x"] },
  { label: "speed", aliases: ["speed", "velocity", "kph", "speed_kph"] },
  {
    label: "timestamp",
    aliases: ["timestamp", "time", "fixtime", "currenttime", "current_time", "recorded_at", "gps_time", "startlocationtime", "endlocationtime"],
  },
  { label: "location label", aliases: ["location", "currentlocation", "address", "place", "label", "startlocation", "endlocation"] },
  { label: "odometer", aliases: ["odometer", "odo", "odometerkm", "startodometer", "endodometer"] },
  { label: "mileage", aliases: ["mileage", "distance", "distancekm", "tripdistance", "provider_mileage"] },
  { label: "start odometer", aliases: ["startodometer", "start_odometer", "start_odometer_km"] },
  { label: "end odometer", aliases: ["endodometer", "end_odometer", "end_odometer_km"] },
  { label: "motion duration", aliases: ["motionduration", "motion_duration", "duration", "movingtime"] },
  { label: "violations", aliases: ["violations", "violationcount", "violations_count", "alerts"] },
  { label: "ignition/ACC", aliases: ["ignition", "ignition_on", "acc", "accstatus", "engine_on"] },
  { label: "RPM", aliases: ["rpm", "engine_rpm", "enginerpm"] },
  { label: "fuel level", aliases: ["fuel", "fuellevel", "currentfuellevel", "fuel_level"] },
  { label: "fuel rate", aliases: ["fuelrate", "fuel_rate", "fuelconsumption"] },
  { label: "driver", aliases: ["driver", "drivername", "driver_name"] },
  { label: "route/trip/report id", aliases: ["route", "routeid", "trip", "tripid", "reportid", "provider_trip_key"] },
];

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

async function updateFleetAssetByIdWithCapabilityFallback(
  assetId: string,
  payload: Record<string, any>,
  companyId?: string
) {
  const query = supabaseAdmin.from("fleet_assets").update(payload).eq("id", assetId);
  const { error } = companyId ? await query.eq("company_id", companyId) : await query;

  if (!isMissingCapabilityColumnError(error)) return error;

  const retryQuery = supabaseAdmin
    .from("fleet_assets")
    .update(stripCapabilityAssetColumns(payload))
    .eq("id", assetId);
  const { error: retryError } = companyId
    ? await retryQuery.eq("company_id", companyId)
    : await retryQuery;

  return retryError;
}

async function loadProviderAssetByExactTruckId(
  providerId: string,
  companyId: string | undefined,
  truckId: string
) {
  if (!companyId || !truckId) return null;
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, provider_id, provider_name, truck_id, registration, last_seen_at, telemetry_capability, telemetry_capability_source")
    .eq("company_id", companyId)
    .eq("provider_id", providerId)
    .eq("truck_id", truckId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function loadProviderAssetLookup(companyId?: string) {
  if (!companyId) return [] as any[];

  const capabilitySelect =
    "id, provider_id, provider_name, truck_id, registration, last_seen_at, telemetry_capability, telemetry_capability_source";
  const baseSelect = "id, provider_id, provider_name, truck_id, registration, last_seen_at";
  let { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select(capabilitySelect)
    .eq("company_id", companyId);

  if (isMissingCapabilityColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select(baseSelect)
      .eq("company_id", companyId);
    data = retry.data as any;
    error = retry.error;
  }

  if (error) {
    throw new Error(`Asset registry lookup failed: ${error.message}`);
  }

  return data || [];
}

function findProviderAssetMatch(assets: any[], providerId: string, truckId: string) {
  const targetKey = normalizeDistanceTruckKey(truckId);
  if (!targetKey) return null;
  return (
    assets.find(
      (asset) =>
        asset.provider_id === providerId &&
        getAssetMatchKeys(asset).includes(targetKey)
    ) || null
  );
}

function findCrossProviderAssetMatch(assets: any[], providerId: string, truckId: string) {
  const targetKey = normalizeDistanceTruckKey(truckId);
  if (!targetKey) return null;
  return (
    assets.find(
      (asset) =>
        asset.provider_id !== providerId &&
        getAssetMatchKeys(asset).includes(targetKey)
    ) || null
  );
}

function getAssetMatchKeys(asset: any) {
  return [asset?.truck_id, asset?.registration]
    .map((value) => normalizeDistanceTruckKey(value))
    .filter(Boolean);
}

function addVehicleMatchReviewRow(
  rows: ProviderVehicleMatchReviewRow[],
  seenKeys: Set<string>,
  row: ProviderVehicleMatchReviewRow
) {
  const matchKey =
    normalizeDistanceTruckKey(row.provider_vehicle_label) ||
    `${row.status}:${rows.length + 1}`;
  if (seenKeys.has(matchKey)) return false;
  seenKeys.add(matchKey);
  if (rows.length >= VEHICLE_MATCH_REVIEW_LIMIT) return false;

  rows.push({
    provider_vehicle_label: safeVehicleReviewText(row.provider_vehicle_label),
    matched_truck_id: row.matched_truck_id
      ? safeVehicleReviewText(row.matched_truck_id)
      : null,
    match_source: safeVehicleReviewText(row.match_source),
    confidence: row.confidence,
    status: row.status,
  });
  return true;
}

function safeVehicleReviewText(value: any) {
  return String(value || "")
    .replace(/[^\w\s./-]/g, "")
    .trim()
    .slice(0, 80);
}

function isSuspiciousProviderTimestamp(value: any) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  if (date.getUTCFullYear() < 2000) return true;
  return date.getTime() > Date.now() + 48 * 60 * 60 * 1000;
}

async function maybeUpgradeCanonicalAssetCapability(
  asset: any,
  normalized: any,
  companyId?: string
) {
  if (!asset?.id || !companyId) return { upgraded: false };
  if (!shouldUpgradeCanonicalCapability(asset, normalized)) {
    return { upgraded: false };
  }

  const payload = {
    telemetry_capability: normalized.telemetry_capability,
    telemetry_capabilities: normalized.telemetry_capabilities,
    telemetry_capability_source: normalized.telemetry_capability_source,
    canbus_enabled:
      normalized.telemetry_capability === "CAN_BUS" ||
      normalized.telemetry_capability === "HYBRID_CAN_AND_FUEL_ROD",
    fuel_rod_installed:
      normalized.telemetry_capability === "FUEL_ROD" ||
      normalized.telemetry_capability === "HYBRID_CAN_AND_FUEL_ROD",
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("fleet_assets")
    .update(payload)
    .eq("id", asset.id)
    .eq("company_id", companyId);

  if (isMissingCapabilityColumnError(error)) return { upgraded: false };
  if (error) return { upgraded: false, error: `Capability upgrade failed: ${error.message}` };
  return { upgraded: true };
}

function shouldUpgradeCanonicalCapability(asset: any, normalized: any) {
  const source = String(normalized.telemetry_capability_source || "").toLowerCase();
  if (source !== "provider_declaration") return false;

  const existingSource = String(asset.telemetry_capability_source || "").toLowerCase();
  if (
    ["manual", "admin", "asset_review", "verified"].some((token) =>
      existingSource.includes(token)
    )
  ) {
    return false;
  }

  return (
    telemetryCapabilityRank(normalized.telemetry_capability) >
    telemetryCapabilityRank(asset.telemetry_capability)
  );
}

function telemetryCapabilityRank(value: any) {
  switch (String(value || "UNKNOWN").toUpperCase()) {
    case "HYBRID_CAN_AND_FUEL_ROD":
      return 5;
    case "CAN_BUS":
    case "FUEL_ROD":
      return 4;
    case "GPS_WITH_IGNITION":
      return 3;
    case "GPS_ONLY":
      return 2;
    default:
      return 1;
  }
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
  providerCapabilityProfile: ProviderCapabilityProfile,
  supplementalDiagnostics: SupplementalDiagnostics,
  options: { write: boolean } = { write: true }
) {
  const diagnostics = createDistanceDiagnostics();
  diagnostics.write_mode = options.write ? "write" : "dry_run";

  const distanceFeedDiagnostics = supplementalDiagnostics.feeds.filter(
    (feed) => feed.distance_report
  );
  diagnostics.automated_distance_feeds_configured =
    distanceFeedDiagnostics.length;
  diagnostics.automated_distance_feeds_attempted = distanceFeedDiagnostics.filter(
    (feed) => feed.attempted
  ).length;
  appendDistanceFeedSetupRequirements(diagnostics, supplementalDiagnostics);

  if (!provider.company_id) return diagnostics;
  if (distanceFeedDiagnostics.length === 0) {
    diagnostics.no_automated_distance_feed = true;
    diagnostics.setup_requirements.push(
      "No automated distance report feed is active yet. Configure a provider report endpoint, auth profile, row path, and distance field mapping."
    );
    return diagnostics;
  }

  const summaries: ProviderTripSummary[] = [];
  const distanceFeeds = feeds.filter((feed) => isDistanceSummaryFeed(feed.config));

  diagnostics.automated_distance_rows_found = distanceFeeds.reduce(
    (sum, feed) => sum + feed.rows.length,
    0
  );

  for (const feed of distanceFeeds) {
    diagnostics.summary_rows_found += feed.rows.length;
    for (const row of feed.rows) {
      const summary = normalizeProviderTripSummary(row, feed.config.mapping || {}, {
        companyId: provider.company_id,
        providerId: provider.id,
        providerTimezone: providerCapabilityProfile.provider_timezone,
      });
      if (!summary) continue;

      if (summaries.length >= MAX_DISTANCE_SUMMARY_ROWS) {
        diagnostics.rows_skipped_over_cap++;
        continue;
      }

      summary.metadata = {
        ...summary.metadata,
        source: "automated_provider_distance_feed",
        feed_name: feed.config.name,
        feed_type: feed.config.feed_type || null,
      };
      summaries.push(summary);
    }
  }

  diagnostics.summaries_normalized = summaries.length;
  if (summaries.length === 0) return diagnostics;

  const { data: assets, error: assetError } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, provider_id, truck_id, registration, intelligence_enabled")
    .eq("company_id", provider.company_id);

  if (assetError) {
    diagnostics.errors.push(`Asset lookup failed: ${assetError.message}`);
  }

  const assetsByTruck = buildDistanceAssetMatchMap(assets || [], provider.id);

  for (const summary of summaries) {
    const matchedAsset = assetsByTruck.get(normalizeDistanceTruckKey(summary.truck_id));
    summary.asset_id = matchedAsset?.id || null;
    incrementFieldCount(diagnostics.odometer_health_counts, summary.odometer_health);
    incrementFieldCount(diagnostics.distance_source_counts, summary.distance_source);

    if (!summary.asset_id) {
      diagnostics.unmatched_rows++;
      continue;
    }

    diagnostics.matched_assets++;
    diagnostics.summaries_would_write++;

    if (!options.write) continue;

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
  diagnostics.setup_requirements = Array.from(
    new Set(diagnostics.setup_requirements)
  ).slice(0, 10);
  return diagnostics;
}

function buildDistanceAssetMatchMap(assets: any[], preferredProviderId?: string) {
  const map = new Map<string, any>();
  for (const asset of sortAssetsByPreferredProvider(assets || [], preferredProviderId)) {
    for (const value of [asset.truck_id, asset.registration]) {
      const key = normalizeDistanceTruckKey(value);
      if (key && !map.has(key)) map.set(key, asset);
    }
  }
  return map;
}

function sortAssetsByPreferredProvider(assets: any[], preferredProviderId?: string) {
  return [...assets].sort((a, b) => {
    const aPreferred = preferredProviderId && a.provider_id === preferredProviderId ? 0 : 1;
    const bPreferred = preferredProviderId && b.provider_id === preferredProviderId ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aEnabled = a.intelligence_enabled ? 0 : 1;
    const bEnabled = b.intelligence_enabled ? 0 : 1;
    return aEnabled - bEnabled;
  });
}

function appendDistanceFeedSetupRequirements(
  diagnostics: DistanceDiagnostics,
  supplementalDiagnostics: SupplementalDiagnostics
) {
  for (const feed of supplementalDiagnostics.feeds || []) {
    if (!feed.distance_report) continue;
    if (feed.setup_requirement) {
      diagnostics.setup_requirements.push(feed.setup_requirement);
      continue;
    }
    if (feed.error || feed.skipped_reason || feed.auth_profile_error) {
      diagnostics.setup_requirements.push(
        buildDistanceFeedSetupRequirement(feed.name, feed.error || feed.skipped_reason || feed.auth_profile_error)
      );
    }
  }
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
    const loginRequestUrl =
      method === "GET" || config.credential_placement === "query"
        ? appendPayloadToUrl(loginUrl, payload)
        : loginUrl;
    const response = await fetch(loginRequestUrl, {
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
    if (!response.ok) {
      return {
        success: false,
        message: "Sign-in failed. Check username/password and the provider login request shape.",
        debug: {
          status: response.status,
          loginUrl,
          payload_sent: maskPayload(payload),
          token_paths_checked: tokenPaths,
          auth_response_keys: collectSafeResponseKeys(data),
        },
      };
    }
    if (!token) {
      return {
        success: false,
        message: "Access token not found. Ask the provider which token or hash field is returned after login.",
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
  const currentFeed = provider.fleet_config?.current_vehicle_feed || {};
  const fleetUrl =
    currentFeed.endpoint_url ||
    provider.fleet_url ||
    provider.fleet_config?.fleet_url ||
    provider.default_fleet_url;
  if (!fleetUrl) return { success: false, vehicles: [], message: "Fleet URL missing" };
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.fleet_config || {};
  const method = String(currentFeed.method || config.method || "POST").toUpperCase();
  const vehiclePaths = buildCurrentVehicleRowPaths(provider);
  const result = await executeProviderRequest(
    provider,
    {
      name: "current_vehicle_feed",
      feed_type: "current_vehicles",
      url: fleetUrl,
      method,
      headers: currentFeed.headers || config.headers || {},
      payload: currentFeed.payload || config.payload || {},
      row_paths: vehiclePaths,
      token_placement: currentFeed.token_placement || config.token_placement,
      api_key_header: currentFeed.api_key_header || config.api_key_header,
      require_rows: true,
    },
    {
      authContext: {
        token,
        metadata: authMetadata,
        fallbackMetadata: {},
        authType,
        profileName: null,
      },
      requireRows: true,
    }
  );

  if (!result.success) {
    return {
      success: false,
      vehicles: [],
      message: result.message || "Vehicle feed failed",
      debug: {
        status: result.http_status,
        failure_stage: result.failure_stage,
        fleetUrl: result.effective_url_masked,
        response_diagnostics: result.response_diagnostics || null,
        request_diagnostics: result.request_diagnostics || null,
      },
    };
  }

  return {
    success: true,
    vehicles: result.rows,
    debug: {
      fleetUrl: result.effective_url_masked,
      vehicle_paths_checked: vehiclePaths,
      response_diagnostics: result.response_diagnostics,
    },
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

    if (!authContext) {
      if (feedDiagnostics && isDistanceSummaryFeed(config)) {
        feedDiagnostics.setup_requirement = buildDistanceFeedSetupRequirement(
          config.name,
          feedDiagnostics.error ||
            feedDiagnostics.skipped_reason ||
            feedDiagnostics.auth_profile_error ||
            "Distance report feed authentication did not return a usable token"
        );
      }
      continue;
    }

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
        if (isDistanceSummaryFeed(config)) {
          feedDiagnostics.setup_requirement = buildDistanceFeedSetupRequirement(
            config.name,
            skippedReason
          );
        }
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
        if (feedResult.responseDiagnostics) {
          applySupplementalResponseDiagnostics(
            feedDiagnostics,
            feedResult.responseDiagnostics
          );
        }
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
        if (isDistanceSummaryFeed(config)) {
          feedDiagnostics.setup_requirement = buildDistanceFeedSetupRequirement(
            config.name,
            feedDiagnostics.error
          );
        }
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
  const paths =
    Array.isArray(config.vehicle_paths) && config.vehicle_paths.length > 0
      ? config.vehicle_paths
      : defaultSupplementalVehiclePaths();
  const result = await executeProviderRequest(
    provider,
    {
      name: config.name,
      feed_type: config.feed_type || "supplemental",
      url: config.url,
      method: config.method || "GET",
      headers: config.headers || {},
      payload: payload || {},
      row_paths: paths,
      api_key_header:
        config.api_key_header ||
        provider.fleet_config?.api_key_header ||
        "x-api-key",
    },
    { authContext }
  );

  if (!result.success) {
    const error = new Error(
      result.message || `Supplemental feed ${config.name} failed`
    ) as any;
    error.requestDiagnostics = result.request_diagnostics;
    error.responseDiagnostics = result.response_diagnostics;
    throw error;
  }

  return {
    rows: result.rows,
    requestDiagnostics: result.request_diagnostics,
    responseDiagnostics: result.response_diagnostics,
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
      feed_type: "current_status",
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
      feed_type: "fuel_status",
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

  const distanceReportUrl = config.distance_report_url || config.trip_summary_url;
  if (distanceReportUrl) {
    feeds.push({
      name: config.distance_report_name || "distance_report",
      url: distanceReportUrl,
      feed_type: "distance_report",
      auth_profile:
        config.distance_report_auth_profile ||
        config.trip_summary_auth_profile ||
        config.current_status_auth_profile,
      method: config.distance_report_method || config.trip_summary_method || config.method || "GET",
      headers: config.distance_report_headers || config.trip_summary_headers || config.headers || {},
      payload: config.distance_report_payload || config.trip_summary_payload || {},
      vehicle_paths:
        config.distance_report_vehicle_paths ||
        config.trip_summary_vehicle_paths ||
        config.current_status_vehicle_paths,
      match_keys:
        config.distance_report_match_keys ||
        config.trip_summary_match_keys ||
        config.current_status_match_keys,
      mapping:
        config.distance_report_mapping ||
        config.trip_summary_mapping ||
        config.current_status_mapping ||
        {},
      api_key_header:
        config.distance_report_api_key_header ||
        config.trip_summary_api_key_header ||
        config.current_status_api_key_header,
    });
  }

  const reportFeed = config.report_feed;
  if (
    reportFeed &&
    typeof reportFeed === "object" &&
    !Array.isArray(reportFeed) &&
    reportFeed.endpoint_url &&
    reportFeed.active !== false
  ) {
    feeds.push({
      name: reportFeed.name || "report_feed",
      url: String(reportFeed.endpoint_url),
      feed_type: reportFeed.feed_type || "distance_report",
      auth_profile: reportFeed.auth_profile,
      method: reportFeed.method || "GET",
      headers: reportFeed.headers || {},
      payload: reportFeed.payload || {},
      vehicle_paths: reportFeed.row_path
        ? [String(reportFeed.row_path)]
        : Array.isArray(reportFeed.row_paths)
          ? reportFeed.row_paths
          : undefined,
      match_keys: Array.isArray(reportFeed.match_keys)
        ? reportFeed.match_keys
        : undefined,
      mapping: reportFeed.mapping || {},
      api_key_header: reportFeed.api_key_header,
    });
  }

  return dedupeSupplementalFeeds(feeds).map(normalizeSupplementalFeedRowContract);
}

function normalizeSupplementalFeedConfig(feed: any): SupplementalFeedConfig | null {
  if (!feed || typeof feed !== "object" || !feed.url) return null;
  const vehiclePaths = Array.isArray(feed.vehicle_paths)
    ? dedupeRowPaths(feed.vehicle_paths)
    : undefined;

  return {
    name: String(feed.name || "supplemental").trim() || "supplemental",
    url: String(feed.url),
    feed_type: feed.feed_type || feed.type || feed.purpose || feed.report_type
      ? String(feed.feed_type || feed.type || feed.purpose || feed.report_type).trim()
      : undefined,
    auth_profile: feed.auth_profile ? String(feed.auth_profile).trim() : undefined,
    method: feed.method || "GET",
    headers: feed.headers || {},
    payload: feed.payload || {},
    vehicle_paths: vehiclePaths,
    match_keys: Array.isArray(feed.match_keys) ? feed.match_keys : undefined,
    mapping: normalizeFieldMappingsRelativeToRow(
      feed.mapping || {},
      vehiclePaths?.[0]
    ),
    api_key_header: feed.api_key_header,
  };
}

function normalizeSupplementalFeedRowContract(
  feed: SupplementalFeedConfig
): SupplementalFeedConfig {
  const vehiclePaths = Array.isArray(feed.vehicle_paths)
    ? dedupeRowPaths(feed.vehicle_paths)
    : undefined;
  return {
    ...feed,
    vehicle_paths: vehiclePaths,
    mapping: normalizeFieldMappingsRelativeToRow(
      feed.mapping || {},
      vehiclePaths?.[0]
    ),
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

function isDistanceSummaryFeed(config: SupplementalFeedConfig) {
  const type = normalizeProviderKey(config.feed_type || "");
  const name = normalizeProviderKey(config.name || "");
  if (
    [
      "distancereport",
      "distancesummary",
      "tripsummary",
      "tripreport",
      "fleettripsummary",
      "fleetcurrentstatus",
      "report",
    ].includes(type)
  ) {
    return true;
  }
  if (
    name.includes("distance") ||
    name.includes("trip") ||
    name.includes("report") ||
    name.includes("fleetcurrentstatus")
  ) {
    return true;
  }
  return hasDistanceSummaryMapping(config.mapping || {});
}

function hasDistanceSummaryMapping(mapping: Record<string, string>) {
  const fields = new Set(
    Object.keys(mapping || {}).map((field) => String(field || "").trim())
  );
  return DISTANCE_SUMMARY_FIELDS.some((field) => fields.has(field));
}

function buildDistanceFeedSetupRequirement(feedName: string, reason?: string) {
  const safeReason = sanitizeDiagnosticMessage(reason || "Distance report feed is not returning usable rows");
  return [
    `${feedName}: automated distance report feed setup required.`,
    `Blocker: ${safeReason}.`,
    "Confirm endpoint URL, auth response token_paths, vehicle row path, and mappings for truck, report_start_time, report_end_time, start_odometer, end_odometer, mileage, motion_duration, violations_count, and provider_trip_key.",
  ].join(" ");
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
      feed_type: feed.feed_type || undefined,
      distance_report: isDistanceSummaryFeed(feed),
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
      counts[toDisplayJsonPath(path)] = value.length;

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
  if (Array.isArray(value)) return value.filter(isVehicleLikeRow);
  if (isVehicleLikeRow(value)) return [value];
  return [];
}

function extractRowsByPath(responseData: any, rowPath: string) {
  return extractRowsByNormalizedPath(responseData, rowPath);
}

function getRowsByPaths(data: any, paths: string[]) {
  for (const path of paths) {
    const rows = extractRowsByPath(data, path);
    if (rows.length > 0) return rows;
  }

  return [];
}

function isVehicleLikeRow(value: any) {
  if (isNormalizedVehicleLikeRow(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const hasIdentifier = hasAnyProviderField(value, [
    "vehicle",
    "truck",
    "truck_id",
    "reg",
    "reg_no",
    "registration",
    "plate",
    "unit_id",
    "device",
    "device_id",
  ]);
  if (hasIdentifier) return true;

  const hasLatitude = hasAnyProviderField(value, [
    "latitude",
    "lat",
    "gps_lat",
    "y",
  ]);
  const hasLongitude = hasAnyProviderField(value, [
    "longitude",
    "lng",
    "lon",
    "gps_lng",
    "gps_lon",
    "x",
  ]);
  const hasMovementContext = hasAnyProviderField(value, [
    "speed",
    "velocity",
    "kph",
    "speed_kph",
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
  if (macro === "access_token") return token || "";
  if (macro === "user_api_hash") return token || "";

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
    .replace(
      /([?&](?:token|access_token|user_api_hash|api_key|apikey|hash|jwt|bearer)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(/authorization['"]?\s*[:=]\s*['"]?[^,'"\s}]+/gi, "authorization=[redacted]")
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
  const rowPath = normalizeProviderRowPath(path);
  if (rowPath === "$") return obj;
  const normalizedPath = rowPath.startsWith("$.") ? rowPath.slice(2) : rowPath;
  return normalizedPath.split(".").reduce((current, part) => current?.[part], obj);
}

function appendPayloadToUrl(url: string, payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

function maskUrlToken(url: string, token: string | null) {
  if (!token) return url;
  return url.split(String(token)).join("[redacted]");
}

function defaultTokenPaths() {
  return [
    "user_api_hash",
    "token",
    "access_token",
    "api_key",
    "hash",
    "jwt",
    "bearer_token",
    "data.user_api_hash",
    "data.token",
    "data.access_token",
    "data.api_key",
    "data.hash",
    "result.user_api_hash",
    "result.token",
    "result.access_token",
    "result.api_key",
    "result.hash",
  ];
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
