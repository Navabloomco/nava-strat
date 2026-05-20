import { NextResponse } from "next/server";
import { isPendingAssetReview } from "../../../../lib/assetReview";
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const companySelect =
  "id, name, slug, business_type, primary_asset_types, main_billing_unit, operating_regions, primary_use_case";

const BUSINESS_TYPES = new Set([
  "long_haul_transport",
  "passenger_transport",
  "courier_delivery",
  "field_service",
  "construction_equipment",
  "sales_fleet",
  "mixed_fleet",
  "other",
]);

const PRIMARY_ASSET_TYPES = new Set([
  "truck",
  "trailer",
  "bus",
  "van",
  "pickup",
  "car",
  "motorcycle",
  "equipment",
  "other",
]);

const BILLING_UNITS = new Set([
  "trip",
  "tonne",
  "passenger",
  "delivery",
  "hour",
  "day",
  "asset",
  "other",
]);

function normalizeOptionalChoice(value: any, allowed: Set<string>) {
  const text = String(value || "").trim();
  if (!text) return null;
  return allowed.has(text) ? text : null;
}

function normalizeStringArray(value: any, allowed?: Set<string>) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());

  return Array.from(
    new Set(
      rawValues
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .filter((item) => !allowed || allowed.has(item))
    )
  ).slice(0, 20);
}

function normalizeShortText(value: any) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 240) : null;
}

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: noStoreJson({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: noStoreJson({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { user, error: null };
}

async function getActiveMemberships(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) throw error;
  return data || [];
}

async function getCompanyForMemberships(memberships: any[]) {
  if (memberships.length === 0) return null;

  const isPlatformOwner = memberships.some(
    (membership) => membership.role === "platform_owner"
  );

  if (isPlatformOwner) {
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select(companySelect)
      .order("name", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  const companyId = memberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) return null;

  const { data, error } = await supabaseAdmin
    .from("companies")
    .select(companySelect)
    .eq("id", companyId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function buildStatus(company: any) {
  if (!company) {
    return {
      company: null,
      providers: [],
      counts: {
        providers: 0,
        fleet_assets: 0,
        imported_assets: 0,
        enabled_intelligence_assets: 0,
        unreviewed_assets: 0,
        recent_telemetry: 0,
        provider_setup_requests: 0,
      },
      provider_setup_requests_count: 0,
      latest_provider_setup_request_status: null,
      latest_provider_setup_request_provider_name: null,
      latest_provider_setup_request_created_at: null,
      checklist: {
        company_created: false,
        tracking_provider_connected: false,
        provider_tested_successfully: false,
        fleet_assets_received: false,
        intelligence_vehicles_enabled: false,
        recent_telemetry_received: false,
        ready_to_create_first_journey: false,
      },
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    providersResult,
    assetsResult,
    providerRequestsResult,
    providerRequestCountResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("tracking_providers")
      .select(
        "id, provider_name, provider_slug, is_active, last_test_status, last_test_message, last_test_at, last_sync_at, created_at"
      )
      .eq("company_id", company.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, status, last_seen_at, intelligence_enabled, billing_status")
      .eq("company_id", company.id),
    supabaseAdmin
      .from("provider_setup_requests")
      .select("provider_name, status, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("provider_setup_requests")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id),
  ]);

  if (providersResult.error) throw providersResult.error;
  if (assetsResult.error) throw assetsResult.error;
  if (providerRequestsResult.error) throw providerRequestsResult.error;
  if (providerRequestCountResult.error) throw providerRequestCountResult.error;

  const providers = providersResult.data || [];
  const fleetAssets = assetsResult.data || [];
  const latestProviderRequest = providerRequestsResult.data?.[0] || null;
  const providerRequestsCount = providerRequestCountResult.count || 0;
  const providerTestedSuccessfully = providers.some(
    (provider) =>
      provider.last_test_status === "success" || Boolean(provider.last_sync_at)
  );
  const fleetAssetsReceived = fleetAssets.length > 0;
  const enabledIntelligenceAssets = fleetAssets.filter((asset) =>
    Boolean(asset.intelligence_enabled)
  );
  const unreviewedAssets = fleetAssets.filter(isPendingAssetReview);
  const enabledTruckIds = new Set(
    enabledIntelligenceAssets.map((asset) => asset.truck_id).filter(Boolean)
  );
  let enabledRecentTelemetry: any[] = [];

  if (enabledTruckIds.size > 0) {
    const { data, error } = await supabaseAdmin
      .from("telemetry_logs")
      .select("id, truck_id, recorded_at")
      .eq("company_id", company.id)
      .in("truck_id", Array.from(enabledTruckIds))
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    enabledRecentTelemetry = data || [];
  }

  const intelligenceVehiclesEnabled = enabledIntelligenceAssets.length > 0;
  const recentTelemetryReceived = enabledRecentTelemetry.length > 0;

  return {
    company,
    providers: providers.map((provider) => ({
      id: provider.id,
      provider_name: provider.provider_name,
      provider_slug: provider.provider_slug,
      is_active: Boolean(provider.is_active),
      last_test_status: provider.last_test_status || null,
      last_test_message: provider.last_test_message || null,
      last_test_at: provider.last_test_at || null,
      last_sync_at: provider.last_sync_at || null,
      created_at: provider.created_at || null,
    })),
    counts: {
      providers: providers.length,
      fleet_assets: fleetAssets.length,
      imported_assets: fleetAssets.length,
      imported_assets_count: fleetAssets.length,
      enabled_intelligence_assets: enabledIntelligenceAssets.length,
      enabled_intelligence_assets_count: enabledIntelligenceAssets.length,
      unreviewed_assets: unreviewedAssets.length,
      unreviewed_assets_count: unreviewedAssets.length,
      recent_telemetry: enabledRecentTelemetry.length,
      provider_setup_requests: providerRequestsCount,
    },
    latest_telemetry_at: enabledRecentTelemetry[0]?.recorded_at || null,
    provider_setup_requests_count: providerRequestsCount,
    latest_provider_setup_request_status: latestProviderRequest?.status || null,
    latest_provider_setup_request_provider_name:
      latestProviderRequest?.provider_name || null,
    latest_provider_setup_request_created_at:
      latestProviderRequest?.created_at || null,
    checklist: {
      company_created: true,
      tracking_provider_connected: providers.length > 0,
      provider_tested_successfully: providerTestedSuccessfully,
      fleet_assets_received: fleetAssetsReceived,
      intelligence_vehicles_enabled: intelligenceVehiclesEnabled,
      recent_telemetry_received: recentTelemetryReceived,
      ready_to_create_first_journey:
        providerTestedSuccessfully &&
        fleetAssetsReceived &&
        intelligenceVehiclesEnabled &&
        recentTelemetryReceived,
    },
  };
}

async function makeUniqueSlug(name: string) {
  const base = slugify(name) || "company";
  let candidate = base;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data) return candidate;

    candidate = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }

  return `${base}-${Date.now().toString(36)}`;
}

export async function GET(req: Request) {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) return error;

    const memberships = await getActiveMemberships(user.id);
    const company = await getCompanyForMemberships(memberships);
    const status = await buildStatus(company);

    return noStoreJson({
      success: true,
      has_company_access: Boolean(company),
      ...status,
    });
  } catch (err: any) {
    console.error("Onboarding GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load onboarding status" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { user, error } = await getUserFromRequest(req);
    if (error || !user) return error;

    const memberships = await getActiveMemberships(user.id);
    const existingCompany = await getCompanyForMemberships(memberships);

    if (existingCompany) {
      const status = await buildStatus(existingCompany);
      return noStoreJson({
        success: true,
        has_company_access: true,
        created: false,
        ...status,
      });
    }

    const body = await req.json();
    const name = String(body.name || body.company_name || "").trim();
    const subscriptionPlan = String(body.subscription_plan || "starter").trim();
    const businessType = normalizeOptionalChoice(
      body.business_type,
      BUSINESS_TYPES
    );
    const primaryAssetTypes = normalizeStringArray(
      body.primary_asset_types,
      PRIMARY_ASSET_TYPES
    );
    const mainBillingUnit = normalizeOptionalChoice(
      body.main_billing_unit,
      BILLING_UNITS
    );
    const operatingRegions = normalizeStringArray(body.operating_regions);
    const primaryUseCase = normalizeShortText(body.primary_use_case);

    if (!name) {
      return noStoreJson(
        { success: false, error: "Company name is required" },
        { status: 400 }
      );
    }

    const slug = await makeUniqueSlug(name);

    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .insert({
        name,
        slug,
        subscription_plan: subscriptionPlan,
        business_type: businessType,
        primary_asset_types: primaryAssetTypes,
        main_billing_unit: mainBillingUnit,
        operating_regions: operatingRegions,
        primary_use_case: primaryUseCase,
      })
      .select(companySelect)
      .single();

    if (companyError) throw companyError;

    const { error: membershipError } = await supabaseAdmin
      .from("company_users")
      .insert({
        company_id: company.id,
        user_id: user.id,
        role: "owner",
        is_active: true,
      });

    if (membershipError) {
      await supabaseAdmin.from("companies").delete().eq("id", company.id);
      throw membershipError;
    }

    const status = await buildStatus(company);
    return noStoreJson({
      success: true,
      has_company_access: true,
      created: true,
      ...status,
    });
  } catch (err: any) {
    console.error("Onboarding POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create company" },
      { status: 500 }
    );
  }
}
