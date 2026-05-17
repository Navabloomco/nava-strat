import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { suggestAssetClassifications } from "../../../../lib/intelligence/assetClassificationService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REVIEW_ROLES = new Set(["owner", "admin", "platform_owner"]);

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
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
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson({ success: false, error: "Company not found" }, { status: 404 }),
      };
    }

    return { company, userId: user.id, isPlatformOwner };
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

function sanitizeAssetIds(value: any) {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  return ids.length > 0 ? ids : undefined;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { searchParams } = new URL(req.url);
    const resolved = await resolveReviewAccess(
      req,
      body.companyId || searchParams.get("companyId")
    );
    if (resolved.error) return resolved.error;

    const suggestions = await suggestAssetClassifications(resolved.company.id, {
      assetIds: sanitizeAssetIds(body.asset_ids),
    });

    for (const suggestion of suggestions) {
      const { error } = await supabaseAdmin
        .from("fleet_assets")
        .update({
          ai_suggested_category: suggestion.ai_suggested_category,
          ai_suggested_reason: suggestion.ai_suggested_reason,
          ai_confidence: suggestion.ai_confidence,
        })
        .eq("company_id", resolved.company.id)
        .eq("id", suggestion.asset_id);

      if (error) throw error;
    }

    return noStoreJson({
      success: true,
      company: {
        id: resolved.company.id,
        name: resolved.company.name,
        slug: resolved.company.slug,
      },
      suggestions: suggestions.map((suggestion) => ({
        asset_id: suggestion.asset_id,
        ai_suggested_category: suggestion.ai_suggested_category,
        ai_suggested_reason: suggestion.ai_suggested_reason,
        ai_confidence: suggestion.ai_confidence,
        signals: suggestion.signals,
      })),
    });
  } catch (err: any) {
    console.error("Fleet asset suggestion error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to suggest asset classifications",
      },
      { status: 500 }
    );
  }
}
