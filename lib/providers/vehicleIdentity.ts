export type ProviderVehicleIdentity = {
  provider_label: string | null;
  canonical_truck_plate: string | null;
  attached_trailer_plate: string | null;
  identity_source:
    | "single_vehicle_label"
    | "truck_with_attached_trailer"
    | "non_primary_vehicle_label"
    | "device_identifier"
    | "unknown";
  asset_identity_role:
    | "truck"
    | "truck_with_attached_trailer"
    | "non_primary_vehicle"
    | "device_identifier"
    | "unknown";
  tokens: string[];
};

export type StoredVehicleIdentityContext = {
  provider_label: string | null;
  canonical_truck_plate: string | null;
  attached_trailer_plate: string | null;
  identity_source: string;
  asset_identity_role: string;
  non_primary_asset: boolean;
  canonical_key: string | null;
};

export function parseProviderVehicleIdentity(value: any): ProviderVehicleIdentity {
  const providerLabel = sanitizeProviderVehicleLabel(value);
  const tokens = extractPlateTokens(providerLabel);
  const nonPrimaryLabel = isNonPrimaryVehicleLabel(providerLabel);
  const deviceIdentifier = isDeviceIdentifierLabel(providerLabel);
  const truckToken = nonPrimaryLabel || deviceIdentifier
    ? null
    : tokens.find(isTruckPlateToken) || null;
  const trailerToken = tokens.find(
    (token) => isTrailerPlateToken(token) && token !== truckToken
  ) || null;
  const identitySource =
    deviceIdentifier
      ? "device_identifier"
      : nonPrimaryLabel
        ? "non_primary_vehicle_label"
        : truckToken && trailerToken
          ? "truck_with_attached_trailer"
          : truckToken || providerLabel
            ? "single_vehicle_label"
            : "unknown";
  const assetIdentityRole =
    deviceIdentifier
      ? "device_identifier"
      : nonPrimaryLabel
        ? "non_primary_vehicle"
        : truckToken && trailerToken
          ? "truck_with_attached_trailer"
          : truckToken
            ? "truck"
            : providerLabel
              ? "unknown"
              : "unknown";

  return {
    provider_label: providerLabel,
    canonical_truck_plate: truckToken,
    attached_trailer_plate: trailerToken,
    identity_source: identitySource,
    asset_identity_role: assetIdentityRole,
    tokens,
  };
}

export function readStoredVehicleIdentityContext(source: any): StoredVehicleIdentityContext {
  const telemetryCapabilities =
    source?.telemetry_capabilities && typeof source.telemetry_capabilities === "object"
      ? source.telemetry_capabilities
      : {};
  const parsed = parseProviderVehicleIdentity(
    telemetryCapabilities.provider_label ||
      source?.provider_label ||
      source?.registration ||
      source?.truck_id
  );
  const fallbackParsed = parseProviderVehicleIdentity(
    source?.registration || source?.truck_id || telemetryCapabilities.provider_label
  );
  const attachedTrailer =
    sanitizeAttachedTrailerPlate(telemetryCapabilities.attached_trailer_plate) ||
    sanitizeAttachedTrailerPlate(source?.attached_trailer_plate) ||
    parsed.attached_trailer_plate;
  const assetIdentityRole =
    typeof telemetryCapabilities.asset_identity_role === "string"
      ? telemetryCapabilities.asset_identity_role
      : parsed.asset_identity_role;
  const nonPrimaryAsset =
    assetIdentityRole === "non_primary_vehicle" ||
    assetIdentityRole === "device_identifier";
  const canonicalTruckPlate = nonPrimaryAsset
    ? null
    : sanitizeTruckPlate(telemetryCapabilities.canonical_truck_plate) ||
      sanitizeTruckPlate(source?.canonical_truck_id) ||
      parsed.canonical_truck_plate ||
      fallbackParsed.canonical_truck_plate ||
      null;

  return {
    provider_label:
      sanitizeProviderVehicleLabel(telemetryCapabilities.provider_label) ||
      parsed.provider_label,
    canonical_truck_plate: canonicalTruckPlate,
    attached_trailer_plate: attachedTrailer,
    identity_source:
      typeof telemetryCapabilities.identity_source === "string"
        ? telemetryCapabilities.identity_source
        : parsed.identity_source,
    asset_identity_role: assetIdentityRole,
    non_primary_asset: nonPrimaryAsset,
    canonical_key: normalizeProviderVehicleToken(canonicalTruckPlate),
  };
}

export function sanitizeProviderVehicleLabel(value: any) {
  const text = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

export function normalizeProviderVehicleToken(value: any) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function sanitizeAttachedTrailerPlate(value: any) {
  const token = normalizeProviderVehicleToken(value);
  if (!token || !isTrailerPlateToken(token)) return null;
  return token;
}

export function sanitizeTruckPlate(value: any) {
  const token = normalizeProviderVehicleToken(value);
  if (!token || !isTruckPlateToken(token)) return null;
  return token;
}

function isNonPrimaryVehicleLabel(label: string | null) {
  if (!label) return false;
  return /\b(MOTOR\s*BIKE|MOTORBIKE|MOTOR\s*CYCLE|MOTORCYCLE|PROBOX|HILUX|PICK\s*UP|PICKUP|DOUBLE\s*CAB|CAR|VAN)\b/i.test(
    label
  );
}

function isDeviceIdentifierLabel(label: string | null) {
  if (!label) return false;
  return /^\d{12,18}$/.test(normalizeProviderVehicleToken(label));
}

function extractPlateTokens(label: string | null) {
  if (!label) return [];
  const matches = label.match(/[A-Z]{1,4}[\s./-]*\d{2,5}[A-Z]?/g) || [];
  return Array.from(
    new Set(
      matches
        .map(normalizeProviderVehicleToken)
        .filter((token) => token.length >= 4 && /[A-Z]/.test(token) && /\d/.test(token))
    )
  );
}

function isTruckPlateToken(token: string) {
  return /^K[A-Z]{2}\d{3}[A-Z]$/.test(token);
}

function isTrailerPlateToken(token: string) {
  return /^Z[A-Z]{1,2}\d{3,5}$/.test(token);
}
