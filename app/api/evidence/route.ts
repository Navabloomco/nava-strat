import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  canViewJourneys,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EVIDENCE_BUCKET = "trip-evidence";
const SIGNED_URL_SECONDS = 300;
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
const EVIDENCE_FIELDS =
  "id, company_id, related_type, related_id, evidence_type, storage_bucket, storage_path, original_filename, mime_type, file_size_bytes, text_content, notes, verification_status, uploaded_by, uploaded_at";
const ALLOWED_RELATED_TYPES = new Set(["trip", "expense", "fuel_log", "fuel_allocation"]);
const ALLOWED_EVIDENCE_TYPES = new Set([
  "receipt",
  "mpesa_screenshot",
  "delivery_note",
  "weighbridge",
  "invoice",
  "other",
]);
const EXPENSE_EVIDENCE_TYPES = new Set(["receipt", "mpesa_screenshot", "other"]);
const TRIP_EVIDENCE_TYPES = new Set([
  "receipt",
  "delivery_note",
  "weighbridge",
  "invoice",
  "other",
]);
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      userId: string;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
      userId?: never;
    };

type RelatedRecord = {
  type: string;
  id: string;
  label: string;
  context: Record<string, string | number | null>;
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

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = normalizedRequestedCompanyId
      ? await companyQuery.eq("id", normalizedRequestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return {
      company: company as ResolvedCompany,
      isPlatformOwner,
      roles: rolesForCompany(activeMemberships, company.id, true),
      userId: user.id,
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
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

  return {
    company: company as ResolvedCompany,
    isPlatformOwner,
    roles: rolesForCompany(activeMemberships, company.id),
    userId: user.id,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Evidence access required" },
        { status: 403 }
      );
    }

    const relatedType = normalizeRelatedType(searchParams.get("relatedType"));
    const relatedId = cleanUuid(searchParams.get("relatedId"));
    if (!ALLOWED_RELATED_TYPES.has(relatedType) || !relatedId) {
      return noStoreJson(
        {
          success: false,
          error: "relatedType must be trip, expense, fuel_log, or fuel_allocation and relatedId is required",
        },
        { status: 400 }
      );
    }

    const related = await loadRelatedRecord(resolved.company.id, relatedType, relatedId);
    if (!related) {
      return noStoreJson(
        { success: false, error: `${relatedTypeLabel(relatedType)} not found` },
        { status: 404 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("evidence_attachments")
      .select(EVIDENCE_FIELDS)
      .eq("company_id", resolved.company.id)
      .eq("related_type", relatedType)
      .eq("related_id", relatedId)
      .order("uploaded_at", { ascending: false });

    if (error) throw error;

    const attachments = await Promise.all(
      (data || []).map((row: any) => toSafeAttachment(row, true))
    );

    return noStoreJson({
      success: true,
      company: resolved.company,
      related: {
        type: related.type,
        id: related.id,
        label: related.label,
        ...related.context,
      },
      attachments,
      guardrails: {
        private_storage: true,
        signed_url_ttl_seconds: SIGNED_URL_SECONDS,
        no_public_file_urls: true,
        mpesa_parsing_deferred: true,
      },
    });
  } catch (err: any) {
    console.error("Evidence GET error:", err);
    if (isEvidenceSchemaMissing(err)) return evidenceSetupRequiredResponse();
    return noStoreJson(
      { success: false, error: err.message || "Failed to load evidence" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let uploadedPath: string | null = null;

  try {
    const form = await req.formData();
    const resolved = await resolveCompany(req, stringFormValue(form.get("companyId")));
    if (resolved.error) return resolved.error;
    if (!canViewJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Evidence upload access required" },
        { status: 403 }
      );
    }

    const relatedType = normalizeRelatedType(form.get("relatedType"));
    const relatedId = cleanUuid(form.get("relatedId"));
    if (!ALLOWED_RELATED_TYPES.has(relatedType) || !relatedId) {
      return noStoreJson(
        {
          success: false,
          error: "relatedType must be trip, expense, fuel_log, or fuel_allocation and relatedId is required",
        },
        { status: 400 }
      );
    }

    const related = await loadRelatedRecord(resolved.company.id, relatedType, relatedId);
    if (!related) {
      return noStoreJson(
        { success: false, error: `${relatedTypeLabel(relatedType)} not found` },
        { status: 404 }
      );
    }

    const evidenceType = normalizeEvidenceType(form.get("evidenceType"));
    if (!isAllowedEvidenceTypeForRelatedType(relatedType, evidenceType)) {
      return noStoreJson(
        { success: false, error: unsupportedEvidenceMessage(relatedType) },
        { status: 400 }
      );
    }

    const file = form.get("file");
    if (!isUploadFile(file)) {
      return noStoreJson(
        { success: false, error: "Evidence file is required" },
        { status: 400 }
      );
    }

    const validation = validateEvidenceFile(file);
    if (!validation.valid) {
      return noStoreJson({ success: false, error: validation.error }, { status: 400 });
    }

    const attachmentId = randomUUID();
    const originalFilename = sanitizeOriginalFilename(file.name || "trip-evidence");
    const contentType = validation.contentType;
    const storagePath = `${resolved.company.id}/${storagePathSegment(
      relatedType
    )}/${relatedId}/${attachmentId}-${originalFilename}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const uploadResult = await supabaseAdmin.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: false,
      });

    if (uploadResult.error) {
      if (isEvidenceStorageMissing(uploadResult.error)) return storageSetupRequiredResponse();
      throw uploadResult.error;
    }
    uploadedPath = storagePath;

    const { data: attachment, error: insertError } = await supabaseAdmin
      .from("evidence_attachments")
      .insert({
        id: attachmentId,
        company_id: resolved.company.id,
        related_type: relatedType,
        related_id: relatedId,
        evidence_type: evidenceType,
        storage_bucket: EVIDENCE_BUCKET,
        storage_path: storagePath,
        original_filename: originalFilename,
        mime_type: contentType,
        file_size_bytes: file.size,
        notes: normalizeNotes(form.get("notes")),
        verification_status: "uploaded",
        uploaded_by: resolved.userId,
      })
      .select(EVIDENCE_FIELDS)
      .single();

    if (insertError) throw insertError;
    uploadedPath = null;

    return noStoreJson(
      {
        success: true,
        company: resolved.company,
        related: {
          type: related.type,
          id: related.id,
          label: related.label,
          ...related.context,
        },
        attachment: await toSafeAttachment(attachment, true),
        message: `Evidence uploaded and attached to the ${relatedTypeLabel(relatedType)}.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Evidence POST error:", err);
    if (uploadedPath) {
      await supabaseAdmin.storage.from(EVIDENCE_BUCKET).remove([uploadedPath]);
    }
    if (isEvidenceSchemaMissing(err)) return evidenceSetupRequiredResponse();
    if (isEvidenceStorageMissing(err)) return storageSetupRequiredResponse();
    return noStoreJson(
      { success: false, error: err.message || "Failed to upload evidence" },
      { status: 500 }
    );
  }
}

async function loadRelatedRecord(
  companyId: string,
  relatedType: string,
  relatedId: string
): Promise<RelatedRecord | null> {
  if (relatedType === "trip") return loadTrip(companyId, relatedId);
  if (relatedType === "expense") return loadExpense(companyId, relatedId);
  if (relatedType === "fuel_log") return loadFuelLog(companyId, relatedId);
  if (relatedType === "fuel_allocation") return loadFuelAllocation(companyId, relatedId);
  return null;
}

async function loadTrip(companyId: string, journeyId: string) {
  const { data, error } = await supabaseAdmin
    .from("journeys")
    .select("id, company_id, internal_trip_id")
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .eq("id", journeyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    type: "trip",
    id: data.id,
    label: data.internal_trip_id || "Trip",
    context: {
      trip_reference: data.internal_trip_id || null,
    },
  };
}

async function loadExpense(companyId: string, expenseId: string) {
  const { data, error } = await supabaseAdmin
    .from("expenses")
    .select("id, company_id, journey_id, expense_type, amount, vendor, reference_number")
    .eq("id", expenseId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.company_id === companyId) {
    return expenseRelatedRecord(data);
  }

  if (data.journey_id) {
    const trip = await loadTrip(companyId, data.journey_id);
    if (trip) return expenseRelatedRecord(data);
  }

  return null;
}

async function loadFuelLog(companyId: string, fuelLogId: string) {
  const { data, error } = await supabaseAdmin
    .from("fuel_logs")
    .select("id, company_id, truck_text, vendor, created_at")
    .eq("company_id", companyId)
    .eq("id", fuelLogId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    type: "fuel_log",
    id: data.id,
    label: data.truck_text || data.vendor || "Fuel issue",
    context: {
      fuel_log_label: data.truck_text || data.vendor || null,
    },
  };
}

async function loadFuelAllocation(companyId: string, fuelAllocationId: string) {
  const { data, error } = await supabaseAdmin
    .from("fuel_allocations")
    .select("id, company_id, fuel_log_id, journey_id, truck_text, allocation_status")
    .eq("company_id", companyId)
    .eq("id", fuelAllocationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    type: "fuel_allocation",
    id: data.id,
    label: data.truck_text || "Fuel allocation",
    context: {
      fuel_allocation_label: data.truck_text || null,
      fuel_log_id: data.fuel_log_id || null,
      trip_id: data.journey_id || null,
    },
  };
}

function expenseRelatedRecord(expense: any): RelatedRecord {
  return {
    type: "expense",
    id: expense.id,
    label:
      expense.reference_number ||
      expense.vendor ||
      expense.expense_type ||
      "Expense",
    context: {
      expense_type: expense.expense_type || null,
      supplier_payee: expense.vendor || null,
      reference_number: expense.reference_number || null,
      trip_id: expense.journey_id || null,
    },
  };
}

async function toSafeAttachment(row: any, includeSignedUrl: boolean) {
  let signedUrl: string | null = null;
  let signedUrlError: string | null = null;
  const bucket = row.storage_bucket || EVIDENCE_BUCKET;

  if (includeSignedUrl && row.storage_path) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS);
    if (error) {
      signedUrlError = "Secure file link unavailable";
    } else {
      signedUrl = data?.signedUrl || null;
    }
  }

  return {
    id: row.id,
    related_type: row.related_type,
    related_id: row.related_id,
    evidence_type: row.evidence_type,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    notes: row.notes,
    verification_status: row.verification_status,
    uploaded_at: row.uploaded_at,
    has_file: Boolean(row.storage_path),
    signed_url: signedUrl,
    signed_url_expires_in_seconds: signedUrl ? SIGNED_URL_SECONDS : null,
    download_error: signedUrlError,
  };
}

function normalizeRelatedType(value: FormDataEntryValue | string | null) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEvidenceType(value: FormDataEntryValue | string | null) {
  return String(value || "other").trim().toLowerCase() || "other";
}

function isAllowedEvidenceTypeForRelatedType(relatedType: string, evidenceType: string) {
  if (!ALLOWED_EVIDENCE_TYPES.has(evidenceType)) return false;
  if (relatedType === "expense") return EXPENSE_EVIDENCE_TYPES.has(evidenceType);
  if (relatedType === "trip") return TRIP_EVIDENCE_TYPES.has(evidenceType);
  return true;
}

function unsupportedEvidenceMessage(relatedType: string) {
  if (relatedType === "expense") {
    return "Expense evidence must be a receipt, M-Pesa screenshot, or other expense proof.";
  }
  if (relatedType === "trip") {
    return "Trip evidence must be a delivery note, weighbridge ticket, invoice, receipt, or other trip document.";
  }
  return "Unsupported evidence type";
}

function storagePathSegment(relatedType: string) {
  if (relatedType === "trip") return "trips";
  if (relatedType === "expense") return "expenses";
  if (relatedType === "fuel_log") return "fuel_logs";
  if (relatedType === "fuel_allocation") return "fuel_allocations";
  return "evidence";
}

function relatedTypeLabel(relatedType: string) {
  if (relatedType === "trip") return "Trip";
  if (relatedType === "expense") return "Expense";
  if (relatedType === "fuel_log") return "Fuel issue";
  if (relatedType === "fuel_allocation") return "Fuel allocation";
  return "Record";
}

function normalizeNotes(value: FormDataEntryValue | null) {
  const text = stringFormValue(value);
  if (!text) return null;
  return text.slice(0, 1000);
}

function stringFormValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanUuid(value: FormDataEntryValue | string | null) {
  const text = String(value || "").trim();
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text
  )
    ? text
    : null;
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "name" in value &&
      "size" in value
  );
}

function validateEvidenceFile(file: File):
  | { valid: true; contentType: string }
  | { valid: false; error: string } {
  const size = Number(file.size || 0);
  if (!size) return { valid: false, error: "Evidence file is empty" };
  if (size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: "Evidence file must be 4MB or smaller" };
  }

  const extension = fileExtension(file.name);
  const browserMimeType = String(file.type || "").toLowerCase();
  const guessedMimeType = mimeTypeFromExtension(extension);
  const contentType = browserMimeType || guessedMimeType || "application/octet-stream";
  const supportedByMime = browserMimeType ? ALLOWED_MIME_TYPES.has(browserMimeType) : false;
  const supportedByExtension = ALLOWED_EXTENSIONS.has(extension);

  if (!supportedByMime && !supportedByExtension) {
    return {
      valid: false,
      error: "Unsupported file type. Upload a receipt image or PDF.",
    };
  }

  return {
    valid: true,
    contentType: ALLOWED_MIME_TYPES.has(contentType)
      ? contentType
      : guessedMimeType || "application/octet-stream",
  };
}

function sanitizeOriginalFilename(name: string) {
  const fileName = String(name || "trip-evidence")
    .split(/[\\/]/)
    .pop() || "trip-evidence";
  const sanitized = fileName
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
  return sanitized || "trip-evidence";
}

function fileExtension(name: string) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function mimeTypeFromExtension(extension: string) {
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return null;
}

function evidenceSetupRequiredResponse() {
  return noStoreJson(
    {
      success: false,
      setup_required: true,
      error: "Evidence attachment table is not available yet. Apply the evidence_attachments migration first.",
    },
    { status: 424 }
  );
}

function storageSetupRequiredResponse() {
  return noStoreJson(
    {
      success: false,
      setup_required: true,
      error:
        "Evidence storage bucket is not available yet. Create a private trip-evidence bucket or apply the storage migration.",
    },
    { status: 424 }
  );
}

function isEvidenceSchemaMissing(err: any) {
  const text = String(err?.message || err?.details || err?.hint || err || "").toLowerCase();
  return (
    text.includes("evidence_attachments_related_type_check") ||
    text.includes("evidence_attachments") &&
    (text.includes("does not exist") ||
      text.includes("schema cache") ||
      text.includes("could not find") ||
      text.includes("relation"))
  );
}

function isEvidenceStorageMissing(err: any) {
  const text = String(err?.message || err?.error || err || "").toLowerCase();
  return (
    text.includes("bucket not found") ||
    (text.includes("trip-evidence") && text.includes("not found")) ||
    (text.includes("storage") && text.includes("not found"))
  );
}
