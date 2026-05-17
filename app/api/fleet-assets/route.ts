import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVIEW_ROLES = new Set(["owner", "admin", "platform_owner"]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
  subscription_plan?: string | null;
  asset_unit_price?: number | null;
  billing_currency?: string | null;
  included_assets?: number | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  billing_cycle_day?: number | null;
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

function sanitizeAsset(asset: any) {
  return {
    id: asset.id,
    registration: asset.registration || null,
    truck_id: asset.truck_id || null,
    provider_name: asset.provider_name || null,
    status: asset.status || null,
    last_seen_at: asset.last_seen_at || null,
    provider_location_label: asset.provider_location_label || null,
    asset_category: asset.asset_category || "unknown",
    billing_status: asset.billing_status || "unreviewed",
    intelligence_enabled: Boolean(asset.intelligence_enabled),
    excluded_reason: asset.excluded_reason || null,
    ai_suggested_category: asset.ai_suggested_category || null,
    ai_suggested_reason: asset.ai_suggested_reason || null,
    ai_confidence:
      asset.ai_confidence === null || asset.ai_confidence === undefined
        ? null
        : Number(asset.ai_confidence),
    first_seen_at: asset.first_seen_at || null,
    reviewed_at: asset.reviewed_at || null,
    billing_enabled_at: asset.billing_enabled_at || null,
    billing_disabled_at: asset.billing_disabled_at || null,
  };
}

function sortAssetsForReview(assets: any[]) {
  return [...assets].sort((a, b) => {
    const aUnreviewed = a.billing_status === "unreviewed" ? 0 : 1;
    const bUnreviewed = b.billing_status === "unreviewed" ? 0 : 1;
    if (aUnreviewed !== bUnreviewed) return aUnreviewed - bUnreviewed;

    const aTime = new Date(a.last_seen_at || a.first_seen_at || 0).getTime();
    const bTime = new Date(b.last_seen_at || b.first_seen_at || 0).getTime();
    return bTime - aTime;
  });
}

function buildSummary(assets: any[]) {
  return {
    imported_count: assets.length,
    unreviewed_count: assets.filter((asset) => asset.billing_status === "unreviewed").length,
    enabled_count: assets.filter((asset) => asset.billing_status === "enabled" || asset.intelligence_enabled).length,
    excluded_count: assets.filter((asset) => asset.billing_status === "excluded").length,
    disabled_count: assets.filter((asset) => asset.billing_status === "disabled").length,
  };
}

async function resolveReviewAccess(req: Request, requestedCompanyId?: string | null) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = activeMemberships.map((membership) =>
    String(membership.role || "").toLowerCase()
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const canReview = roles.some((role) => REVIEW_ROLES.has(role));

  if (!canReview) {
    return {
      error: noStoreJson(
        { success: false, error: "Asset review access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug, subscription_plan, asset_unit_price, billing_currency, included_assets, trial_starts_at, trial_ends_at, billing_cycle_day");

    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson({ success: false, error: "Company not found" }, { status: 404 }),
      };
    }

    return {
      company: company as ResolvedCompany,
      userId: user.id,
      isPlatformOwner,
    };
  }

  const reviewMembership = activeMemberships.find((membership) =>
    REVIEW_ROLES.has(String(membership.role || "").toLowerCase())
  );
  const companyId = reviewMembership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Asset review access required" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug, subscription_plan, asset_unit_price, billing_currency, included_assets, trial_starts_at, trial_ends_at, billing_cycle_day")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    isPlatformOwner,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveReviewAccess(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const { data: assets, error } = await supabaseAdmin
      .from("fleet_assets")
      .select(
        "id, registration, truck_id, provider_name, status, last_seen_at, provider_location_label, asset_category, billing_status, intelligence_enabled, excluded_reason, ai_suggested_category, ai_suggested_reason, ai_confidence, first_seen_at, reviewed_at, billing_enabled_at, billing_disabled_at"
      )
      .eq("company_id", resolved.company.id);

    if (error) throw error;

    const sortedAssets = sortAssetsForReview(assets || []);
    const summary = buildSummary(sortedAssets);

    return noStoreJson({
      success: true,
      company: {
        id: resolved.company.id,
        name: resolved.company.name,
        slug: resolved.company.slug,
      },
      is_platform_owner: resolved.isPlatformOwner,
      billing: {
        subscription_plan: resolved.company.subscription_plan || null,
        asset_unit_price: resolved.company.asset_unit_price ?? null,
        billing_currency: resolved.company.billing_currency || "KES",
        included_assets: resolved.company.included_assets ?? 0,
        trial_starts_at: resolved.company.trial_starts_at || null,
        trial_ends_at: resolved.company.trial_ends_at || null,
        billing_cycle_day: resolved.company.billing_cycle_day ?? null,
      },
      summary,
      assets: sortedAssets.map(sanitizeAsset),
    });
  } catch (err: any) {
    console.error("Fleet assets GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load fleet assets" },
      { status: 500 }
    );
  }
}
