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
    ];
    const allowedFields = resolved.capabilities.can_edit_advanced_provider_config
      ? [...advancedFields, ...credentialFields]
      : credentialFields;

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates[field] = body[field];
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

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: true,
        provider: sanitizeProvider(existingProvider, resolved.capabilities),
      });
    }

    const { data: provider, error } = await supabaseAdmin
      .from("tracking_providers")
      .update(updates)
      .eq("id", params.id)
      .eq("company_id", resolved.company.id)
      .select("*")
      .single();

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
