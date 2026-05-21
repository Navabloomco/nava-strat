import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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

const SUPPORTED_SUPPLEMENTAL_MAPPING_TARGETS = new Set([
  "fuel_level",
  "odometer",
  "mileage",
  "engine_hours",
  "engine_rpm",
  "engine_on",
  "ignition_on",
  "fuel_rate",
  "lifetime_fuel_used",
  "fuel_raw",
  "fuel_volume_liters",
  "battery_voltage",
  "temperature",
  "driver_name",
]);

const BLOCKED_SUPPLEMENTAL_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "api-key",
  "token",
]);

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

const SUPPORTED_AUTH_PROFILE_TEMPLATE_MACROS = new Set([
  "username",
  "password",
  "provider_secret",
  "api_secret",
  "now_iso",
  "now_minus_1h_iso",
  "now_minus_24h_iso",
  "now_minus_7d_iso",
  "now_plus_1h_iso",
  "auth_user_id",
  "provider_user_id",
  "analytics_user_id",
]);

const AUTH_METADATA_KEYS = new Set([
  "auth_user_id",
  "provider_user_id",
  "analytics_user_id",
]);

const SAFE_AUTH_PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const USERNAME_OVERRIDE_REDACTION = "__configured__";

const BLOCKED_HEADER_TEMPLATE_MACROS = new Set([
  "api_key",
  "password",
  "provider_secret",
  "api_secret",
  "bearer_token",
  "token",
]);

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
    last_test_status: provider.last_test_status || null,
    last_test_message: provider.last_test_message || null,
    last_test_at: provider.last_test_at || null,
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null,
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

function preserveRedactedUsernameOverrides(fleetConfig: any, existingFleetConfig: any) {
  if (!fleetConfig || typeof fleetConfig !== "object" || Array.isArray(fleetConfig)) {
    return fleetConfig;
  }

  const nextConfig = JSON.parse(JSON.stringify(fleetConfig));
  const nextProfiles = nextConfig.supplemental_auth_profiles;
  const existingProfiles = existingFleetConfig?.supplemental_auth_profiles;
  if (!nextProfiles || typeof nextProfiles !== "object" || Array.isArray(nextProfiles)) {
    return nextConfig;
  }

  for (const [profileName, profile] of Object.entries(nextProfiles) as any[]) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) continue;
    if (profile.username_override !== USERNAME_OVERRIDE_REDACTION) continue;

    const existingOverride = existingProfiles?.[profileName]?.username_override;
    if (typeof existingOverride === "string" && existingOverride.trim()) {
      profile.username_override = existingOverride;
    } else {
      delete profile.username_override;
    }
  }

  return nextConfig;
}

function hasSupplementalFeedConfig(fleetConfig: any) {
  if (!fleetConfig || typeof fleetConfig !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(fleetConfig, "supplemental_feeds") ||
    Object.prototype.hasOwnProperty.call(fleetConfig, "supplemental_auth_profiles") ||
    Object.prototype.hasOwnProperty.call(fleetConfig, "current_status_url") ||
    Object.prototype.hasOwnProperty.call(fleetConfig, "fuel_status_url")
  );
}

function validateFleetConfigForSave(
  fleetConfig: any,
  context: {
    provider: any;
    body: any;
    isPlatformOwner: boolean;
  }
) {
  if (!fleetConfig || typeof fleetConfig !== "object" || Array.isArray(fleetConfig)) {
    return "fleet_config must be a valid object.";
  }

  if (!hasSupplementalFeedConfig(fleetConfig)) return null;

  if (!context.isPlatformOwner) {
    return "Only platform owners can configure supplemental enrichment feed URLs.";
  }

  const feeds = normalizeSupplementalFeedsForValidation(fleetConfig);
  if (feeds.length > 3) {
    return "At most 3 supplemental enrichment feeds are allowed.";
  }

  const knownHosts = getKnownProviderHosts(context.provider, context.body);
  const profilesError = validateSupplementalAuthProfiles(
    fleetConfig.supplemental_auth_profiles,
    knownHosts
  );
  if (profilesError) return profilesError;

  const profileNames = new Set(
    Object.keys(fleetConfig.supplemental_auth_profiles || {})
  );

  for (let index = 0; index < feeds.length; index += 1) {
    const feed = feeds[index];
    const label = feed.name ? `supplemental feed '${feed.name}'` : `supplemental feed ${index + 1}`;
    const error = validateSupplementalFeed(feed, label, knownHosts, profileNames);
    if (error) return error;
  }

  return null;
}

function normalizeSupplementalFeedsForValidation(fleetConfig: any) {
  const feeds: any[] = Array.isArray(fleetConfig.supplemental_feeds)
    ? [...fleetConfig.supplemental_feeds]
    : [];

  if (fleetConfig.current_status_url) {
    feeds.push({
      name: "current_status",
      url: fleetConfig.current_status_url,
      auth_profile: fleetConfig.current_status_auth_profile,
      method: fleetConfig.current_status_method,
      headers: fleetConfig.current_status_headers,
      payload: fleetConfig.current_status_payload,
      vehicle_paths: fleetConfig.current_status_vehicle_paths,
      match_keys: fleetConfig.current_status_match_keys,
      mapping: fleetConfig.current_status_mapping,
    });
  }

  if (fleetConfig.fuel_status_url) {
    feeds.push({
      name: "fuel_status",
      url: fleetConfig.fuel_status_url,
      auth_profile: fleetConfig.fuel_status_auth_profile || fleetConfig.current_status_auth_profile,
      method: fleetConfig.fuel_status_method,
      headers: fleetConfig.fuel_status_headers,
      payload: fleetConfig.fuel_status_payload,
      vehicle_paths: fleetConfig.fuel_status_vehicle_paths,
      match_keys: fleetConfig.fuel_status_match_keys,
      mapping: fleetConfig.fuel_status_mapping,
    });
  }

  return feeds;
}

function validateSupplementalAuthProfiles(
  profiles: any,
  knownHosts: Set<string>
) {
  if (profiles === undefined || profiles === null) return null;
  if (typeof profiles !== "object" || Array.isArray(profiles)) {
    return "supplemental_auth_profiles must be an object.";
  }

  const entries = Object.entries(profiles);
  if (entries.length > 3) {
    return "At most 3 supplemental auth profiles are allowed.";
  }

  for (const [profileName, profile] of entries) {
    const label = `supplemental auth profile '${profileName}'`;
    if (!SAFE_AUTH_PROFILE_NAME.test(profileName)) {
      return `${label} must use a safe identifier name.`;
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return `${label} must be an object.`;
    }

    const type = String((profile as any).type || "post_login").toLowerCase();
    if (type !== "post_login") {
      return `${label} type must be post_login.`;
    }

    const method = String((profile as any).method || "POST").toUpperCase();
    if (!["GET", "POST"].includes(method)) {
      return `${label} method must be GET or POST.`;
    }

    if ((profile as any).username_override !== undefined) {
      const usernameOverride = String((profile as any).username_override || "").trim();
      if (!usernameOverride || usernameOverride.length > 255) {
        return `${label} username_override must be a short value.`;
      }
    }

    const urlError = validateSupplementalUrl(
      (profile as any).login_url,
      label,
      knownHosts
    );
    if (urlError) return urlError;

    const headersError = validateSupplementalHeaders(
      (profile as any).headers,
      label
    );
    if (headersError) return headersError;

    const tokenPathError = validateStringArray(
      (profile as any).token_paths,
      `${label} token_paths`,
      10,
      160
    );
    if (tokenPathError) return tokenPathError;

    const metadataPathError = validateMetadataPaths(
      (profile as any).metadata_paths,
      label
    );
    if (metadataPathError) return metadataPathError;

    if ((profile as any).payload !== undefined) {
      try {
        const payloadText = JSON.stringify((profile as any).payload);
        if (payloadText.length > 12000) return `${label} payload is too large.`;
      } catch {
        return `${label} payload must be valid JSON.`;
      }

      const macroError = validateTemplateMacros(
        (profile as any).payload,
        `${label} payload`,
        SUPPORTED_AUTH_PROFILE_TEMPLATE_MACROS
      );
      if (macroError) return macroError;
    }
  }

  return null;
}

function validateSupplementalFeed(
  feed: any,
  label: string,
  knownHosts: Set<string>,
  profileNames: Set<string>
) {
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    return `${label} must be an object.`;
  }

  const name = String(feed.name || "").trim();
  if (name.length > 64) return `${label} name is too long.`;

  const method = String(feed.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) {
    return `${label} method must be GET or POST.`;
  }

  const urlError = validateSupplementalUrl(feed.url, label, knownHosts);
  if (urlError) return urlError;

  if (feed.auth_profile !== undefined && feed.auth_profile !== null && feed.auth_profile !== "") {
    const profileName = String(feed.auth_profile || "").trim();
    if (!SAFE_AUTH_PROFILE_NAME.test(profileName)) {
      return `${label} auth_profile must be a safe identifier.`;
    }
    if (!profileNames.has(profileName)) {
      return `${label} references unknown auth_profile '${profileName}'.`;
    }
  }

  const headersError = validateSupplementalHeaders(feed.headers, label);
  if (headersError) return headersError;

  const pathError = validateStringArray(feed.vehicle_paths, `${label} vehicle_paths`, 10, 160);
  if (pathError) return pathError;

  const matchKeyError = validateStringArray(feed.match_keys, `${label} match_keys`, 12, 80);
  if (matchKeyError) return matchKeyError;

  const mappingError = validateSupplementalMapping(feed.mapping, label);
  if (mappingError) return mappingError;

  if (feed.payload !== undefined) {
    try {
      const payloadText = JSON.stringify(feed.payload);
      if (payloadText.length > 10000) return `${label} payload is too large.`;
    } catch {
      return `${label} payload must be valid JSON.`;
    }

    const macroError = validateTemplateMacros(feed.payload, `${label} payload`);
    if (macroError) return macroError;
  }

  return null;
}

function validateTemplateMacros(
  value: any,
  label: string,
  supportedMacros: Set<string> = SUPPORTED_TEMPLATE_MACROS
) {
  const macros = collectTemplateMacros(value);
  const unknownMacros = macros.filter(
    (macro) => !supportedMacros.has(macro)
  );

  if (unknownMacros.length > 0) {
    return `${label} contains unsupported template macro '${unknownMacros[0]}'.`;
  }

  return null;
}

function validateMetadataPaths(value: any, label: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return `${label} metadata_paths must be an object.`;
  }

  const entries = Object.entries(value);
  if (entries.length > 3) return `${label} metadata_paths has too many entries.`;

  for (const [key, path] of entries) {
    if (!AUTH_METADATA_KEYS.has(key)) {
      return `${label} metadata path '${key}' is not supported.`;
    }
    const pathText = String(path || "").trim();
    if (!pathText || pathText.length > 160) {
      return `${label} metadata path '${key}' must be a short response path.`;
    }
  }

  return null;
}

function collectTemplateMacros(value: any, output = new Set<string>()) {
  if (typeof value === "string") {
    const macroPattern = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
    let match = macroPattern.exec(value);
    while (match) {
      output.add(match[1]);
      match = macroPattern.exec(value);
    }
    return Array.from(output);
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTemplateMacros(item, output);
    return Array.from(output);
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectTemplateMacros(nested, output);
    }
  }

  return Array.from(output);
}

function validateSupplementalUrl(value: any, label: string, knownHosts: Set<string>) {
  const urlText = String(value || "").trim();
  if (!urlText) return `${label} URL is required.`;
  if (urlText.length > 2000) return `${label} URL is too long.`;

  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return `${label} URL must be valid.`;
  }

  if (parsed.protocol !== "https:") {
    return `${label} URL must use https.`;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedNetworkHost(hostname)) {
    return `${label} URL cannot target localhost, private, link-local, or metadata network addresses.`;
  }

  if (knownHosts.size > 0 && !knownHosts.has(hostname)) {
    console.warn("Supplemental feed host differs from known provider host", {
      provider_host_count: knownHosts.size,
      supplemental_host: hostname,
    });
  }

  return null;
}

function validateSupplementalHeaders(headers: any, label: string) {
  if (headers === undefined || headers === null) return null;
  if (typeof headers !== "object" || Array.isArray(headers)) {
    return `${label} headers must be an object.`;
  }

  const entries = Object.entries(headers);
  if (entries.length > 20) return `${label} has too many headers.`;

  for (const [headerName, headerValue] of entries) {
    const normalizedName = headerName.trim().toLowerCase();
    if (!normalizedName || normalizedName.length > 80) {
      return `${label} has an invalid header name.`;
    }
    if (BLOCKED_SUPPLEMENTAL_HEADER_NAMES.has(normalizedName)) {
      return `${label} cannot set credential-like header '${headerName}'. Use the secure provider auth fields instead.`;
    }
    if (String(headerValue || "").length > 500) {
      return `${label} header '${headerName}' is too long.`;
    }
    const macros = collectTemplateMacros(headerValue);
    const blockedMacro = macros.find((macro) =>
      BLOCKED_HEADER_TEMPLATE_MACROS.has(macro)
    );
    if (blockedMacro) {
      return `${label} header '${headerName}' cannot contain credential template macro '${blockedMacro}'. Use the secure provider auth fields instead.`;
    }
  }

  return null;
}

function validateStringArray(
  value: any,
  label: string,
  maxItems: number,
  maxLength: number
) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return `${label} must be an array.`;
  if (value.length > maxItems) return `${label} has too many entries.`;

  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || text.length > maxLength) {
      return `${label} contains an invalid entry.`;
    }
  }

  return null;
}

function validateSupplementalMapping(mapping: any, label: string) {
  if (mapping === undefined || mapping === null) return null;
  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    return `${label} mapping must be an object.`;
  }

  const entries = Object.entries(mapping);
  if (entries.length > 20) return `${label} mapping has too many fields.`;

  for (const [target, path] of entries) {
    if (!SUPPORTED_SUPPLEMENTAL_MAPPING_TARGETS.has(target)) {
      return `${label} mapping target '${target}' is not supported.`;
    }
    const pathText = String(path || "").trim();
    if (!pathText || pathText.length > 160) {
      return `${label} mapping for '${target}' must be a short provider key/path.`;
    }
  }

  return null;
}

function getKnownProviderHosts(provider: any, body: any) {
  const urls = [
    body.base_url,
    body.login_url,
    body.fleet_url,
    provider.base_url,
    provider.login_url,
    provider.fleet_url,
  ];
  const hosts = new Set<string>();

  for (const value of urls) {
    try {
      if (value) hosts.add(new URL(String(value)).hostname.toLowerCase());
    } catch {
      // Ignore invalid existing provider URLs here; their own fields are validated elsewhere.
    }
  }

  return hosts;
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

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: NextResponse.json(
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
      error: NextResponse.json(
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
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    if (
      !resolved.capabilities.can_edit_advanced_provider_config &&
      !resolved.capabilities.can_update_provider_credentials
    ) {
      return NextResponse.json(
        { success: false, error: "Provider administration access required" },
        { status: 403 }
      );
    }

    const { data: existingProvider, error: providerError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", params.id)
      .eq("company_id", resolved.company.id)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!existingProvider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    const updates: Record<string, any> = {};
    const credentialFields = [
      "username",
      "api_key",
      "password",
      "bearer_token",
    ];
    const advancedFields = [
      "provider_name",
      "provider_slug",
      "auth_type",
      "auth_config",
      "fleet_config",
      "field_mapping",
      "base_url",
      "login_url",
      "fleet_url",
      "is_active",
      "capability_profile",
      "supported_signals",
      "provider_timezone",
      "source_signal_notes",
    ];
    const allowedFields = resolved.capabilities.can_edit_advanced_provider_config
      ? [...advancedFields, ...credentialFields]
      : credentialFields;

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates[field] = body[field];
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, "fleet_config")) {
      updates.fleet_config = preserveRedactedUsernameOverrides(
        updates.fleet_config,
        existingProvider.fleet_config
      );
      const validationError = validateFleetConfigForSave(updates.fleet_config, {
        provider: existingProvider,
        body,
        isPlatformOwner: resolved.isPlatformOwner,
      });

      if (validationError) {
        const status = validationError.startsWith("Only platform owners")
          ? 403
          : 400;
        return NextResponse.json(
          { success: false, error: validationError },
          { status }
        );
      }
    }

    if (
      resolved.capabilities.can_edit_advanced_provider_config &&
      Object.prototype.hasOwnProperty.call(body, "name")
    ) {
      updates.provider_name = body.name;
    }
    if (
      resolved.capabilities.can_edit_advanced_provider_config &&
      Object.prototype.hasOwnProperty.call(body, "provider_type")
    ) {
      updates.provider_slug = body.provider_type;
    }

    for (const field of credentialFields) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        updates[field] = updates[field] || null;
      }
    }

    for (const field of ["capability_profile", "supported_signals", "source_signal_notes"]) {
      if (Object.prototype.hasOwnProperty.call(updates, field)) {
        updates[field] = sanitizeOptionalObject(updates[field]);
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "provider_timezone")) {
      updates.provider_timezone = sanitizeProviderTimezone(updates.provider_timezone);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: true,
        provider: sanitizeProvider(existingProvider, resolved.capabilities),
      });
    }

    let { data: provider, error } = await supabaseAdmin
      .from("tracking_providers")
      .update(updates)
      .eq("id", params.id)
      .eq("company_id", resolved.company.id)
      .select("*")
      .single();

    if (isMissingOptionalProviderCapabilityColumnError(error)) {
      const retryUpdates = stripProviderCapabilityColumns(updates);
      if (Object.keys(retryUpdates).length === 0) {
        return NextResponse.json({
          success: true,
          provider: sanitizeProvider(existingProvider, resolved.capabilities),
          capability_setup_pending: true,
        });
      }

      const retry = await supabaseAdmin
        .from("tracking_providers")
        .update(retryUpdates)
        .eq("id", params.id)
        .eq("company_id", resolved.company.id)
        .select("*")
        .single();
      provider = retry.data;
      error = retry.error;
    }

    if (error) throw error;

    return NextResponse.json({
      success: true,
      provider: sanitizeProvider(provider, resolved.capabilities),
    });
  } catch (err: any) {
    console.error("Provider update error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to update provider" },
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
