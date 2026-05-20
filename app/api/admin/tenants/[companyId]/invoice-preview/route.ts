import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import {
  buildInvoicePreview,
  fetchCompany,
  noStoreJson,
  requirePlatformOwner,
  summarizeAssets,
} from "../../tenantBilling";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: { companyId: string } }
) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const { searchParams } = new URL(req.url);
    const companyId = params.companyId;
    const companyResult = await fetchCompany(companyId);
    if (companyResult.error) throw companyResult.error;

    const company = companyResult.data;
    if (!company) {
      return noStoreJson(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    const { data: assets, error: assetsError } = await supabaseAdmin
      .from("fleet_assets")
      .select("id, status, billing_status, intelligence_enabled, billing_enabled_at")
      .eq("company_id", companyId);

    if (assetsError) throw assetsError;

    const assetSummary = summarizeAssets(assets || []);
    const invoicePreview = buildInvoicePreview({
      company,
      importedAssetCount: assetSummary.imported_asset_count,
      strictBillableAssetCount: assetSummary.strict_billable_asset_count,
      period: searchParams.get("period"),
    });

    return noStoreJson({
      success: true,
      invoice_preview: invoicePreview,
      billing_rule: {
        strict_billable_asset:
          "status=active AND billing_status=enabled AND intelligence_enabled=true AND billing_enabled_at is not null",
      },
    });
  } catch (err: any) {
    console.error("Admin tenant invoice preview GET error:", err);
    return noStoreJson(
      {
        success: false,
        error: err.message || "Failed to load invoice preview",
      },
      { status: 500 }
    );
  }
}
