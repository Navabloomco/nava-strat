import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MEITRACK_CAN_BUS_TEMPLATE = {
  id: "internal-meitrack-can-bus-template",
  display_name: "Meitrack CAN Bus Example",
  slug: "meitrack",
  auth_type: "API_KEY",
  auth_config: {},
  fleet_config: {
    setup_only: true,
    capability_profile: {
      default_capability: "CAN_BUS",
      note:
        "Example template only. Confirm exact Meitrack API endpoints and available signals before enabling sync.",
    },
    supported_signals: {
      latitude: true,
      longitude: true,
      speed: true,
      recorded_at: true,
      ignition_on: true,
      engine_rpm: true,
      fuel_rate: true,
      lifetime_fuel_used: true,
      engine_hours: true,
    },
    provider_timezone: "Africa/Nairobi",
  },
  field_mapping: {
    truck: "reg_no",
    latitude: "latitude",
    longitude: "longitude",
    speed: "speed",
    engine_rpm: "rpm",
    fuel_rate: "fuelRate",
    lifetime_fuel_used: "totalFuel",
    engine_hours: "engineHours",
    ignition_on: "ignition",
  },
  default_login_url: null,
  default_fleet_url: null,
  capability_profile: {
    default_capability: "CAN_BUS",
  },
  supported_signals: {
    latitude: true,
    longitude: true,
    speed: true,
    recorded_at: true,
    ignition_on: true,
    engine_rpm: true,
    fuel_rate: true,
    lifetime_fuel_used: true,
    engine_hours: true,
  },
  provider_timezone: "Africa/Nairobi",
  source_signal_notes: {
    onboarding_note:
      "Example mapping only; do not add live credentials until exact tenant Meitrack API access is verified.",
  },
  setup_only: true,
};

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
    const safeTemplates = appendInternalTemplates(templates || []);

    return noStoreJson({
      success: true,
      templates: safeTemplates,
    });
  } catch (err: any) {
    console.error("Provider templates error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load provider templates" },
      { status: 500 }
    );
  }
}

function appendInternalTemplates(templates: any[]) {
  const existingSlugs = new Set(
    templates.map((template) => String(template.slug || "").toLowerCase())
  );
  if (existingSlugs.has(MEITRACK_CAN_BUS_TEMPLATE.slug)) return templates;
  return [...templates, MEITRACK_CAN_BUS_TEMPLATE].sort((a, b) =>
    String(a.display_name || "").localeCompare(String(b.display_name || ""))
  );
}
