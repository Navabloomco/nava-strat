export type ProviderVehicleIdentity = {
  provider_label: string | null;
  canonical_truck_plate: string | null;
  attached_trailer_plate: string | null;
  identity_source: "single_vehicle_label" | "truck_with_attached_trailer" | "unknown";
  tokens: string[];
};

export type StoredVehicleIdentityContext = {
  provider_label: string | null;
  canonical_truck_plate: string | null;
  attached_trailer_plate: string | null;
  identity_source: string;
  canonical_key: string | null;
};

export function parseProviderVehicleIdentity(value: any): ProviderVehicleIdentity {
  const providerLabel = sanitizeProviderVehicleLabel(value);
  const tokens = extractPlateTokens(providerLabel);
  const truckToken = tokens.find(isTruckPlateToken) || tokens.find((token) => !isTrailerPlateToken(token)) || null;
  const trailerToken = tokens.find(
    (token) => isTrailerPlateToken(token) && token !== truckToken
  ) || null;
  const identitySource =
    truckToken && trailerToken
      ? "truck_with_attached_trailer"
      : truckToken || providerLabel
        ? "single_vehicle_label"
        : "unknown";

  return {
    provider_label: providerLabel,
    canonical_truck_plate: truckToken || providerLabel || null,
    attached_trailer_plate: trailerToken,
    identity_source: identitySource,
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
  const canonicalTruckPlate =
    sanitizeTruckPlate(telemetryCapabilities.canonical_truck_plate) ||
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
