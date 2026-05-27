import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import {
  hasAnyRole,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";
import { isPendingAssetReview } from "../../../lib/assetReview";
import { readStoredVehicleIdentityContext } from "../../../lib/providers/vehicleIdentity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVIEW_ROLES = ["owner", "admin", "platform_owner"] as const;
const COMPANY_SELECT =
  "id, name, slug, subscription_plan, business_type, primary_asset_types, main_billing_unit, operating_regions, primary_use_case, asset_unit_price, billing_currency, included_assets, trial_starts_at, trial_ends_at, billing_cycle_day";
const ASSET_CATEGORIES = new Set([
  "unknown",
  "truck",
  "trailer",
  "van",
  "pickup",
  "car",
  "motorcycle",
  "equipment",
  "other",
]);
const EXCLUDED_REASONS = new Set([
  "personal_use",
  "duplicate",
  "inactive_device",
  "test_device",
  "sold_or_removed",
  "not_used_for_operations",
  "other",
]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
  subscription_plan?: string | null;
  business_type?: string | null;
  primary_asset_types?: string[] | null;
  main_billing_unit?: string | null;
  operating_regions?: string[] | null;
  primary_use_case?: string | null;
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

function sanitizeAsset(asset: any, reviewContext: any = {}) {
  const timestampQuality = deriveAssetTimestampQuality(asset);
  const identityContext = readStoredVehicleIdentityContext(asset);
  return {
    id: asset.id,
    registration: asset.registration || null,
    truck_id: asset.truck_id || null,
    canonical_truck_id: identityContext.canonical_truck_plate || asset.truck_id || null,
    canonical_vehicle_key:
      identityContext.canonical_key || normalizeAssetReviewKey(asset.registration || asset.truck_id),
    provider_label: identityContext.provider_label || null,
    attached_trailer_plate: identityContext.attached_trailer_plate || null,
    asset_identity_role: identityContext.asset_identity_role || "unknown",
    non_primary_asset: Boolean(identityContext.non_primary_asset),
    canonical_duplicate: Boolean(reviewContext.canonical_duplicate),
    canonical_review_role: reviewContext.canonical_review_role || "primary",
    duplicate_canonical_key: reviewContext.duplicate_canonical_key || null,
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
    telemetry_capability: asset.telemetry_capability || "UNKNOWN",
    telemetry_capability_source: asset.telemetry_capability_source || "unknown",
    canbus_enabled: Boolean(asset.canbus_enabled),
    fuel_rod_installed: Boolean(asset.fuel_rod_installed),
    fuel_rod_calibration_status: asset.fuel_rod_calibration_status || null,
    timestamp_quality: timestampQuality,
    needs_timestamp_review: timestampQuality.status !== "valid",
  };
}

function sortAssetsForReview(assets: any[]) {
  return [...assets].sort((a, b) => {
    const aUnreviewed = isPendingAssetReview(a) ? 0 : 1;
    const bUnreviewed = isPendingAssetReview(b) ? 0 : 1;
    if (aUnreviewed !== bUnreviewed) return aUnreviewed - bUnreviewed;

    const aTime = trustedAssetSortTime(a);
    const bTime = trustedAssetSortTime(b);
    return bTime - aTime;
  });
}

function buildSummary(reviewModel: any) {
  const groups = reviewModel.groups || [];
  const primaryAssets = groups.map((group: any) => group.primary).filter(Boolean);
  const enabledIntelligenceGroups = groups.filter((group: any) =>
    group.assets.some(
      (asset: any) =>
        asset.status === "active" &&
        asset.billing_status === "enabled" &&
        asset.intelligence_enabled
    )
  );
  const billableGroups = groups.filter((group: any) =>
    group.assets.some(
      (asset: any) =>
        asset.status === "active" &&
        asset.billing_status === "enabled" &&
        asset.intelligence_enabled &&
        asset.billing_enabled_at
    )
  );

  return {
    imported_count: groups.length,
    raw_imported_count: reviewModel.raw_count || 0,
    canonical_duplicate_count: reviewModel.duplicate_row_count || 0,
    unreviewed_count: primaryAssets.filter(isPendingAssetReview).length,
    enabled_count: enabledIntelligenceGroups.length,
    enabled_intelligence_count: enabledIntelligenceGroups.length,
    billable_enabled_count: billableGroups.length,
    excluded_count: primaryAssets.filter((asset: any) => asset.billing_status === "excluded").length,
    disabled_count: primaryAssets.filter((asset: any) => asset.billing_status === "disabled").length,
    needs_timestamp_review_count: primaryAssets.filter(
      (asset: any) => deriveAssetTimestampQuality(asset).status !== "valid"
    ).length,
  };
}

function buildCanonicalReviewModel(assets: any[]) {
  const groupsByKey = new Map<string, any[]>();
  for (const asset of assets) {
    const key = canonicalAssetReviewKey(asset) || `asset:${asset.id}`;
    const group = groupsByKey.get(key) || [];
    group.push(asset);
    groupsByKey.set(key, group);
  }

  const assetContexts = new Map<string, any>();
  const groups = Array.from(groupsByKey.entries()).map(([key, groupAssets]) => {
    const primary = chooseCanonicalPrimaryAsset(groupAssets, key);
    const duplicateAssetIds = duplicateReviewAssetIds(groupAssets, primary, key);
    for (const asset of groupAssets) {
      const duplicate = duplicateAssetIds.has(asset.id);
      assetContexts.set(asset.id, {
        canonical_duplicate: duplicate,
        canonical_review_role: duplicate
          ? "duplicate"
          : isNonPrimaryReviewAsset(asset)
            ? "non_primary"
            : "primary",
        duplicate_canonical_key: duplicate ? key : null,
      });
    }
    return {
      key,
      assets: groupAssets,
      primary,
      duplicate: duplicateAssetIds.size > 0,
      duplicate_count: duplicateAssetIds.size,
    };
  });

  return {
    groups,
    asset_contexts: assetContexts,
    raw_count: assets.length,
    duplicate_row_count: groups.reduce(
      (total: number, group: any) => total + Number(group.duplicate_count || 0),
      0
    ),
  };
}

function canonicalAssetReviewKey(asset: any) {
  const identity = readStoredVehicleIdentityContext(asset);
  if (identity.non_primary_asset) return `asset:${asset.id}`;
  return identity.canonical_key || normalizeAssetReviewKey(asset.registration || asset.truck_id);
}

function duplicateReviewAssetIds(assets: any[], primary: any, canonicalKey: string) {
  const duplicateIds = new Set<string>();
  if (assets.length <= 1) return duplicateIds;

  for (const asset of assets) {
    if (asset.id !== primary?.id && isLegacyCombinedLabelAsset(asset, canonicalKey)) {
      duplicateIds.add(asset.id);
    }
  }

  const competingPrimaryRows = assets.filter(
    (asset) =>
      !isNonPrimaryReviewAsset(asset) &&
      !isLegacyCombinedLabelAsset(asset, canonicalKey) &&
      isReviewableCollisionCandidate(asset)
  );
  const enabledRows = competingPrimaryRows.filter(isEnabledIntelligenceAsset);
  const unreviewedRows = competingPrimaryRows.filter(isPendingAssetReview);

  if (enabledRows.length > 1 || unreviewedRows.length > 1) {
    for (const asset of competingPrimaryRows) duplicateIds.add(asset.id);
  }

  return duplicateIds;
}

function isLegacyCombinedLabelAsset(asset: any, canonicalKey: string) {
  const rawKey = normalizeAssetReviewKey(asset.registration || asset.truck_id);
  const identity = readStoredVehicleIdentityContext(asset);
  return Boolean(
    canonicalKey &&
      rawKey &&
      rawKey !== canonicalKey &&
      rawKey.includes(canonicalKey) &&
      identity.attached_trailer_plate
  );
}

function isReviewableCollisionCandidate(asset: any) {
  const status = String(asset.status || "").toLowerCase();
  const billingStatus = String(asset.billing_status || "").toLowerCase();
  return (
    status === "active" &&
    !["excluded", "disabled"].includes(billingStatus)
  );
}

function isEnabledIntelligenceAsset(asset: any) {
  return (
    asset.status === "active" &&
    asset.billing_status === "enabled" &&
    asset.intelligence_enabled
  );
}

function isNonPrimaryReviewAsset(asset: any) {
  return readStoredVehicleIdentityContext(asset).non_primary_asset;
}

function chooseCanonicalPrimaryAsset(assets: any[], canonicalKey: string) {
  return [...assets].sort((a, b) => {
    const scoreDelta =
      canonicalPrimaryScore(b, canonicalKey) - canonicalPrimaryScore(a, canonicalKey);
    if (scoreDelta !== 0) return scoreDelta;
    return trustedAssetSortTime(b) - trustedAssetSortTime(a);
  })[0];
}

function canonicalPrimaryScore(asset: any, canonicalKey: string) {
  let score = 0;
  const registrationKey = normalizeAssetReviewKey(asset.registration);
  const truckKey = normalizeAssetReviewKey(asset.truck_id);
  if (registrationKey === canonicalKey || truckKey === canonicalKey) score += 100;
  if (
    asset.status === "active" &&
    asset.billing_status === "enabled" &&
    asset.intelligence_enabled
  ) {
    score += 80;
  }
  if (asset.billing_status && asset.billing_status !== "unreviewed") score += 40;
  if (deriveAssetTimestampQuality(asset).status === "valid") score += 10;
  return score;
}

function normalizeAssetReviewKey(value: any) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function trustedAssetSortTime(asset: any) {
  const timestampQuality = deriveAssetTimestampQuality(asset);
  const lastSeen = timestampQuality.status === "valid" ? new Date(asset.last_seen_at).getTime() : 0;
  if (Number.isFinite(lastSeen) && lastSeen > 0) return lastSeen;
  const firstSeen = new Date(asset.first_seen_at || 0).getTime();
  return Number.isFinite(firstSeen) ? firstSeen : 0;
}

function deriveAssetTimestampQuality(asset: any) {
  const embedded = asset?.telemetry_capabilities?.timestamp_quality;
  const embeddedStatus = String(embedded?.status || "").toLowerCase();
  if (["invalid", "suspect", "missing"].includes(embeddedStatus)) {
    return {
      status: embeddedStatus,
      reason: String(embedded?.reason || "provider_timestamp_needs_review"),
    };
  }

  if (!asset?.last_seen_at) {
    return { status: "missing", reason: "last_seen_unavailable" };
  }

  const lastSeen = new Date(asset.last_seen_at);
  if (Number.isNaN(lastSeen.getTime())) {
    return { status: "invalid", reason: "last_seen_unparseable" };
  }
  if (lastSeen.getUTCFullYear() < 2000) {
    return { status: "invalid", reason: "provider_timestamp_before_2000" };
  }
  if (lastSeen.getTime() > Date.now() + 48 * 60 * 60 * 1000) {
    return { status: "invalid", reason: "provider_timestamp_in_future" };
  }

  if (asset.first_seen_at) {
    const firstSeen = new Date(asset.first_seen_at);
    if (
      Number.isFinite(firstSeen.getTime()) &&
      lastSeen.getTime() < firstSeen.getTime() - 24 * 60 * 60 * 1000
    ) {
      return { status: "invalid", reason: "last_seen_before_first_seen" };
    }
  }

  return { status: "valid", reason: embedded?.reason || "provider_timestamp_valid" };
}

function isMissingOptionalTelemetryColumnError(error: any) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

function firstReviewCompanyId(memberships: any[]) {
  for (const membership of memberships) {
    const companyId = membership.company_id;
    if (companyId && hasAnyRole(rolesForCompany(memberships, companyId), REVIEW_ROLES)) {
      return companyId;
    }
  }

  return null;
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
  const roles = activeMemberships.map((membership) => normalizeRole(membership.role));
  const isPlatformOwner = roles.includes("platform_owner");
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select(COMPANY_SELECT);

    const { data: company, error: companyError } = normalizedRequestedCompanyId
      ? await companyQuery.eq("id", normalizedRequestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson({ success: false, error: "Company not found" }, { status: 404 }),
      };
    }

    const companyRoles = rolesForCompany(activeMemberships, company.id, true);
    if (!hasAnyRole(companyRoles, REVIEW_ROLES)) {
      return {
        error: noStoreJson(
          { success: false, error: "Asset review access required" },
          { status: 403 }
        ),
      };
    }

    return { company: company as ResolvedCompany, userId: user.id, isPlatformOwner };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    firstReviewCompanyId(activeMemberships);

  if (
    !companyId ||
    !hasAnyRole(rolesForCompany(activeMemberships, companyId), REVIEW_ROLES)
  ) {
    return {
      error: noStoreJson(
        { success: false, error: "Asset review access required" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select(COMPANY_SELECT)
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

    const assetBaseSelect =
      "id, registration, truck_id, provider_name, status, last_seen_at, provider_location_label, asset_category, billing_status, intelligence_enabled, excluded_reason, ai_suggested_category, ai_suggested_reason, ai_confidence, first_seen_at, reviewed_at, billing_enabled_at, billing_disabled_at";
    const assetCapabilitySelect = `${assetBaseSelect}, telemetry_capability, telemetry_capabilities, telemetry_capability_source, canbus_enabled, fuel_rod_installed, fuel_rod_calibration_status`;
    let { data: assets, error } = await supabaseAdmin
      .from("fleet_assets")
      .select(assetCapabilitySelect)
      .eq("company_id", resolved.company.id);

    if (isMissingOptionalTelemetryColumnError(error)) {
      const retry = await supabaseAdmin
        .from("fleet_assets")
        .select(assetBaseSelect)
        .eq("company_id", resolved.company.id);
      assets = retry.data as any;
      error = retry.error;
    }

    if (error) throw error;

    const sortedAssets = sortAssetsForReview(assets || []);
    const canonicalReviewModel = buildCanonicalReviewModel(sortedAssets);
    const summary = buildSummary(canonicalReviewModel);

    return noStoreJson({
      success: true,
      company: {
        id: resolved.company.id,
        name: resolved.company.name,
        slug: resolved.company.slug,
      },
      operating_context: {
        business_type: resolved.company.business_type || null,
        primary_asset_types: resolved.company.primary_asset_types || [],
        main_billing_unit: resolved.company.main_billing_unit || null,
        operating_regions: resolved.company.operating_regions || [],
        primary_use_case: resolved.company.primary_use_case || null,
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
      assets: sortedAssets.map((asset) =>
        sanitizeAsset(asset, canonicalReviewModel.asset_contexts.get(asset.id))
      ),
    });
  } catch (err: any) {
    console.error("Fleet assets GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load fleet assets" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveReviewAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const assetIds = Array.isArray(body.asset_ids)
      ? body.asset_ids.map((id: any) => String(id || "").trim()).filter(Boolean)
      : [];
    const uniqueAssetIds = Array.from(new Set(assetIds)).slice(0, 500);
    if (uniqueAssetIds.length === 0) {
      return noStoreJson(
        { success: false, error: "Select at least one asset to update" },
        { status: 400 }
      );
    }

    const action = String(body.action || "").trim().toLowerCase();
    const category = validateCategory(body.asset_category);
    const excludedReason = String(body.excluded_reason || "").trim().toLowerCase();

    if (["enable", "set_category"].includes(action) && (!category || category === "unknown")) {
      return noStoreJson(
        { success: false, error: "Choose a specific asset category before applying this bulk action" },
        { status: 400 }
      );
    }
    if (action === "exclude" && !EXCLUDED_REASONS.has(excludedReason)) {
      return noStoreJson(
        { success: false, error: "Choose an excluded reason before applying this bulk action" },
        { status: 400 }
      );
    }

    const { data: assets, error: assetError } = await supabaseAdmin
      .from("fleet_assets")
      .select(
        "id, company_id, status, billing_status, intelligence_enabled, billing_enabled_at, billing_disabled_at"
      )
      .eq("company_id", resolved.company.id)
      .in("id", uniqueAssetIds);

    if (assetError) throw assetError;
    const scopedAssets = assets || [];
    if (scopedAssets.length === 0) {
      return noStoreJson({ success: false, error: "No selected assets found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const errors: string[] = [];
    let updatedCount = 0;

    for (const asset of scopedAssets) {
      const updates = buildBulkAssetUpdates(asset, action, {
        category,
        excludedReason,
        now,
        userId: resolved.userId,
      });
      if (!updates) {
        errors.push(`Unsupported action for asset ${asset.id}`);
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from("fleet_assets")
        .update(updates)
        .eq("company_id", resolved.company.id)
        .eq("id", asset.id);

      if (updateError) {
        errors.push(updateError.message || `Failed to update asset ${asset.id}`);
      } else {
        updatedCount++;
      }
    }

    return noStoreJson({
      success: errors.length === 0,
      updated_count: updatedCount,
      requested_count: uniqueAssetIds.length,
      errors,
    }, errors.length ? { status: 207 } : undefined);
  } catch (err: any) {
    console.error("Fleet assets bulk PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update selected assets" },
      { status: 500 }
    );
  }
}

function validateCategory(value: any, fallback = "unknown") {
  const category = String(value || fallback).trim().toLowerCase();
  return ASSET_CATEGORIES.has(category) ? category : null;
}

function buildBulkAssetUpdates(
  asset: any,
  action: string,
  context: {
    category: string | null;
    excludedReason: string;
    now: string;
    userId: string;
  }
) {
  const updates: Record<string, any> = {};
  if (action === "enable") {
    updates.asset_category = context.category;
    updates.billing_status = "enabled";
    updates.intelligence_enabled = true;
    updates.excluded_reason = null;
    updates.reviewed_at = context.now;
    updates.reviewed_by = context.userId;
    updates.billing_disabled_at = null;
    if (!asset.billing_enabled_at) updates.billing_enabled_at = context.now;
    return updates;
  }
  if (action === "exclude") {
    if (context.category && context.category !== "unknown") {
      updates.asset_category = context.category;
    }
    updates.billing_status = "excluded";
    updates.intelligence_enabled = false;
    updates.excluded_reason = context.excludedReason;
    updates.reviewed_at = context.now;
    updates.reviewed_by = context.userId;
    if (shouldSetBillingDisabledAt(asset)) updates.billing_disabled_at = context.now;
    return updates;
  }
  if (action === "disable") {
    updates.billing_status = "disabled";
    updates.intelligence_enabled = false;
    updates.reviewed_at = context.now;
    updates.reviewed_by = context.userId;
    if (shouldSetBillingDisabledAt(asset)) updates.billing_disabled_at = context.now;
    return updates;
  }
  if (action === "review_later") {
    updates.billing_status = "unreviewed";
    updates.intelligence_enabled = false;
    updates.excluded_reason = null;
    if (shouldSetBillingDisabledAt(asset)) updates.billing_disabled_at = context.now;
    return updates;
  }
  if (action === "set_category") {
    updates.asset_category = context.category;
    return updates;
  }
  return null;
}

function shouldSetBillingDisabledAt(asset: any) {
  return (
    !asset.billing_disabled_at ||
    asset.billing_status === "enabled" ||
    Boolean(asset.intelligence_enabled) ||
    (asset.status === "active" &&
      asset.billing_status === "enabled" &&
      Boolean(asset.billing_enabled_at))
  );
}
