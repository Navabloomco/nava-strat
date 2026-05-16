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
    baseProvider.fleet_config = provider.fleet_config || {};
  }

  return baseProvider;
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

    const providerName = String(body.provider_name || body.name || "").trim();
    const providerType = String(
      body.provider_type || body.provider_slug || ""
    ).trim();
    const authType = String(body.auth_type || "").trim();
    const baseUrl = String(body.base_url || "").trim();

    if (!providerName || !providerType || !baseUrl || !authType) {
      return noStoreJson(
        {
          success: false,
          error: "provider_name, provider_type, base_url, and auth_type are required",
        },
        { status: 400 }
      );
    }

    const insertPayload = {
      company_id: resolved.company.id,
      provider_name: providerName,
      provider_slug: providerType,
      auth_type: authType,
      auth_config: body.auth_config || null,
      fleet_config: body.fleet_config || null,
      field_mapping: body.field_mapping || {},
      username: body.username || null,
      api_key: body.api_key || null,
      password: body.password || null,
      bearer_token: body.bearer_token || null,
      base_url: baseUrl,
      login_url: body.login_url || null,
      fleet_url: body.fleet_url || null,
      is_active: body.is_active ?? true,
      last_test_status: "not_tested",
    };

    const { data: provider, error } = await supabaseAdmin
      .from("tracking_providers")
      .insert(insertPayload)
      .select("*")
      .single();

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
