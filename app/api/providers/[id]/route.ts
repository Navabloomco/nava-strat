import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; company?: never; isPlatformOwner?: never };

function sanitizeProvider(provider: any) {
  return {
    id: provider.id,
    company_id: provider.company_id,
    name: provider.provider_name,
    provider_name: provider.provider_name,
    provider_type: provider.provider_type || provider.provider_slug || null,
    provider_slug: provider.provider_slug || null,
    auth_type: provider.auth_type || null,
    username: provider.username || null,
    base_url: provider.base_url || null,
    login_url: provider.login_url || null,
    fleet_url: provider.fleet_url || null,
    is_active: Boolean(provider.is_active),
    status: provider.last_test_status || (provider.is_active ? "active" : "inactive"),
    last_test_status: provider.last_test_status || null,
    last_test_message: provider.last_test_message || null,
    last_test_at: provider.last_test_at || null,
    last_sync_at: provider.last_sync_at || provider.last_test_at || null,
    field_mapping: provider.field_mapping || {},
    fleet_config: provider.fleet_config || {},
    has_api_key: Boolean(provider.api_key),
    has_password: Boolean(provider.password),
    has_bearer_token: Boolean(provider.bearer_token),
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null,
  };
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );

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

    return { company: company as ResolvedCompany, isPlatformOwner };
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

  return { company: company as ResolvedCompany, isPlatformOwner };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

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
    const allowedFields = [
      "provider_name",
      "provider_slug",
      "auth_type",
      "auth_config",
      "fleet_config",
      "field_mapping",
      "username",
      "base_url",
      "login_url",
      "fleet_url",
      "is_active",
    ];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        updates[field] = body[field];
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      updates.provider_name = body.name;
    }
    if (Object.prototype.hasOwnProperty.call(body, "provider_type")) {
      updates.provider_slug = body.provider_type;
    }
    if (Object.prototype.hasOwnProperty.call(body, "api_key")) {
      updates.api_key = body.api_key || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "password")) {
      updates.password = body.password || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "bearer_token")) {
      updates.bearer_token = body.bearer_token || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: true,
        provider: sanitizeProvider(existingProvider),
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
      provider: sanitizeProvider(provider),
    });
  } catch (err: any) {
    console.error("Provider update error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to update provider" },
      { status: 500 }
    );
  }
}
