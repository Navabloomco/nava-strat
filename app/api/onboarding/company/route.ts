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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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
      .select("id, name, slug")
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
    .select("id, name, slug")
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
        recent_telemetry: 0,
      },
      checklist: {
        company_created: false,
        tracking_provider_connected: false,
        provider_tested_successfully: false,
        fleet_assets_received: false,
        recent_telemetry_received: false,
        ready_to_create_first_journey: false,
      },
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [providersResult, assetsResult, telemetryResult] = await Promise.all([
    supabaseAdmin
      .from("tracking_providers")
      .select(
        "id, provider_name, provider_slug, is_active, last_test_status, last_test_message, last_test_at, last_sync_at, created_at"
      )
      .eq("company_id", company.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("fleet_assets")
      .select("id, truck_id, registration, status, last_seen_at")
      .eq("company_id", company.id)
      .limit(50),
    supabaseAdmin
      .from("telemetry_logs")
      .select("id, recorded_at")
      .eq("company_id", company.id)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false })
      .limit(50),
  ]);

  if (providersResult.error) throw providersResult.error;
  if (assetsResult.error) throw assetsResult.error;
  if (telemetryResult.error) throw telemetryResult.error;

  const providers = providersResult.data || [];
  const fleetAssets = assetsResult.data || [];
  const recentTelemetry = telemetryResult.data || [];
  const providerTestedSuccessfully = providers.some(
    (provider) =>
      provider.last_test_status === "success" || Boolean(provider.last_sync_at)
  );
  const recentTelemetryReceived = recentTelemetry.length > 0;
  const fleetAssetsReceived = fleetAssets.length > 0;

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
      recent_telemetry: recentTelemetry.length,
    },
    latest_telemetry_at: recentTelemetry[0]?.recorded_at || null,
    checklist: {
      company_created: true,
      tracking_provider_connected: providers.length > 0,
      provider_tested_successfully: providerTestedSuccessfully,
      fleet_assets_received: fleetAssetsReceived,
      recent_telemetry_received: recentTelemetryReceived,
      ready_to_create_first_journey:
        providerTestedSuccessfully && fleetAssetsReceived && recentTelemetryReceived,
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
      })
      .select("id, name, slug")
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

    if (membershipError) throw membershipError;

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
