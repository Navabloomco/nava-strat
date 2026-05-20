import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import {
  BILLING_INVOICE_FIELDS,
  billingInvoicesSetupResponse,
  buildDraftInvoicePayload,
  buildInvoicePreview,
  fetchCompany,
  isMissingBillingInvoicesTable,
  noStoreJson,
  requirePlatformOwner,
  sanitizeInvoice,
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

    const companyResult = await fetchCompany(params.companyId);
    if (companyResult.error) throw companyResult.error;
    if (!companyResult.data) {
      return noStoreJson(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("billing_invoices")
      .select(BILLING_INVOICE_FIELDS)
      .eq("company_id", params.companyId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingBillingInvoicesTable(error)) {
        return noStoreJson({
          success: true,
          invoices: [],
          ...billingInvoicesSetupResponse(),
        });
      }
      throw error;
    }

    return noStoreJson({
      success: true,
      setup_required: false,
      invoices: (data || []).map(sanitizeInvoice),
    });
  } catch (err: any) {
    console.error("Admin tenant invoices GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load invoices" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: { companyId: string } }
) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const companyResult = await fetchCompany(params.companyId);
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
      .eq("company_id", params.companyId);

    if (assetsError) throw assetsError;

    const assetSummary = summarizeAssets(assets || []);
    const invoicePreview = buildInvoicePreview({
      company,
      importedAssetCount: assetSummary.imported_asset_count,
      strictBillableAssetCount: assetSummary.strict_billable_asset_count,
      period: body.period,
    });
    const periodStart = String(invoicePreview.period_start || "").slice(0, 10);
    const periodEnd = String(invoicePreview.period_end || "").slice(0, 10);

    const { data: existingInvoices, error: existingError } = await supabaseAdmin
      .from("billing_invoices")
      .select("id, invoice_number, status")
      .eq("company_id", params.companyId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .neq("status", "void")
      .limit(1);

    if (existingError) {
      if (isMissingBillingInvoicesTable(existingError)) {
        return noStoreJson(
          {
            success: false,
            error: "Billing invoice table is not configured.",
            ...billingInvoicesSetupResponse(),
          },
          { status: 503 }
        );
      }
      throw existingError;
    }

    if (existingInvoices && existingInvoices.length > 0) {
      return noStoreJson(
        {
          success: false,
          error:
            "An active invoice already exists for this company and billing period. Void it before creating another.",
          invoice: sanitizeInvoice(existingInvoices[0]),
        },
        { status: 409 }
      );
    }

    const payload = buildDraftInvoicePayload({
      company,
      invoicePreview,
      userId: access.user.id,
      notes: body.notes,
    });

    const { data: invoice, error: insertError } = await supabaseAdmin
      .from("billing_invoices")
      .insert(payload)
      .select(BILLING_INVOICE_FIELDS)
      .single();

    if (insertError) {
      if (isMissingBillingInvoicesTable(insertError)) {
        return noStoreJson(
          {
            success: false,
            error: "Billing invoice table is not configured.",
            ...billingInvoicesSetupResponse(),
          },
          { status: 503 }
        );
      }
      throw insertError;
    }

    return noStoreJson(
      {
        success: true,
        invoice: sanitizeInvoice(invoice),
        invoice_preview: invoicePreview,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Admin tenant invoices POST error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to create invoice" },
      { status: 500 }
    );
  }
}
