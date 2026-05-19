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
      unmapped_available_keys: includeAvailableKeys
        ? (feed.unmapped_available_keys || []).slice(0, 50)
        : [],
      error: feed.error ? String(feed.error) : undefined,
    })),
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
