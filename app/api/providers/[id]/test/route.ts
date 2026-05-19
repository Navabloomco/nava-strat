import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  ProviderRecord,
  runProviderSync,
} from "../../../../../lib/providers/engine";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ProviderCapabilities = {
  can_view_provider_status: boolean;
  can_add_provider: boolean;
  can_update_provider_credentials: boolean;
  can_test_provider: boolean;
  can_edit_advanced_provider_config: boolean;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      capabilities: ProviderCapabilities;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
      capabilities?: never;
    };

function getProviderCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const isCompanyAdmin =
    normalizedRoles.has("owner") || normalizedRoles.has("admin");

  if (isPlatformOwner || normalizedRoles.has("platform_owner")) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: true,
    };
  }

  if (isCompanyAdmin) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: false,
    };
  }

  return {
    can_view_provider_status: true,
    can_add_provider: false,
    can_update_provider_credentials: false,
    can_test_provider: false,
    can_edit_advanced_provider_config: false,
  };
}

function sanitizeNormalizedSample(sample: any) {
  if (!sample || typeof sample !== "object") return null;

  const { raw, ...safeSample } = sample;
  return safeSample;
}

function sanitizeSupplementalDiagnostics(diagnostics: any, includeAvailableKeys: boolean) {
  if (!diagnostics || typeof diagnostics !== "object") return null;

  return {
    supplemental_feeds_configured: Number(diagnostics.supplemental_feeds_configured || 0),
    supplemental_feeds_attempted: Number(diagnostics.supplemental_feeds_attempted || 0),
    supplemental_rows_found: Number(diagnostics.supplemental_rows_found || 0),
    supplemental_matches_found: Number(diagnostics.supplemental_matches_found || 0),
    supplemental_fields_merged: diagnostics.supplemental_fields_merged || {},
    feeds: (diagnostics.feeds || []).map((feed: any) => ({
      name: String(feed.name || "supplemental"),
      attempted: Boolean(feed.attempted),
      success: Boolean(feed.success),
      rows_found: Number(feed.rows_found || 0),
      matches_found: Number(feed.matches_found || 0),
      mapped_fields_configured: feed.mapped_fields_configured || [],
      mapped_fields_found: feed.mapped_fields_found || {},
      mapped_fields_merged: feed.mapped_fields_merged || {},
      mapped_fields_skipped: feed.mapped_fields_skipped || {},
      unmatched_supplemental_rows: Number(feed.unmatched_supplemental_rows || 0),
      rendered_request: sanitizeRenderedRequest(
        feed.rendered_request,
        includeAvailableKeys
      ),
      auth_profile_used: feed.auth_profile_used
        ? String(feed.auth_profile_used)
        : undefined,
      auth_profile_attempted: Boolean(feed.auth_profile_attempted),
      auth_profile_token_captured: Boolean(feed.auth_profile_token_captured),
      auth_profile_metadata_available: Array.isArray(feed.auth_profile_metadata_available)
        ? feed.auth_profile_metadata_available.map((key: any) => String(key)).slice(0, 10)
        : [],
      auth_profile_credential_macros_available: Array.isArray(feed.auth_profile_credential_macros_available)
        ? feed.auth_profile_credential_macros_available.map((key: any) => String(key)).slice(0, 10)
        : [],
      auth_profile_username_override_configured:
        typeof feed.auth_profile_username_override_configured === "boolean"
          ? feed.auth_profile_username_override_configured
          : undefined,
      auth_http_status: feed.auth_http_status ? Number(feed.auth_http_status) : undefined,
      auth_response_type: feed.auth_response_type
        ? String(feed.auth_response_type)
        : undefined,
      auth_top_level_keys: Array.isArray(feed.auth_top_level_keys)
        ? feed.auth_top_level_keys.map((key: any) => String(key)).slice(0, 50)
        : [],
      auth_data_is_null:
        typeof feed.auth_data_is_null === "boolean"
          ? feed.auth_data_is_null
          : undefined,
      auth_data_is_empty_object:
        typeof feed.auth_data_is_empty_object === "boolean"
          ? feed.auth_data_is_empty_object
          : undefined,
      auth_data_keys: Array.isArray(feed.auth_data_keys)
        ? feed.auth_data_keys.map((key: any) => String(key)).slice(0, 50)
        : [],
      auth_data_array_paths_found: feed.auth_data_array_paths_found &&
        typeof feed.auth_data_array_paths_found === "object"
        ? sanitizeCountMap(feed.auth_data_array_paths_found)
        : {},
      auth_data_object_paths_found: Array.isArray(feed.auth_data_object_paths_found)
        ? feed.auth_data_object_paths_found.map((path: any) => String(path)).slice(0, 50)
        : [],
      auth_data_result_paths_found: feed.auth_data_result_paths_found &&
        typeof feed.auth_data_result_paths_found === "object"
        ? sanitizeResultPathMap(feed.auth_data_result_paths_found)
        : {},
      auth_error_keys: Array.isArray(feed.auth_error_keys)
        ? feed.auth_error_keys.map((key: any) => String(key)).slice(0, 50)
        : [],
      auth_operation_name_sent:
        typeof feed.auth_operation_name_sent === "string"
          ? feed.auth_operation_name_sent.slice(0, 120)
          : null,
      auth_payload_key_paths_sent: Array.isArray(feed.auth_payload_key_paths_sent)
        ? feed.auth_payload_key_paths_sent.map((path: any) => String(path)).slice(0, 100)
        : [],
      auth_token_paths_checked: Array.isArray(feed.auth_token_paths_checked)
        ? feed.auth_token_paths_checked.map((path: any) => String(path)).slice(0, 20)
        : [],
      auth_metadata_paths_checked: Array.isArray(feed.auth_metadata_paths_checked)
        ? feed.auth_metadata_paths_checked.map((path: any) => String(path)).slice(0, 20)
        : [],
      auth_token_candidate_paths_found: Array.isArray(feed.auth_token_candidate_paths_found)
        ? feed.auth_token_candidate_paths_found.map((path: any) => String(path)).slice(0, 20)
        : [],
      auth_profile_error: feed.auth_profile_error
        ? String(feed.auth_profile_error).slice(0, 240)
        : undefined,
      http_status: feed.http_status ? Number(feed.http_status) : undefined,
      response_type: feed.response_type ? String(feed.response_type) : undefined,
      candidate_row_paths_checked: includeAvailableKeys
        ? (feed.candidate_row_paths_checked || []).map((path: any) => String(path)).slice(0, 50)
        : [],
      top_level_keys: includeAvailableKeys
        ? (feed.top_level_keys || []).map((key: any) => String(key)).slice(0, 50)
        : [],
      first_array_paths_found: includeAvailableKeys
        ? sanitizeCountMap(feed.first_array_paths_found)
        : {},
      response_error_keys: includeAvailableKeys
        ? (feed.response_error_keys || []).map((key: any) => String(key)).slice(0, 50)
        : [],
      skipped: Boolean(feed.skipped),
      skipped_reason: feed.skipped_reason
        ? String(feed.skipped_reason)
        : undefined,
      missing_macros: Array.isArray(feed.missing_macros)
        ? feed.missing_macros.map((macro: any) => String(macro))
        : [],
      unknown_macros: Array.isArray(feed.unknown_macros)
        ? feed.unknown_macros.map((macro: any) => String(macro))
        : [],
      unmapped_available_keys: includeAvailableKeys
        ? (feed.unmapped_available_keys || []).slice(0, 50)
        : [],
      error: feed.error ? String(feed.error) : undefined,
    })),
  };
}

function sanitizeRenderedRequest(request: any, includePayloadShape: boolean) {
  if (!request || typeof request !== "object") return null;

  return {
    method: request.method ? String(request.method) : undefined,
    url_host: request.url_host ? String(request.url_host) : undefined,
    url_path: request.url_path ? String(request.url_path) : undefined,
    content_type: request.content_type ? String(request.content_type) : undefined,
    payload_top_level_keys: includePayloadShape
      ? (request.payload_top_level_keys || []).map((key: any) => String(key)).slice(0, 50)
      : [],
    payload_key_paths: includePayloadShape
      ? (request.payload_key_paths || []).map((path: any) => String(path)).slice(0, 100)
      : [],
    payload_value_types: includePayloadShape
      ? sanitizeStringMap(request.payload_value_types, 120)
      : {},
    allowed_values: includePayloadShape
      ? sanitizeAllowedRequestValues(request.allowed_values)
      : {},
  };
}

function sanitizeStringMap(value: any, limit: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, limit)
      .map(([key, entry]) => [String(key), String(entry)])
  );
}

function sanitizeAllowedRequestValues(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const allowed = new Set([
    "request.reportType",
    "pageIndex",
    "pageSize",
    "channel",
    "request.startDate",
    "request.endDate",
  ]);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowed.has(String(key)))
      .map(([key, entry]) => [String(key), typeof entry === "number" ? entry : String(entry).slice(0, 120)])
  );
}

function sanitizeCountMap(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, count]) => [String(key), Number(count || 0)])
  );
}

function sanitizeResultPathMap(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 50)
      .map(([key, detail]) => [
        String(key),
        typeof detail === "number" ? Number(detail) : String(detail).slice(0, 80),
      ])
  );
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
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );
  const capabilities = getProviderCapabilities(roles, isPlatformOwner);

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

    return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
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

  return { company: company as ResolvedCompany, isPlatformOwner, roles, capabilities };
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    if (!resolved.capabilities.can_test_provider) {
      return NextResponse.json(
        { success: false, error: "Provider test access required" },
        { status: 403 }
      );
    }

    const { data: provider, error: providerError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", params.id)
      .eq("company_id", resolved.company.id)
      .maybeSingle();

    if (providerError) throw providerError;
    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    const result = await runProviderSync(provider as ProviderRecord);

    await supabaseAdmin
      .from("tracking_providers")
      .update({
        last_test_status: result.success ? "success" : "failure",
        last_test_message: result.message,
        last_test_at: new Date().toISOString(),
      })
      .eq("id", provider.id)
      .eq("company_id", resolved.company.id);

    const [
      { count: assetsCount },
      { count: telemetryCount },
      telemetryResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("fleet_assets")
        .select("truck_id", { count: "exact", head: true })
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id),
      supabaseAdmin
        .from("telemetry_logs")
        .select("recorded_at", { count: "exact", head: true })
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id),
      supabaseAdmin
        .from("telemetry_logs")
        .select("recorded_at")
        .eq("company_id", resolved.company.id)
        .eq("provider_id", provider.id)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);

    if (telemetryResult.error) throw telemetryResult.error;

    const latestTelemetryAt =
      telemetryResult.data?.[0]?.recorded_at || null;

    const responseBody: Record<string, any> = {
      success: result.success,
      message: result.message,
      provider_id: provider.id,
      provider_name: provider.provider_name,
      vehicles_found: result.vehicleCount,
      assets_count: assetsCount || 0,
      telemetry_count: telemetryCount || 0,
      latest_telemetry_at: latestTelemetryAt,
    };

    responseBody.supplemental_diagnostics = sanitizeSupplementalDiagnostics(
      result.supplemental_diagnostics,
      resolved.isPlatformOwner
    );

    if (resolved.capabilities.can_edit_advanced_provider_config) {
      responseBody.sample_normalized = sanitizeNormalizedSample(
        result.sample_normalized
      );
    }

    return NextResponse.json(responseBody);
  } catch (err: any) {
    console.error("Provider test error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Provider test failed" },
      { status: 500 }
    );
  }
}
