import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveManageAccessResult =
  | {
      company: ResolvedCompany;
      userId: string;
      roles: string[];
      isPlatformOwner: boolean;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      userId?: never;
      roles?: never;
      isPlatformOwner?: never;
    };

const MANAGER_ROLES = new Set(["owner", "admin", "platform_owner"]);

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeLink(link: any) {
  return {
    id: link.id,
    client_name: link.client_name,
    display_name: link.display_name || null,
    expires_at: link.expires_at || null,
    active_until_revoked: Boolean(link.active_until_revoked),
    revoked_at: link.revoked_at || null,
    last_accessed_at: link.last_accessed_at || null,
    access_count: Number(link.access_count || 0),
    created_at: link.created_at || null,
    updated_at: link.updated_at || null,
  };
}

async function resolveManageAccess(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveManageAccessResult> {
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
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const canManage = roles.some((role) => MANAGER_ROLES.has(role));

  if (!canManage) {
    return {
      error: noStoreJson(
        { success: false, error: "Client visibility management access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
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

    return {
      company: company as ResolvedCompany,
      userId: user.id,
      roles,
      isPlatformOwner,
    };
  }

  const managerMembership = activeMemberships.find((membership) =>
    MANAGER_ROLES.has(String(membership.role || "").toLowerCase())
  );
  const companyId = managerMembership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Client visibility management access required" },
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

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    roles,
    isPlatformOwner,
  };
}

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getPublicUrl(req: Request, token: string) {
  const origin = req.headers.get("origin");
  if (origin?.startsWith("http://") || origin?.startsWith("https://")) {
    return `${origin}/client/track/${token}`;
  }

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (
    (forwardedProto === "https" || forwardedProto === "http") &&
    forwardedHost
  ) {
    return `${forwardedProto}://${forwardedHost}/client/track/${token}`;
  }

  const host = req.headers.get("host");
  if (host) {
    return `https://${host}/client/track/${token}`;
  }

  const fallback = process.env.NEXT_PUBLIC_SITE_URL || "";
  return `${fallback.replace(/\/$/, "")}/client/track/${token}`;
}

function normalizeClientName(value: any) {
  return String(value || "").trim().toUpperCase();
}

function resolveExpiry(body: any) {
  const mode = String(body.expiry_mode || "12_months");
  const now = new Date();

  if (mode === "active_until_revoked") {
    return { expires_at: null, active_until_revoked: true };
  }
  if (mode === "custom_date") {
    const customDate = body.custom_expires_at || body.expires_at;
    const parsed = customDate ? new Date(customDate) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed <= now) {
      throw new Error("A valid future custom expiry date is required");
    }
    return { expires_at: parsed.toISOString(), active_until_revoked: false };
  }

  const daysByMode: Record<string, number> = {
    "7_days": 7,
    "30_days": 30,
    "90_days": 90,
    "6_months": 183,
    "12_months": 365,
  };
  const days = daysByMode[mode] || daysByMode["12_months"];
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return { expires_at: expiresAt.toISOString(), active_until_revoked: false };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveManageAccess(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const { data: links, error } = await supabaseAdmin
      .from("client_visibility_links")
      .select(
        "id, client_name, display_name, expires_at, active_until_revoked, revoked_at, last_accessed_at, access_count, created_at, updated_at"
      )
      .eq("company_id", resolved.company.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      links: (links || []).map(sanitizeLink),
    });
  } catch (err: any) {
    console.error("Client visibility links GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load client visibility links" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveManageAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const clientName = normalizeClientName(body.client_name);
    if (!clientName) {
      return noStoreJson(
        { success: false, error: "client_name is required" },
        { status: 400 }
      );
    }

    const expiry = resolveExpiry(body);
    const token = generateToken();
    const tokenHash = hashToken(token);

    const { data: link, error } = await supabaseAdmin
      .from("client_visibility_links")
      .insert({
        company_id: resolved.company.id,
        client_name: clientName,
        display_name: body.display_name ? String(body.display_name).trim() : null,
        token_hash: tokenHash,
        expires_at: expiry.expires_at,
        active_until_revoked: expiry.active_until_revoked,
        created_by: resolved.userId,
      })
      .select(
        "id, client_name, display_name, expires_at, active_until_revoked, revoked_at, last_accessed_at, access_count, created_at, updated_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      link: sanitizeLink(link),
      public_url: getPublicUrl(req, token),
    });
  } catch (err: any) {
    console.error("Client visibility links POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create client visibility link" },
      { status: 500 }
    );
  }
}
