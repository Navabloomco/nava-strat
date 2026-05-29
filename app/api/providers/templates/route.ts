import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MEITRACK_CAN_BUS_TEMPLATE = {
  id: "internal-meitrack-can-bus-template",
  display_name: "Meitrack CAN Bus Example",
  internal_template: true,
  customer_facing: false,
  slug: "meitrack",
  auth_type: "API_KEY",
  auth_method_label: "API key / provider credentials",
  required_fields: [
    { name: "username", label: "API Username", secret: false },
    { name: "api_key", label: "API Key / Secret", secret: true },
  ],
  default_endpoint_labels: [
    "Meitrack API endpoint",
    "Fleet telemetry feed",
  ],
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
  self_serve: false,
  requires_provider_support: true,
  setup_notes: [
    "Setup-only signal mapping for Meitrack/CAN planning.",
    "Confirm tenant API endpoints and available signals before collecting live credentials.",
  ],
};

const GENERIC_REST_GPS_TEMPLATE = {
  id: "internal-generic-rest-gps-template",
  display_name: "Generic REST GPS",
  internal_template: true,
  customer_facing: false,
  slug: "generic-rest-gps",
  auth_type: "API_KEY",
  auth_method_label: "API key / token",
  required_fields: [
    { name: "api_key", label: "API Key / Token", secret: true },
  ],
  default_endpoint_labels: [
    "Provider login or token endpoint",
    "Fleet location feed",
  ],
  auth_config: {},
  fleet_config: {
    setup_only: true,
    capability_profile: {
      default_capability: "GPS_ONLY",
      note:
        "Generic setup template. Platform owner must verify provider feed, vehicle data group, and field mapping before live sync.",
    },
    supported_signals: {
      latitude: true,
      longitude: true,
      speed: true,
      recorded_at: true,
    },
    provider_timezone: "Africa/Nairobi",
  },
  field_mapping: {
    truck: "truck",
    latitude: "latitude",
    longitude: "longitude",
    speed: "speed",
    recorded_at: "recorded_at",
  },
  default_login_url: null,
  default_fleet_url: null,
  capability_profile: {
    default_capability: "GPS_ONLY",
  },
  supported_signals: {
    latitude: true,
    longitude: true,
    speed: true,
    recorded_at: true,
  },
  provider_timezone: "Africa/Nairobi",
  source_signal_notes: {
    onboarding_note:
      "Generic GPS setup requires a verified provider feed, vehicle data group, and vehicle identifier mapping before live sync.",
  },
  setup_only: true,
  self_serve: false,
  requires_provider_support: true,
  setup_notes: [
    "Use when a provider exposes a REST GPS feed but Nava has not verified the exact connection yet.",
  ],
};

const GENERIC_CSV_DISTANCE_TEMPLATE = {
  id: "internal-generic-csv-distance-template",
  display_name: "Generic CSV Distance Report",
  internal_template: true,
  customer_facing: false,
  slug: "generic-csv-distance-report",
  auth_type: "NONE",
  auth_method_label: "CSV fallback/backfill",
  required_fields: [],
  default_endpoint_labels: ["CSV distance report upload"],
  auth_config: {},
  fleet_config: {
    setup_only: true,
    distance_report_only: true,
    capability_profile: {
      default_capability: "UNKNOWN",
      note:
        "CSV distance reports are fallback/backfill evidence and do not create live telemetry sync.",
    },
    supported_signals: {},
    provider_timezone: "Africa/Nairobi",
  },
  field_mapping: {
    truck: "Vehicle",
    report_start_time: "StartLocationTime",
    report_end_time: "EndLocationTime",
    start_location: "StartLocation",
    end_location: "EndLocation",
    start_odometer: "StartOdometer",
    end_odometer: "EndOdometer",
    mileage: "Mileage",
    motion_duration: "MotionDuration",
    violations_count: "Violations",
  },
  default_login_url: null,
  default_fleet_url: null,
  capability_profile: {
    default_capability: "UNKNOWN",
  },
  supported_signals: {},
  provider_timezone: "Africa/Nairobi",
  source_signal_notes: {
    onboarding_note:
      "Fallback/backfill import only. Automated provider API feeds remain the primary product workflow.",
  },
  setup_only: true,
  self_serve: false,
  requires_provider_support: false,
  setup_notes: [
    "Use CSV distance reports only as fallback/backfill when automated report feeds are unavailable.",
    "Import writes provider trip summaries, not live point telemetry.",
  ],
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

    const isPlatformOwner = memberships.some(
      (membership) =>
        String(membership.role || "").toLowerCase() === "platform_owner"
    );

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
    const visibleTemplates = isPlatformOwner
      ? appendInternalTemplates(templates || [])
      : (templates || []).filter(isCustomerFacingTemplate);
    const safeTemplates = visibleTemplates
      .map(decorateTemplate)
      .map((template) =>
        isPlatformOwner ? template : sanitizeCustomerTemplate(template)
      );

    return noStoreJson({
      success: true,
      templates: safeTemplates,
      can_view_internal_templates: isPlatformOwner,
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
  const additions = [
    MEITRACK_CAN_BUS_TEMPLATE,
    GENERIC_REST_GPS_TEMPLATE,
    GENERIC_CSV_DISTANCE_TEMPLATE,
  ].filter(
    (template) => !existingSlugs.has(String(template.slug || "").toLowerCase())
  );
  return [...templates, ...additions].sort((a, b) =>
    String(a.display_name || "").localeCompare(String(b.display_name || ""))
  );
}

function decorateTemplate(template: any) {
  const setupOnly = Boolean(template.setup_only || template.fleet_config?.setup_only);
  const internalTemplate = Boolean(
    template.internal_template ||
      template.fleet_config?.internal_template ||
      setupOnly
  );
  return {
    ...template,
    internal_template: internalTemplate,
    customer_facing: template.customer_facing !== false && !internalTemplate,
    auth_method_label:
      template.auth_method_label || authMethodLabel(template.auth_type),
    required_fields:
      Array.isArray(template.required_fields) && template.required_fields.length > 0
        ? template.required_fields
        : inferRequiredFields(template),
    default_endpoint_labels:
      Array.isArray(template.default_endpoint_labels)
        ? template.default_endpoint_labels
        : inferEndpointLabels(template),
    self_serve:
      typeof template.self_serve === "boolean"
        ? template.self_serve
        : !setupOnly &&
          Boolean(
            template.default_login_url ||
              template.default_fleet_url ||
              template.fleet_config?.fleet_url
          ),
    requires_provider_support:
      typeof template.requires_provider_support === "boolean"
        ? template.requires_provider_support
        : setupOnly,
    setup_notes:
      Array.isArray(template.setup_notes)
        ? template.setup_notes
        : setupOnly
          ? ["Template requires provider setup verification before live sync."]
          : ["Create inactive, test connection, review detected vehicles, then activate sync."],
    audience_label: internalTemplate
      ? "Internal template - platform setup only"
      : "Customer-facing provider",
  };
}

function isCustomerFacingTemplate(template: any) {
  const setupOnly = Boolean(template.setup_only || template.fleet_config?.setup_only);
  const internalTemplate = Boolean(
    template.internal_template || template.fleet_config?.internal_template
  );
  const customerFacing = template.customer_facing !== false &&
    template.fleet_config?.customer_facing !== false;
  return customerFacing && !setupOnly && !internalTemplate;
}

function sanitizeCustomerTemplate(template: any) {
  return {
    id: template.id,
    display_name: template.display_name,
    slug: template.slug,
    auth_method_label: template.auth_method_label,
    required_fields: template.required_fields,
    self_serve: template.self_serve,
    requires_provider_support: template.requires_provider_support,
    setup_notes: template.setup_notes,
    audience_label: "Customer-facing provider",
    customer_facing: true,
    internal_template: false,
  };
}

function authMethodLabel(authType: any) {
  const value = String(authType || "").toUpperCase();
  if (value.includes("BEARER")) return "Bearer token";
  if (value.includes("PASSWORD")) return "Username and password";
  if (value.includes("API")) return "API key / provider credentials";
  if (value === "NONE") return "No live credentials";
  return "Provider credentials";
}

function inferEndpointLabels(template: any) {
  const labels = [];
  if (template.default_login_url || template.auth_config?.login_url) {
    labels.push("Provider access endpoint");
  }
  if (template.default_fleet_url || template.fleet_config?.fleet_url) {
    labels.push("Fleet telemetry feed");
  }
  return labels;
}

function inferRequiredFields(template: any) {
  const placeholders = new Set<string>();
  const configText = JSON.stringify({
    auth_config: template.auth_config || {},
    fleet_config: template.fleet_config || {},
  });
  const matches = configText.match(/{{\s*(username|api_key|password|bearer_token)\s*}}/g) || [];
  matches.forEach((match) => placeholders.add(match.replace(/[{}\s]/g, "")));

  const fields = [
    { name: "username", label: "API Username", secret: false },
    { name: "api_key", label: "API Key / Secret", secret: true },
    { name: "password", label: "Password", secret: true },
    { name: "bearer_token", label: "Access Token", secret: true },
  ];

  return fields.filter((field) => placeholders.has(field.name));
}
