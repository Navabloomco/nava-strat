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

    const providerTemplate: any = body.template_id
      ? await loadProviderTemplateForCreate(
          body.template_id,
          resolved.capabilities.can_edit_advanced_provider_config
        )
      : null;

    if (
      body.template_id &&
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
      !resolved.capabilities.can_edit_advanced_provider_config
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Provider template is required for self-serve setup.",
        },
        { status: 400 }
      );
    }

    const effectiveAuthConfig =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.auth_config ?? providerTemplate?.auth_config ?? null
        : providerTemplate?.auth_config ?? null;
    const effectiveFleetConfig =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.fleet_config ?? providerTemplate?.fleet_config ?? null
        : providerTemplate?.fleet_config ?? null;
    const effectiveFieldMapping =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.field_mapping ?? providerTemplate?.field_mapping ?? {}
        : providerTemplate?.field_mapping ?? {};
    const effectiveCapabilityProfile =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.capability_profile ?? providerTemplate?.capability_profile ?? effectiveFleetConfig?.capability_profile ?? {}
        : providerTemplate?.capability_profile ?? effectiveFleetConfig?.capability_profile ?? {};
    const effectiveSupportedSignals =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.supported_signals ?? providerTemplate?.supported_signals ?? effectiveFleetConfig?.supported_signals ?? {}
        : providerTemplate?.supported_signals ?? effectiveFleetConfig?.supported_signals ?? {};
    const effectiveSourceSignalNotes =
      resolved.capabilities.can_edit_advanced_provider_config
        ? body.source_signal_notes ?? providerTemplate?.source_signal_notes ?? {}
        : providerTemplate?.source_signal_notes ?? {};
    const loginUrl = String(
      (resolved.capabilities.can_edit_advanced_provider_config
        ? body.login_url
        : null) ||
        providerTemplate?.default_login_url ||
        effectiveAuthConfig?.login_url ||
        ""
    ).trim() || null;
    const fleetUrl = String(
      (resolved.capabilities.can_edit_advanced_provider_config
        ? body.fleet_url
        : null) ||
        providerTemplate?.default_fleet_url ||
        effectiveFleetConfig?.fleet_url ||
        ""
    ).trim() || null;
    const baseUrl = String(
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
      body.provider_name || body.name || providerTemplate?.display_name || ""
    ).trim();
    const providerType = String(
      body.provider_type || body.provider_slug || providerTemplate?.slug || ""
    ).trim();
    const authType = String(body.auth_type || providerTemplate?.auth_type || "").trim();

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
        body.provider_timezone ||
          providerTemplate?.provider_timezone ||
          effectiveFleetConfig?.provider_timezone
      ),
      source_signal_notes: sanitizeOptionalObject(effectiveSourceSignalNotes),
    };

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
