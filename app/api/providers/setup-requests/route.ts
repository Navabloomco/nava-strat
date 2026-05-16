import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; error?: never }
  | { error: NextResponse; company?: never };

type AuthContext =
  | { userId: string; roles: string[]; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; userId?: never; roles?: never; isPlatformOwner?: never };

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeRequest(request: any) {
  return {
    id: request.id,
    company_id: request.company_id,
    company_name: request.company_name || null,
    user_id: request.user_id,
    provider_name: request.provider_name,
    provider_website: request.provider_website || null,
    provider_contact: request.provider_contact || null,
    access_type_known: request.access_type_known || "unsure",
    notes: request.notes || null,
    status: request.status || "new",
    internal_notes: request.internal_notes || null,
    created_at: request.created_at || null,
    updated_at: request.updated_at || null,
  };
}

async function getAuthContext(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const roles = Array.from(
    new Set(
      (memberships || [])
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );

  return {
    userId: user.id,
    roles,
    isPlatformOwner: roles.includes("platform_owner"),
  };
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult & { userId?: string }> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
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
        error: noStoreJson(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return { company: company as ResolvedCompany, userId: user.id };
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

  return { company: company as ResolvedCompany, userId: user.id };
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext(req);
    if (auth.error) return auth.error;

    if (!auth.isPlatformOwner) {
      return noStoreJson(
        { success: false, error: "Platform owner access required" },
        { status: 403 }
      );
    }

    const { data: requests, error } = await supabaseAdmin
      .from("provider_setup_requests")
      .select(
        "id, company_id, user_id, provider_name, provider_website, provider_contact, access_type_known, notes, status, internal_notes, created_at, updated_at"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const companyIds = Array.from(
      new Set((requests || []).map((request) => request.company_id).filter(Boolean))
    );
    const companyNames = new Map<string, string>();

    if (companyIds.length > 0) {
      const { data: companies, error: companiesError } = await supabaseAdmin
        .from("companies")
        .select("id, name")
        .in("id", companyIds);

      if (companiesError) throw companiesError;

      for (const company of companies || []) {
        companyNames.set(company.id, company.name);
      }
    }

    return noStoreJson({
      success: true,
      requests: (requests || []).map((request) =>
        sanitizeRequest({
          ...request,
          company_name: companyNames.get(request.company_id) || null,
        })
      ),
    });
  } catch (err: any) {
    console.error("Provider setup request list error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load provider requests" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    const providerName = String(body.provider_name || "").trim();
    const accessType = String(body.access_type_known || "unsure").trim();
    const allowedAccessTypes = new Set([
      "username_password",
      "api_key",
      "token",
      "unsure",
    ]);

    if (!providerName) {
      return noStoreJson(
        { success: false, error: "provider_name is required" },
        { status: 400 }
      );
    }

    if (!allowedAccessTypes.has(accessType)) {
      return noStoreJson(
        { success: false, error: "Invalid access_type_known" },
        { status: 400 }
      );
    }

    const insertPayload = {
      company_id: resolved.company.id,
      user_id: resolved.userId,
      provider_name: providerName,
      provider_website: body.provider_website || null,
      provider_contact: body.provider_contact || null,
      access_type_known: accessType,
      notes: body.notes || null,
      status: "new",
    };

    const { data: request, error } = await supabaseAdmin
      .from("provider_setup_requests")
      .insert(insertPayload)
      .select(
        "id, company_id, user_id, provider_name, provider_website, provider_contact, access_type_known, notes, status, created_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      request: sanitizeRequest(request),
    });
  } catch (err: any) {
    console.error("Provider setup request error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to submit provider setup request" },
      { status: 500 }
    );
  }
}
