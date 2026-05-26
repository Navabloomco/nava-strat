import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ProviderCapabilities = {
  can_view_provider_status: boolean;
  can_add_provider: boolean;
  can_update_provider_credentials: boolean;
  can_test_provider: boolean;
  can_edit_advanced_provider_config: boolean;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      capabilities: ProviderCapabilities;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
      capabilities?: never;
    };

const USERNAME_OVERRIDE_REDACTION = "__configured__";
const CUSTOM_API_PROVIDER_MODE = "custom_api";

const CUSTOM_AUTH_METHODS = new Set([
  "none",
  "api_key_header",
  "bearer_token",
  "basic",
  "post_login",
]);

const CUSTOM_CAPABILITY_OPTIONS: Record<string, string> = {
  not_sure: "UNKNOWN",
  location_only: "GPS_ONLY",
  location_ignition: "GPS_WITH_IGNITION",
  engine: "CAN_BUS",
  tank: "FUEL_ROD",
};

const CUSTOM_REQUIRED_MAPPING_KEYS = [
  "truck",
  "latitude",
  "longitude",
  "recorded_at",
];

function getProviderCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const isCompanyAdmin =
    normalizedRoles.has("owner") || normalizedRoles.has("admin");

  if (isPlatformOwner || normalizedRoles.has("platform_owner")) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: true,
    };
  }

  if (isCompanyAdmin) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: false,
    };
  }

  return {
    can_view_provider_status: true,
    can_add_provider: false,
    can_update_provider_credentials: false,
    can_test_provider: false,
    can_edit_advanced_provider_config: false,
  };
}

function sanitizeProvider(provider: any, capabilities: ProviderCapabilities) {
  const baseProvider: Record<string, any> = {
    id: provider.id,
    name: provider.provider_name,
    provider_name: provider.provider_name,
    status: provider.last_test_status || (provider.is_active ? "active" : "inactive"),
    is_active: Boolean(provider.is_active),
    last_test_status: provider.last_test_status || null,
    last_test_message: provider.last_test_message || null,
    last_test_at: provider.last_test_at || null,
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null,
    feed_summary: buildSafeProviderFeedSummary(provider),
  };

  if (
    capabilities.can_update_provider_credentials ||
    capabilities.can_edit_advanced_provider_config
  ) {
    baseProvider.username = provider.username || null;
    baseProvider.has_api_key = Boolean(provider.api_key);
    baseProvider.has_password = Boolean(provider.password);
    baseProvider.has_bearer_token = Boolean(provider.bearer_token);
  }

  if (capabilities.can_edit_advanced_provider_config) {
    baseProvider.company_id = provider.company_id;
    baseProvider.provider_type =
      provider.provider_type || provider.provider_slug || null;
    baseProvider.provider_slug = provider.provider_slug || null;
    baseProvider.auth_type = provider.auth_type || null;
    baseProvider.base_url = provider.base_url || null;
    baseProvider.login_url = provider.login_url || null;
    baseProvider.fleet_url = provider.fleet_url || null;
    baseProvider.is_active = Boolean(provider.is_active);
    baseProvider.field_mapping = provider.field_mapping || {};
    baseProvider.fleet_config = sanitizeFleetConfigForResponse(
      provider.fleet_config || {}
    );
    baseProvider.capability_profile = sanitizeOptionalObject(
      provider.capability_profile
    );
    baseProvider.supported_signals = sanitizeOptionalObject(
      provider.supported_signals
    );
    baseProvider.provider_timezone = provider.provider_timezone || null;
    baseProvider.source_signal_notes = sanitizeOptionalObject(
      provider.source_signal_notes
    );
  }

  return baseProvider;
}

function sanitizeFleetConfigForResponse(fleetConfig: any) {
  if (!fleetConfig || typeof fleetConfig !== "object" || Array.isArray(fleetConfig)) {
    return fleetConfig || {};
  }

  const safeConfig = JSON.parse(JSON.stringify(fleetConfig));
  const profiles = safeConfig.supplemental_auth_profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return safeConfig;
  }

  for (const profile of Object.values(profiles) as any[]) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    if (profile.username_override) {
      profile.username_override = USERNAME_OVERRIDE_REDACTION;
    }
  }

  return safeConfig;
}

function buildSafeProviderFeedSummary(provider: any) {
  const fleetConfig = provider?.fleet_config || {};
  const currentFeed = fleetConfig.current_vehicle_feed || {};
  const reportFeed = fleetConfig.report_feed || {};
  const fleetUrl =
    provider?.fleet_url ||
    fleetConfig.fleet_url ||
    currentFeed.endpoint_url ||
    null;
  const reportEndpoint =
    reportFeed.endpoint_url ||
    fleetConfig.distance_report_url ||
    fleetConfig.trip_summary_url ||
    null;
  const reportConfigured = Boolean(
    reportEndpoint &&
      reportFeed.active !== false &&
      ((reportFeed.row_path || reportFeed.row_paths?.length) ||
        fleetConfig.distance_report_vehicle_paths?.length ||
        fleetConfig.trip_summary_vehicle_paths?.length) &&
      (Object.keys(reportFeed.mapping || {}).length > 0 ||
        Object.keys(fleetConfig.distance_report_mapping || {}).length > 0 ||
        Object.keys(fleetConfig.trip_summary_mapping || {}).length > 0)
  );

  return {
    auth_channel: {
      auth_type: provider?.auth_type || null,
      login_configured: Boolean(provider?.login_url || provider?.auth_config?.login_url),
      token_paths: Array.isArray(provider?.auth_config?.token_paths)
        ? provider.auth_config.token_paths.map((path: any) => String(path)).slice(0, 10)
        : [],
    },
    current_vehicle_feed: {
      configured: Boolean(fleetUrl),
      method: String(currentFeed.method || fleetConfig.method || "GET").toUpperCase(),
      row_paths: Array.isArray(currentFeed.row_paths)
        ? [
            currentFeed.row_path,
            ...currentFeed.row_paths,
          ].map(normalizeProviderRowPath).filter(Boolean).slice(0, 10)
        : currentFeed.row_path
          ? [normalizeProviderRowPath(currentFeed.row_path)]
          : Array.isArray(fleetConfig.vehicle_paths)
            ? fleetConfig.vehicle_paths.map(normalizeProviderRowPath).filter(Boolean).slice(0, 10)
            : fleetConfig.data_group
              ? [normalizeProviderRowPath(fleetConfig.data_group)]
              : [],
      token_placement:
        currentFeed.token_placement || fleetConfig.token_placement || null,
    },
    report_feed: {
      endpoint_present: Boolean(reportEndpoint),
      configured: reportConfigured,
      active: reportConfigured,
      method: String(
        reportFeed.method ||
          fleetConfig.distance_report_method ||
          fleetConfig.trip_summary_method ||
          "GET"
      ).toUpperCase(),
      row_paths: reportFeed.row_path
        ? [String(reportFeed.row_path)]
        : Array.isArray(reportFeed.row_paths)
          ? reportFeed.row_paths.map((path: any) => String(path)).slice(0, 10)
          : Array.isArray(fleetConfig.distance_report_vehicle_paths)
            ? fleetConfig.distance_report_vehicle_paths.map((path: any) => String(path)).slice(0, 10)
            : [],
      setup_message: reportConfigured
        ? "Report/distance feed is configured for dry-run testing."
        : "Report endpoint not configured yet. Ask provider for get_reports parameters: date range, report type, vehicle id, row path, and sample JSON.",
    },
  };
}

function normalizeProviderRowPath(value: any) {
  let path = String(value || "").trim();
  if (!path) return "";
  path = path.replace(/^\$\$+\./, "$.");
  path = path.replace(/^\$\$+$/, "$");
  while (path.startsWith("$.$.")) {
    path = "$." + path.slice(4);
  }
  return path;
}

function validateSupplementalUsernameOverrides(
  fleetConfig: any,
  isPlatformOwner: boolean
) {
  const profiles = fleetConfig?.supplemental_auth_profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    return null;
  }

  for (const [profileName, profile] of Object.entries(profiles) as any[]) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    if (profile.username_override === undefined) continue;
    if (!isPlatformOwner) {
      return "Only platform owners can configure supplemental auth username overrides.";
    }
    const value = String(profile.username_override || "").trim();
    if (!value || value.length > 255) {
      return `supplemental auth profile '${profileName}' username_override must be a short value.`;
    }
  }

  return null;
}

async function loadProviderTemplateForCreate(
  templateId: string,
  canUseInternalTemplates: boolean
) {
  const { data: template, error } = await supabaseAdmin
    .from("provider_templates")
    .select(
      [
        "id",
        "display_name",
        "slug",
        "auth_type",
        "auth_config",
        "fleet_config",
        "field_mapping",
        "default_login_url",
        "default_fleet_url",
      ].join(", ")
    )
    .eq("id", templateId)
    .eq("is_public", true)
    .eq("is_verified", true)
    .maybeSingle();

  if (error) throw error;
  if (!template) return null;
  if (!canUseInternalTemplates && !isCustomerFacingTemplate(template)) {
    return null;
  }
  return template;
}

function isCustomerFacingTemplate(template: any) {
  const setupOnly = Boolean(template.setup_only || template.fleet_config?.setup_only);
  const internalTemplate = Boolean(
    template.internal_template || template.fleet_config?.internal_template
  );
  const customerFacing =
    template.customer_facing !== false &&
    template.fleet_config?.customer_facing !== false;
  return customerFacing && !setupOnly && !internalTemplate;
}

function originFromUrl(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeProviderBaseUrl(value: any) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();
    const endpointSuffixes = [
      "/auth/login",
      "/login",
      "/get_devices",
      "/devices",
      "/vehicles",
      "/fleet",
      "/get_reports",
    ];
    const matched = endpointSuffixes.find((suffix) => lowerPath.endsWith(suffix));
    if (matched) {
      const basePath = path.slice(0, path.length - matched.length).replace(/\/+$/, "");
      parsed.pathname = basePath || "/";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return text.replace(/\/+$/, "");
  }
}

function buildCustomApiProviderConfig(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Custom provider details are required." };
  }

  const providerName = safeShortText(input.provider_name, 120);
  const providerTimezone = sanitizeProviderTimezone(input.provider_timezone);
  const providerWebsite: any = optionalPublicHttpsUrl(
    input.provider_website,
    "Provider website"
  );
  const endpointUrl: any = validatePublicHttpsUrl(
    input.endpoint_url,
    "Fleet/current location endpoint"
  );
  const method = normalizeHttpMethod(input.http_method);
  const rowPath: any = validateProviderPath(input.row_path, "Row path / data group");
  const authMethod = String(input.auth_method || "none").trim().toLowerCase();
  const fieldMapping: any = buildCustomFieldMapping(input.field_mapping);
  const capability = customCapabilityFromChoice(input.capability_declaration);

  if (!providerName) return { error: "Provider name is required." };
  if (providerWebsite.error) return { error: providerWebsite.error };
  if (endpointUrl.error) return { error: endpointUrl.error };
  if (!method) return { error: "HTTP method must be GET or POST." };
  if (rowPath.error) return { error: rowPath.error };
  if (!CUSTOM_AUTH_METHODS.has(authMethod)) {
    return { error: "Choose a supported authentication method." };
  }
  if (fieldMapping.error) return { error: fieldMapping.error };
  const capabilityMappingError = validateCapabilityMapping(
    capability,
    fieldMapping.mapping
  );
  if (capabilityMappingError) return { error: capabilityMappingError };

  const requestBodyResult: any = parseCustomRequestBody(
    input.request_body,
    method
  );
  if (requestBodyResult.error) return { error: requestBodyResult.error };

  const authResult: any = buildCustomAuthConfig(input, authMethod);
  if (authResult.error) return { error: authResult.error };

  const supportedSignals = buildCustomSupportedSignals(
    fieldMapping.mapping,
    capability
  );
  const tokenPlacement = normalizeFleetTokenPlacement(
    input.fleet_token_placement,
    authMethod
  );
  const endpoint = applyFleetTokenPlacement(
    endpointUrl.url as string,
    tokenPlacement
  );
  const normalizedBase = normalizeProviderBaseUrl(
    input.base_url || endpointUrl.url
  );
  const websiteUrl = providerWebsite.url || null;
  const currentVehicleFeed = {
    feed_type: "current_vehicles",
    endpoint_url: endpoint,
    method,
    row_path: rowPath.path,
    token_placement: tokenPlacement || undefined,
    mapping: fieldMapping.mapping,
  };
  const reportFeed = buildReportFeedPlaceholder({
    baseUrl: normalizedBase || originFromUrl(endpoint),
    authMethod,
    tokenPlacement,
  });
  const fleetConfig = {
    fleet_url: endpoint,
    method,
    vehicle_paths: [rowPath.path],
    payload: requestBodyResult.payload,
    provider_timezone: providerTimezone,
    self_serve_custom_api: true,
    api_key_header: authResult.api_key_header || undefined,
    token_placement: tokenPlacement || undefined,
    capability_profile: {
      default_capability: capability,
      supported_signals: supportedSignals,
      provider_timezone: providerTimezone,
      source_signal_notes: {
        onboarding_source: "self_serve_custom_api",
        verification_note:
          "Customer-declared capability. Test Connection must verify meaningful signals before high-stakes conclusions.",
      },
    },
    supported_signals: supportedSignals,
    source_signal_notes: {
      onboarding_source: "self_serve_custom_api",
      provider_website: websiteUrl,
    },
    current_vehicle_feed: currentVehicleFeed,
    report_feed: reportFeed,
    connection_contract: {
      version: 1,
      auth_channel: {
        auth_type: authResult.auth_type,
        login_url: authResult.login_url,
        credential_placement:
          authMethod === "post_login"
            ? String(input.login_credential_placement || "json_body")
            : null,
        token_paths:
          authMethod === "post_login"
            ? [String(input.login_token_path || "").trim()].filter(Boolean)
            : [],
      },
      feeds: [
        currentVehicleFeed,
        ...(reportFeed ? [reportFeed] : []),
      ],
    },
  };

  return {
    config: {
      provider_name: providerName,
      provider_type: "custom_api",
      auth_type: authResult.auth_type,
      auth_config: authResult.auth_config,
      fleet_config: removeUndefinedKeys(fleetConfig),
      field_mapping: fieldMapping.mapping,
      capability_profile: {
        default_capability: capability,
        supported_signals: supportedSignals,
        provider_timezone: providerTimezone,
        source_signal_notes: {
          onboarding_source: "self_serve_custom_api",
          provider_website: websiteUrl,
          verification_note:
            "Capability was declared during custom API setup and remains subject to connection-test signal checks.",
        },
      },
      supported_signals: supportedSignals,
      provider_timezone: providerTimezone,
      source_signal_notes: {
        onboarding_source: "self_serve_custom_api",
        provider_website: websiteUrl,
        capability_warning:
          "Engine and tank signals must be confirmed as real sensor values, not dashboard placeholders.",
      },
      base_url: normalizedBase || originFromUrl(endpoint),
      login_url: authResult.login_url,
      fleet_url: endpoint,
      username: authResult.username,
      api_key: authResult.api_key,
      password: authResult.password,
      bearer_token: authResult.bearer_token,
    },
  };
}

function buildCustomAuthConfig(input: any, authMethod: string) {
  if (authMethod === "none") {
    return {
      auth_type: "NONE",
      auth_config: {},
      login_url: null,
      username: null,
      api_key: null,
      password: null,
      bearer_token: null,
    };
  }

  if (authMethod === "api_key_header") {
    const apiKey = safeCredential(input.api_key, 2000);
    const headerName = safeHeaderName(input.api_key_header || "x-api-key");
    if (!apiKey) return { error: "API key is required." };
    if (!headerName) return { error: "API key header name is invalid." };
    return {
      auth_type: "API_KEY",
      auth_config: {},
      login_url: null,
      username: null,
      api_key: apiKey,
      password: null,
      bearer_token: null,
      api_key_header: headerName,
    };
  }

  if (authMethod === "bearer_token") {
    const token = safeCredential(input.bearer_token, 4000);
    if (!token) return { error: "Bearer token is required." };
    return {
      auth_type: "BEARER",
      auth_config: {},
      login_url: null,
      username: null,
      api_key: null,
      password: null,
      bearer_token: token,
    };
  }

  if (authMethod === "basic") {
    const username = safeCredential(input.username, 255);
    const password = safeCredential(input.password, 4000);
    if (!username || !password) {
      return { error: "Basic username and password are required." };
    }
    return {
      auth_type: "BASIC_AUTH",
      auth_config: {},
      login_url: null,
      username,
      api_key: null,
      password,
      bearer_token: null,
    };
  }

  const loginUrl = validatePublicHttpsUrl(input.login_url, "Login endpoint");
  const tokenPath: any = validateProviderPath(input.login_token_path, "Login token path");
  const username = safeCredential(input.username, 255);
  const password = safeCredential(input.password, 4000);
  const usernameField: any = validateProviderPath(
    input.login_username_field || "username",
    "Login username field"
  );
  const passwordField: any = validateProviderPath(
    input.login_secret_field || "password",
    "Login password field"
  );

  if (loginUrl.error) return { error: loginUrl.error };
  if (tokenPath.error) return { error: tokenPath.error };
  if (usernameField.error) return { error: usernameField.error };
  if (passwordField.error) return { error: passwordField.error };
  if (!username || !password) {
    return { error: "Login username and password are required." };
  }
  const credentialPlacement =
    String(input.login_credential_placement || "json_body").trim() ===
    "query_params"
      ? "query"
      : "body";

  return {
    auth_type: "POST_LOGIN",
    auth_config: {
      method: credentialPlacement === "query" ? "GET" : "POST",
      credential_placement: credentialPlacement,
      login_url: loginUrl.url,
      payload: {
        [usernameField.path]: "{{username}}",
        [passwordField.path]: "{{password}}",
      },
      token_paths: [tokenPath.path],
    },
    login_url: loginUrl.url,
    username,
    api_key: null,
    password,
    bearer_token: null,
  };
}

function buildCustomFieldMapping(input: any) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const mapping: Record<string, string> = {};
  const aliases: Record<string, string> = {
    vehicle: "truck",
    timestamp: "recorded_at",
    ignition: "ignition_on",
    rpm: "engine_rpm",
    odometer: "odometer_km",
  };

  for (const key of [
    "truck",
    "vehicle",
    "latitude",
    "longitude",
    "recorded_at",
    "timestamp",
    "speed",
    "location_label",
    "fuel_level",
    "ignition_on",
    "ignition",
    "engine_rpm",
    "rpm",
    "odometer",
  ]) {
    const target = aliases[key] || key;
    const value = source[key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const path: any = validateProviderPath(value, `${target} field`);
    if (path.error) return { error: path.error };
    mapping[target] = path.path;
  }

  for (const key of CUSTOM_REQUIRED_MAPPING_KEYS) {
    if (!mapping[key]) {
      return { error: `${fieldLabel(key)} mapping is required.` };
    }
  }

  return { mapping };
}

function buildCustomSupportedSignals(
  mapping: Record<string, string>,
  capability: string
) {
  const signals: Record<string, boolean> = {
    latitude: true,
    longitude: true,
    recorded_at: true,
  };
  if (mapping.speed) signals.speed = true;
  if (mapping.location_label) signals.location_label = true;
  if (mapping.fuel_level) signals.fuel_level = true;
  if (mapping.ignition_on) signals.ignition_on = true;
  if (capability === "CAN_BUS") {
    if (mapping.engine_rpm) signals.engine_rpm = true;
  }
  if (capability === "FUEL_ROD") {
    if (mapping.fuel_level) signals.fuel_volume_liters = true;
  }
  if (mapping.odometer_km) signals.odometer_km = true;
  return signals;
}

function validateCapabilityMapping(
  capability: string,
  mapping: Record<string, string>
) {
  if (capability === "GPS_WITH_IGNITION" && !mapping.ignition_on) {
    return "Ignition-aware setup requires an ignition field mapping.";
  }
  if (capability === "CAN_BUS" && !mapping.engine_rpm) {
    return "Engine data setup requires an RPM field mapping.";
  }
  if (capability === "FUEL_ROD" && !mapping.fuel_level) {
    return "Tank fuel sensor setup requires a fuel/tank level field mapping.";
  }
  return null;
}

function customCapabilityFromChoice(value: any) {
  const key = String(value || "not_sure").trim().toLowerCase();
  return CUSTOM_CAPABILITY_OPTIONS[key] || "UNKNOWN";
}

function normalizeFleetTokenPlacement(value: any, authMethod: string) {
  const text = String(value || "").trim().toLowerCase();
  if (authMethod !== "post_login") return "";
  if (
    [
      "query_user_api_hash",
      "query_token",
      "authorization_bearer",
      "x_api_key",
      "none",
    ].includes(text)
  ) {
    return text;
  }
  return "authorization_bearer";
}

function applyFleetTokenPlacement(url: string, placement: string) {
  if (placement === "query_user_api_hash") {
    return appendQueryTemplate(url, "user_api_hash", "{{user_api_hash}}");
  }
  if (placement === "query_token") {
    return appendQueryTemplate(url, "token", "{{token}}");
  }
  return url;
}

function buildReportFeedPlaceholder(input: {
  baseUrl: string;
  authMethod: string;
  tokenPlacement: string;
}) {
  const baseUrl = String(input.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) return null;

  const tokenPlacement =
    input.authMethod === "post_login"
      ? input.tokenPlacement || "query_user_api_hash"
      : "";
  const reportEndpoint =
    tokenPlacement === "query_user_api_hash"
      ? appendQueryTemplate(`${baseUrl}/get_reports`, "user_api_hash", "{{user_api_hash}}")
      : tokenPlacement === "query_token"
        ? appendQueryTemplate(`${baseUrl}/get_reports`, "token", "{{token}}")
        : `${baseUrl}/get_reports`;

  return {
    name: "Report/distance feed",
    feed_type: "distance_report",
    endpoint_url: reportEndpoint,
    method: "GET",
    active: false,
    configured: false,
    setup_required: true,
    required_parameters: [
      "date range",
      "report type",
      "vehicle/device id if required",
      "row path",
      "distance field mapping",
    ],
    setup_message:
      "Report endpoint not configured yet. Ask provider for get_reports parameters: date range, report type, vehicle id, row path, and sample JSON.",
  };
}

function appendQueryTemplate(url: string, key: string, value: string) {
  const separator = url.includes("?") ? "&" : "?";
  const keyPattern = new RegExp(`([?&])${key}=`, "i");
  if (keyPattern.test(url)) return url;
  return `${url}${separator}${key}=${value}`;
}

function parseCustomRequestBody(value: any, method: string) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { payload: {} };
  }
  if (method !== "POST") {
    return { error: "Request body is only supported for POST endpoints." };
  }

  let parsed: any;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { error: "Request body must be valid JSON." };
    }
  } else {
    parsed = value;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Request body must be a JSON object." };
  }
  const sensitiveKey = findSensitiveKey(parsed);
  if (sensitiveKey) {
    return {
      error: `Request body cannot contain credential-like key '${sensitiveKey}'. Use the auth fields instead.`,
    };
  }
  return { payload: sanitizeSafeConfigObject(parsed) };
}

function validatePublicHttpsUrl(value: any, label: string) {
  const text = String(value || "").trim();
  if (!text) return { error: `${label} URL is required.` };
  if (text.length > 2000) return { error: `${label} URL is too long.` };

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { error: `${label} URL must be valid.` };
  }

  if (parsed.protocol !== "https:") {
    return { error: `${label} URL must use https.` };
  }
  if (isBlockedNetworkHost(parsed.hostname)) {
    return {
      error: `${label} URL cannot target localhost, private, link-local, or metadata network addresses.`,
    };
  }
  return { url: text };
}

function optionalPublicHttpsUrl(value: any, label: string) {
  const text = String(value || "").trim();
  if (!text) return { url: null };
  return validatePublicHttpsUrl(text, label);
}

function isBlockedNetworkHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (host.includes(":")) {
    return (
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80")
    );
  }

  return host.endsWith(".local");
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return numbers;
}

function validateProviderPath(value: any, label: string) {
  const text = String(value || "").trim();
  if (!text) return { error: `${label} is required.` };
  if (text.length > 160) return { error: `${label} is too long.` };
  if (/https?:\/\//i.test(text) || /[{}]/.test(text)) {
    return { error: `${label} must be a provider key/path, not a URL or template.` };
  }
  if (/,/.test(text) || /\s/.test(text)) {
    return {
      error: `${label} must be one JSON path only, for example data, items, devices, or data.vehicles.`,
    };
  }
  return { path: text };
}

function normalizeHttpMethod(value: any) {
  const method = String(value || "GET").trim().toUpperCase();
  return method === "GET" || method === "POST" ? method : "";
}

function safeHeaderName(value: any) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return "";
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(text) ? text : "";
}

function safeCredential(value: any, maxLength: number) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
}

function safeShortText(value: any, maxLength: number) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
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

function findSensitiveKey(value: any): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSensitiveKey(item);
      if (nested) return nested;
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveCapabilityKey(key)) return key;
    const nested = findSensitiveKey(entry);
    if (nested) return nested;
  }
  return null;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    truck: "Vehicle / registration field",
    latitude: "Latitude field",
    longitude: "Longitude field",
    recorded_at: "Timestamp field",
  };
  return labels[key] || key;
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );
  const capabilities = getProviderCapabilities(roles, isPlatformOwner);

  if (isPlatformOwner) {
    if (requestedCompanyId) {
      const { data: company, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .eq("id", requestedCompanyId)
        .maybeSingle();

      if (companyError) throw companyError;
      if (!company) {
        return {
          error: noStoreJson(
            { success: false, error: "Company not found" },
            { status: 404 }
          ),
        };
      }

      return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
  }

  const companyId = activeMemberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const { data: providers, error } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("company_id", resolved.company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      roles: resolved.roles,
      capabilities: resolved.capabilities,
      providers: (providers || []).map((provider) =>
        sanitizeProvider(provider, resolved.capabilities)
      ),
    });
  } catch (err: any) {
    console.error("Provider list error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load providers" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    if (!resolved.capabilities.can_add_provider) {
      return noStoreJson(
        { success: false, error: "Provider administration access required" },
        { status: 403 }
      );
    }

    const customApiResult =
      body.provider_mode === CUSTOM_API_PROVIDER_MODE
        ? buildCustomApiProviderConfig(body.custom_provider)
        : null;
    if (customApiResult?.error) {
      return noStoreJson(
        { success: false, error: customApiResult.error },
        { status: 400 }
      );
    }
    const customApiConfig: any = customApiResult?.config || null;

    const providerTemplate: any = !customApiConfig && body.template_id
      ? await loadProviderTemplateForCreate(
          body.template_id,
          resolved.capabilities.can_edit_advanced_provider_config
        )
      : null;

    if (
      body.template_id &&
      !customApiConfig &&
      !providerTemplate &&
      !resolved.capabilities.can_edit_advanced_provider_config
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Choose a supported provider or request provider setup.",
        },
        { status: 400 }
      );
    }

    if (
      !providerTemplate &&
      !customApiConfig &&
      !resolved.capabilities.can_edit_advanced_provider_config
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Choose a supported provider, custom API provider, or request assisted setup.",
        },
        { status: 400 }
      );
    }

    const effectiveAuthConfig = customApiConfig
      ? customApiConfig.auth_config
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.auth_config ?? providerTemplate?.auth_config ?? null
        : providerTemplate?.auth_config ?? null;
    const effectiveFleetConfig = customApiConfig
      ? customApiConfig.fleet_config
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.fleet_config ?? providerTemplate?.fleet_config ?? null
        : providerTemplate?.fleet_config ?? null;
    const effectiveFieldMapping = customApiConfig
      ? customApiConfig.field_mapping
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.field_mapping ?? providerTemplate?.field_mapping ?? {}
        : providerTemplate?.field_mapping ?? {};
    const effectiveCapabilityProfile = customApiConfig
      ? customApiConfig.capability_profile
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.capability_profile ?? providerTemplate?.capability_profile ?? effectiveFleetConfig?.capability_profile ?? {}
        : providerTemplate?.capability_profile ?? effectiveFleetConfig?.capability_profile ?? {};
    const effectiveSupportedSignals = customApiConfig
      ? customApiConfig.supported_signals
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.supported_signals ?? providerTemplate?.supported_signals ?? effectiveFleetConfig?.supported_signals ?? {}
        : providerTemplate?.supported_signals ?? effectiveFleetConfig?.supported_signals ?? {};
    const effectiveSourceSignalNotes = customApiConfig
      ? customApiConfig.source_signal_notes
      : resolved.capabilities.can_edit_advanced_provider_config
        ? body.source_signal_notes ?? providerTemplate?.source_signal_notes ?? {}
        : providerTemplate?.source_signal_notes ?? {};
    const loginUrl = String(
      customApiConfig?.login_url ||
        (resolved.capabilities.can_edit_advanced_provider_config
        ? body.login_url
        : null) ||
        providerTemplate?.default_login_url ||
        effectiveAuthConfig?.login_url ||
        ""
    ).trim() || null;
    const fleetUrl = String(
      customApiConfig?.fleet_url ||
        (resolved.capabilities.can_edit_advanced_provider_config
        ? body.fleet_url
        : null) ||
        providerTemplate?.default_fleet_url ||
        effectiveFleetConfig?.fleet_url ||
        ""
    ).trim() || null;
    const baseUrl = String(
      customApiConfig?.base_url ||
        (resolved.capabilities.can_edit_advanced_provider_config
        ? body.base_url
        : null) ||
        providerTemplate?.base_url ||
        providerTemplate?.default_base_url ||
        effectiveAuthConfig?.base_url ||
        effectiveFleetConfig?.base_url ||
        originFromUrl(fleetUrl)
    ).trim();

    const providerName = String(
      customApiConfig?.provider_name ||
        body.provider_name ||
        body.name ||
        providerTemplate?.display_name ||
        ""
    ).trim();
    const providerType = String(
      customApiConfig?.provider_type ||
        body.provider_type ||
        body.provider_slug ||
        providerTemplate?.slug ||
        ""
    ).trim();
    const authType = String(
      customApiConfig?.auth_type || body.auth_type || providerTemplate?.auth_type || ""
    ).trim();

    if (!providerName || !providerType || !baseUrl || !authType) {
      return noStoreJson(
        {
          success: false,
          error: "provider_name, provider_type, base_url, and auth_type are required",
        },
        { status: 400 }
      );
    }

    const usernameOverrideError = validateSupplementalUsernameOverrides(
      effectiveFleetConfig,
      resolved.isPlatformOwner
    );
    if (usernameOverrideError) {
      return noStoreJson(
        { success: false, error: usernameOverrideError },
        { status: usernameOverrideError.startsWith("Only platform owners") ? 403 : 400 }
      );
    }

    const insertPayload: Record<string, any> = {
      company_id: resolved.company.id,
      provider_name: providerName,
      provider_slug: providerType,
      auth_type: authType,
      auth_config: effectiveAuthConfig || null,
      fleet_config: effectiveFleetConfig || null,
      field_mapping: effectiveFieldMapping || {},
      username: body.username || null,
      api_key: body.api_key || null,
      password: body.password || null,
      bearer_token: body.bearer_token || null,
      base_url: baseUrl,
      login_url: loginUrl,
      fleet_url: fleetUrl,
      is_active: false,
      last_test_status: "not_tested",
      capability_profile: sanitizeOptionalObject(effectiveCapabilityProfile),
      supported_signals: sanitizeOptionalObject(effectiveSupportedSignals),
      provider_timezone: sanitizeProviderTimezone(
        customApiConfig?.provider_timezone ||
          body.provider_timezone ||
          providerTemplate?.provider_timezone ||
          effectiveFleetConfig?.provider_timezone
      ),
      source_signal_notes: sanitizeOptionalObject(effectiveSourceSignalNotes),
    };

    insertPayload.username =
      customApiConfig?.username !== undefined
        ? customApiConfig.username
        : insertPayload.username;
    insertPayload.api_key =
      customApiConfig?.api_key !== undefined
        ? customApiConfig.api_key
        : insertPayload.api_key;
    insertPayload.password =
      customApiConfig?.password !== undefined
        ? customApiConfig.password
        : insertPayload.password;
    insertPayload.bearer_token =
      customApiConfig?.bearer_token !== undefined
        ? customApiConfig.bearer_token
        : insertPayload.bearer_token;

    let { data: provider, error } = await supabaseAdmin
      .from("tracking_providers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (isMissingOptionalProviderCapabilityColumnError(error)) {
      const retry = await supabaseAdmin
        .from("tracking_providers")
        .insert(stripProviderCapabilityColumns(insertPayload))
        .select("*")
        .single();
      provider = retry.data;
      error = retry.error;
    }

    if (error) throw error;

    return noStoreJson({
      success: true,
      provider: sanitizeProvider(provider, resolved.capabilities),
    });
  } catch (err: any) {
    console.error("Provider create error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create provider" },
      { status: 500 }
    );
  }
}

function sanitizeOptionalObject(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return sanitizeSafeConfigObject(value);
}

function sanitizeSafeConfigObject(value: any, depth = 0): any {
  if (depth > 5) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeSafeConfigObject(entry, depth + 1));
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return value.slice(0, 500);
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      return value;
    }
    return String(value || "").slice(0, 500);
  }

  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveCapabilityKey(key)) continue;
    output[key] = sanitizeSafeConfigObject(entry, depth + 1);
  }
  return output;
}

function isSensitiveCapabilityKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return [
    "password",
    "token",
    "cookie",
    "authorization",
    "api_key",
    "apikey",
    "provider_secret",
    "auth_config",
    "raw_payload",
    "credentials",
    "secret",
    "bearer_token",
  ].some((blocked) => normalized.includes(blocked));
}

function sanitizeProviderTimezone(value: any) {
  const text = String(value || "").trim();
  return text && text.length <= 120 ? text : "Africa/Nairobi";
}

function stripProviderCapabilityColumns(payload: Record<string, any>) {
  const {
    capability_profile,
    supported_signals,
    provider_timezone,
    source_signal_notes,
    ...base
  } = payload;
  return base;
}

function isMissingOptionalProviderCapabilityColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}
