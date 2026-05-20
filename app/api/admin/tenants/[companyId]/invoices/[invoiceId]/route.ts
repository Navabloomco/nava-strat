import { supabaseAdmin } from "../../../../../../../lib/supabaseAdmin";
import {
  BILLING_INVOICE_FIELDS,
  billingInvoicesSetupResponse,
  isMissingBillingInvoicesTable,
  noStoreJson,
  requirePlatformOwner,
  sanitizeInvoice,
} from "../../../tenantBilling";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["paid", "void"],
  paid: [],
  void: [],
};

export async function PATCH(
  req: Request,
  { params }: { params: { companyId: string; invoiceId: string } }
) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const nextStatus = String(body.status || "").trim().toLowerCase();
    if (!["draft", "sent", "paid", "void"].includes(nextStatus)) {
      return noStoreJson(
        { success: false, error: "Unsupported invoice status" },
        { status: 400 }
      );
    }

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from("billing_invoices")
      .select(BILLING_INVOICE_FIELDS)
      .eq("company_id", params.companyId)
      .eq("id", params.invoiceId)
      .maybeSingle();

    if (invoiceError) {
      if (isMissingBillingInvoicesTable(invoiceError)) {
        return noStoreJson(
          {
            success: false,
            error: "Billing invoice table is not configured.",
            ...billingInvoicesSetupResponse(),
          },
          { status: 503 }
        );
      }
      throw invoiceError;
    }

    if (!invoice) {
      return noStoreJson(
        { success: false, error: "Invoice not found" },
        { status: 404 }
      );
    }

    const currentStatus = String(invoice.status || "draft").trim().toLowerCase();
    if (currentStatus === nextStatus) {
      return noStoreJson({
        success: true,
        invoice: sanitizeInvoice(invoice),
      });
    }

    if (!ALLOWED_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
      return noStoreJson(
        {
          success: false,
          error: `Cannot change invoice from ${currentStatus} to ${nextStatus}`,
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const updates: Record<string, any> = {
      status: nextStatus,
      updated_at: now,
    };

    if (nextStatus === "sent") updates.sent_at = now;
    if (nextStatus === "paid") updates.paid_at = now;
    if (nextStatus === "void") updates.voided_at = now;

    const { data: updatedInvoice, error: updateError } = await supabaseAdmin
      .from("billing_invoices")
      .update(updates)
      .eq("company_id", params.companyId)
      .eq("id", params.invoiceId)
      .select(BILLING_INVOICE_FIELDS)
      .single();

    if (updateError) {
      if (isMissingBillingInvoicesTable(updateError)) {
        return noStoreJson(
          {
            success: false,
            error: "Billing invoice table is not configured.",
            ...billingInvoicesSetupResponse(),
          },
          { status: 503 }
        );
      }
      throw updateError;
    }

    return noStoreJson({
      success: true,
      invoice: sanitizeInvoice(updatedInvoice),
    });
  } catch (err: any) {
    console.error("Admin tenant invoice PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update invoice" },
      { status: 500 }
    );
  }
}
