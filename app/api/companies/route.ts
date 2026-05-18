import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { supabase } from "../../../lib/supabase";

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

function normalizeRole(role: any) {
  return String(role || "").trim().toLowerCase();
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return noStoreJson({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return noStoreJson({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("company_users")
      .select("company_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) throw membershipError;

    const activeMemberships = memberships || [];
    const membershipSummary = activeMemberships.map((membership) => ({
      company_id: membership.company_id,
      role: normalizeRole(membership.role),
      is_active: Boolean(membership.is_active),
    }));
    const roles = Array.from(
      new Set(
        activeMemberships
          .map((membership) => normalizeRole(membership.role))
          .filter(Boolean)
      )
    );
    const isPlatformOwner = roles.includes("platform_owner");

    if (isPlatformOwner) {
      const { data: companies, error: companiesError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .order("name", { ascending: true });

      if (companiesError) throw companiesError;

      return noStoreJson({
        success: true,
        is_platform_owner: true,
        roles,
        memberships: membershipSummary,
        companies: companies || [],
      });
    }

    const companyIds = activeMemberships
      .map((membership) => membership.company_id)
      .filter(Boolean);

    if (companyIds.length === 0) {
      return noStoreJson({
        success: true,
        is_platform_owner: false,
        roles,
        memberships: membershipSummary,
        companies: [],
      });
    }

    const { data: companies, error: companiesError } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .in("id", companyIds)
      .order("name", { ascending: true });

    if (companiesError) throw companiesError;

    return noStoreJson({
      success: true,
      is_platform_owner: false,
      roles,
      memberships: membershipSummary,
      companies: companies || [],
    });
  } catch (err: any) {
    console.error("Companies route error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load companies" },
      { status: 500 }
    );
  }
}
