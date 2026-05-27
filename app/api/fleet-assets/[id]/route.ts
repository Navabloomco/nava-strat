import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  hasAnyRole,
  normalizeRole,
  rolesForCompany,
} from "../../../../lib/api/roleAccess";
import { recordAnalyticsEvent } from "../../../../lib/api/analyticsEvents";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVIEW_ROLES = ["owner", "admin", "platform_owner"] as const;
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
  "legacy_duplicate_canonical_exists",
  "inactive_device",
  "test_device",
  "sold_or_removed",
  "not_used_for_operations",
  "other",
]);

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
    first_seen_at: asset.first_seen_at || null,
    reviewed_at: asset.reviewed_at || null,
    billing_enabled_at: asset.billing_enabled_at || null,
    billing_disabled_at: asset.billing_disabled_at || null,
  };
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
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
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

    return { company, userId: user.id, isPlatformOwner };
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
    .select("id, name, slug")
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

  return { company, userId: user.id, isPlatformOwner };
}

function validateCategory(value: any, fallback = "unknown") {
  const category = String(value || fallback).trim().toLowerCase();
  return ASSET_CATEGORIES.has(category) ? category : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveReviewAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: asset, error: assetError } = await supabaseAdmin
      .from("fleet_assets")
      .select(
        "id, company_id, status, billing_status, intelligence_enabled, billing_enabled_at, billing_disabled_at"
      )
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (assetError) throw assetError;
    if (!asset) {
      return noStoreJson({ success: false, error: "Asset not found" }, { status: 404 });
    }

    const action = String(body.action || "").trim().toLowerCase();
    const now = new Date().toISOString();
    const updates: Record<string, any> = {};

    if (action === "enable") {
      const category = validateCategory(body.asset_category);
      if (!category || category === "unknown") {
        return noStoreJson(
          { success: false, error: "Choose an asset category before enabling intelligence" },
          { status: 400 }
        );
      }

      updates.asset_category = category;
      updates.billing_status = "enabled";
      updates.intelligence_enabled = true;
      updates.excluded_reason = null;
      updates.reviewed_at = now;
      updates.reviewed_by = resolved.userId;
      updates.billing_disabled_at = null;
      if (!asset.billing_enabled_at) {
        updates.billing_enabled_at = now;
      }
    } else if (action === "exclude") {
      const category = validateCategory(body.asset_category, "unknown");
      const excludedReason = String(body.excluded_reason || "").trim().toLowerCase();
      if (!category) {
        return noStoreJson({ success: false, error: "Invalid asset category" }, { status: 400 });
      }
      if (!EXCLUDED_REASONS.has(excludedReason)) {
        return noStoreJson(
          { success: false, error: "Choose an excluded reason" },
          { status: 400 }
        );
      }

      updates.asset_category = category;
      updates.billing_status = "excluded";
      updates.intelligence_enabled = false;
      updates.excluded_reason = excludedReason;
      updates.reviewed_at = now;
      updates.reviewed_by = resolved.userId;
      if (shouldSetBillingDisabledAt(asset)) {
        updates.billing_disabled_at = now;
      }
    } else if (action === "disable") {
      updates.billing_status = "disabled";
      updates.intelligence_enabled = false;
      updates.reviewed_at = now;
      updates.reviewed_by = resolved.userId;
      if (shouldSetBillingDisabledAt(asset)) {
        updates.billing_disabled_at = now;
      }
    } else if (action === "review_later") {
      updates.billing_status = "unreviewed";
      updates.intelligence_enabled = false;
      updates.excluded_reason = null;
      if (shouldSetBillingDisabledAt(asset)) {
        updates.billing_disabled_at = now;
      }
    } else {
      return noStoreJson({ success: false, error: "Unsupported action" }, { status: 400 });
    }

    const { data: updatedAsset, error: updateError } = await supabaseAdmin
      .from("fleet_assets")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .select(
        "id, registration, truck_id, provider_name, status, last_seen_at, provider_location_label, asset_category, billing_status, intelligence_enabled, excluded_reason, first_seen_at, reviewed_at, billing_enabled_at, billing_disabled_at"
      )
      .single();

    if (updateError) throw updateError;

    if (action === "enable") {
      const firstTime = !asset.billing_enabled_at;
      await recordAnalyticsEvent({
        companyId: resolved.company.id,
        userId: resolved.userId,
        eventName: firstTime ? "first_asset_enabled" : "asset_enabled",
        eventCategory: "tenant_activation",
        source: "api/fleet-assets",
        metadata: {
          asset_id: updatedAsset.id,
          asset_category: updatedAsset.asset_category,
          billing_status: updatedAsset.billing_status,
          intelligence_enabled: Boolean(updatedAsset.intelligence_enabled),
          first_time: firstTime,
        },
      });
    }

    return noStoreJson({
      success: true,
      asset: sanitizeAsset(updatedAsset),
    });
  } catch (err: any) {
    console.error("Fleet asset PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update fleet asset" },
      { status: 500 }
    );
  }
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
