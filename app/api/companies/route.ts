import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

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

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    const isPlatformOwner =
      memberships?.some((m) => m.role === "platform_owner") || false;

    if (isPlatformOwner) {
      const { data: companies, error } = await supabaseAdmin
        .from("companies")
        .select("id, name, slug")
        .order("name", { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        is_platform_owner: true,
        companies: companies || [],
      });
    }

    const companyIds = memberships?.map((m) => m.company_id).filter(Boolean) || [];

    if (companyIds.length === 0) {
      return NextResponse.json({
        success: true,
        is_platform_owner: false,
        companies: [],
      });
    }

    const { data: companies, error } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug")
      .in("id", companyIds)
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      is_platform_owner: false,
      companies: companies || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to load companies" },
      { status: 500 }
    );
  }
}
