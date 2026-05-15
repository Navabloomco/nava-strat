import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

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
    if (requestedCompanyId) {
      const { data: company, error: companyError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .eq("id", requestedCompanyId)
        .maybeSingle();

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

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

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

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      providers: (providers || []).map(sanitizeProvider),
    });
  } catch (err: any) {
    console.error("Provider list error:", err);
    return NextResponse.json(
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

    const providerName = String(body.provider_name || body.name || "").trim();
    const providerType = String(
      body.provider_type || body.provider_slug || ""
    ).trim();
    const authType = String(body.auth_type || "").trim();
    const baseUrl = String(body.base_url || "").trim();

    if (!providerName || !providerType || !baseUrl || !authType) {
      return NextResponse.json(
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

    return NextResponse.json({
      success: true,
      provider: sanitizeProvider(provider),
    });
  } catch (err: any) {
    console.error("Provider create error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to create provider" },
      { status: 500 }
    );
  }
}
