import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from("company_users")
      .select("company_id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (membershipError) throw membershipError;

    if (!memberships || memberships.length === 0) {
      return noStoreJson(
        { success: false, error: "No active company access" },
        { status: 403 }
      );
    }

    const { data: templates, error: templatesError } = await supabaseAdmin
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
      .eq("is_public", true)
      .eq("is_verified", true)
      .order("display_name", { ascending: true });

    if (templatesError) throw templatesError;

    return noStoreJson({
      success: true,
      templates: templates || [],
    });
  } catch (err: any) {
    console.error("Provider templates error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load provider templates" },
      { status: 500 }
    );
  }
}
