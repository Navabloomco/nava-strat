import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const COMPANY_FIELDS =
  "id, name, slug, subscription_plan, business_type, primary_asset_types, main_billing_unit, operating_regions, primary_use_case, asset_unit_price, billing_currency, included_assets";

type ReadinessStatus =
  | "ready"
  | "needs_assets"
  | "needs_provider"
  | "needs_billing_setup";

export function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

export async function requirePlatformOwner(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const isPlatformOwner = (memberships || []).some(
    (membership) =>
      String(membership.role || "").trim().toLowerCase() === "platform_owner"
  );

  if (!isPlatformOwner) {
    return {
      error: noStoreJson(
        { success: false, error: "Platform owner access required" },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export function isStrictBillableAsset(asset: any) {
  return (
    asset.status === "active" &&
    asset.billing_status === "enabled" &&
    Boolean(asset.intelligence_enabled) &&
    Boolean(asset.billing_enabled_at)
  );
}

export function summarizeAssets(assets: any[]) {
  return {
    imported_asset_count: assets.length,
    unreviewed_asset_count: assets.filter((asset) => asset.billing_status === "unreviewed")
      .length,
    enabled_intelligence_count: assets.filter(
      (asset) =>
        asset.status === "active" &&
        asset.billing_status === "enabled" &&
        Boolean(asset.intelligence_enabled)
    ).length,
    strict_billable_asset_count: assets.filter(isStrictBillableAsset).length,
    excluded_asset_count: assets.filter((asset) => asset.billing_status === "excluded")
      .length,
    disabled_asset_count: assets.filter((asset) => asset.billing_status === "disabled")
      .length,
  };
}

export function buildPricingPreview(company: any, strictBillableAssetCount: number) {
  const assetUnitPrice = Number(company?.asset_unit_price || 0);
  const pricingSet = Number.isFinite(assetUnitPrice) && assetUnitPrice > 0;
  const currency = company?.billing_currency || "KES";

  return {
    pricing_set: pricingSet,
    asset_unit_price: pricingSet ? assetUnitPrice : null,
    billing_currency: currency,
    included_assets: Number(company?.included_assets || 0),
    estimated_monthly_revenue: pricingSet
      ? strictBillableAssetCount * assetUnitPrice
      : null,
  };
}

export function buildInvoicePreview(input: {
  company: any;
  importedAssetCount: number;
  strictBillableAssetCount: number;
  period?: string | null;
}) {
  const period = resolveBillingPeriod(input.period);
  const assetUnitPrice = Number(input.company?.asset_unit_price || 0);
  const pricingSet = Number.isFinite(assetUnitPrice) && assetUnitPrice > 0;
  const billingCurrency = input.company?.billing_currency || "KES";
  const includedAssets = Math.max(Number(input.company?.included_assets || 0), 0);
  const extraBillableAssets = Math.max(
    Number(input.strictBillableAssetCount || 0) - includedAssets,
    0
  );
  const estimatedMonthlyTotal = pricingSet
    ? extraBillableAssets * assetUnitPrice
    : null;
  const readinessWarnings = [];

  if (!pricingSet) {
    readinessWarnings.push("Pricing is missing or zero for this company.");
  }

  if (input.strictBillableAssetCount === 0) {
    readinessWarnings.push("No strict billable assets are enabled for this company.");
  }

  return {
    company: safeCompany(input.company),
    billing_currency: billingCurrency,
    selected_billing_period: period.selected_billing_period,
    period_start: period.period_start,
    period_end: period.period_end,
    imported_asset_count: input.importedAssetCount,
    strict_billable_asset_count: input.strictBillableAssetCount,
    included_assets: includedAssets,
    extra_billable_assets: extraBillableAssets,
    asset_unit_price: pricingSet ? assetUnitPrice : null,
    pricing_set: pricingSet,
    estimated_monthly_total: estimatedMonthlyTotal,
    line_items: [
      {
        label: "Included assets allowance",
        description: "Included enabled intelligence vehicles covered by the tenant plan.",
        quantity: includedAssets,
        included_used: Math.min(input.strictBillableAssetCount, includedAssets),
        unit_price: 0,
        amount: 0,
      },
      {
        label: "Extra enabled intelligence vehicles",
        description: "Strict billable assets above the included asset allowance.",
        quantity: extraBillableAssets,
        unit_price: pricingSet ? assetUnitPrice : null,
        amount: estimatedMonthlyTotal,
      },
    ],
    readiness_warnings: readinessWarnings,
    note: "Preview only. No invoice has been created.",
  };
}

export function resolveBillingPeriod(period?: string | null) {
  const now = new Date();
  const periodText =
    typeof period === "string" && /^\d{4}-\d{2}$/.test(period)
      ? period
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [yearText, monthText] = periodText.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

  return {
    selected_billing_period: periodText,
    period_start: start.toISOString(),
    period_end: end.toISOString(),
  };
}

export function buildReadinessStatus(input: {
  providerCount: number;
  importedAssetCount: number;
  strictBillableAssetCount: number;
  pricingSet: boolean;
}): ReadinessStatus {
  if (input.providerCount === 0) return "needs_provider";
  if (input.importedAssetCount === 0 || input.strictBillableAssetCount === 0) {
    return "needs_assets";
  }
  if (!input.pricingSet) return "needs_billing_setup";
  return "ready";
}

export function readinessLabel(status: ReadinessStatus) {
  if (status === "ready") return "Ready";
  if (status === "needs_provider") return "Needs provider";
  if (status === "needs_assets") return "Needs assets";
  return "Needs billing setup";
}

export function safeCompany(company: any) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    status: null,
    subscription_plan: company.subscription_plan || null,
  };
}

export function safeOperatingContext(company: any) {
  return {
    business_type: company.business_type || null,
    primary_asset_types: company.primary_asset_types || [],
    main_billing_unit: company.main_billing_unit || null,
    operating_regions: company.operating_regions || [],
    primary_use_case: company.primary_use_case || null,
  };
}

export async function fetchCompanies() {
  return supabaseAdmin
    .from("companies")
    .select(COMPANY_FIELDS)
    .order("name", { ascending: true });
}

export async function fetchCompany(companyId: string) {
  return supabaseAdmin
    .from("companies")
    .select(COMPANY_FIELDS)
    .eq("id", companyId)
    .maybeSingle();
}
