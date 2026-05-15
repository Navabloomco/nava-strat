import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { supabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      const { data: companies, error: companiesError } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .order("name", { ascending: true });

      if (companiesError) throw companiesError;

      return NextResponse.json({
        success: true,
        is_platform_owner: true,
        companies: companies || [],
      });
    }

    const companyIds = activeMemberships
      .map((membership) => membership.company_id)
      .filter(Boolean);

    if (companyIds.length === 0) {
      return NextResponse.json({
        success: true,
        is_platform_owner: false,
        companies: [],
      });
    }

    const { data: companies, error: companiesError } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .in("id", companyIds)
      .order("name", { ascending: true });

    if (companiesError) throw companiesError;

    return NextResponse.json({
      success: true,
      is_platform_owner: false,
      companies: companies || [],
    });
  } catch (err: any) {
    console.error("Companies route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load companies" },
      { status: 500 }
    );
  }
}
