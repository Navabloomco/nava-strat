import { createHash, randomUUID } from "crypto";
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
const MAX_TEXT_CONTENT_CHARS = 4000;
const EVIDENCE_FIELDS =
  "id, company_id, related_type, related_id, evidence_type, storage_bucket, storage_path, original_filename, mime_type, file_size_bytes, evidence_hash, text_content, notes, verification_status, uploaded_by, uploaded_at";
const LEGACY_DUPLICATE_NOTE = "Duplicate-looking pre-hash evidence hidden.";
const ALLOWED_RELATED_TYPES = new Set(["trip", "expense", "fuel_log", "fuel_allocation"]);
const ALLOWED_EVIDENCE_TYPES = new Set([
  "receipt",
  "mpesa_screenshot",
  "delivery_note",
  "weighbridge",
  "invoice",
  "payment_proof",
  "other",
]);
const EXPENSE_EVIDENCE_TYPES = new Set([
  "receipt",
  "mpesa_screenshot",
  "invoice",
  "payment_proof",
  "other",
]);
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

    const collapsedEvidence = collapseDuplicateLookingEvidenceRows(data || []);
    const attachments = await Promise.all(
      collapsedEvidence.rows.map((row: any) => toSafeAttachment(row, true))
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
        hidden_legacy_duplicate_count: collapsedEvidence.hiddenCount,
        duplicate_pre_hash_note:
          collapsedEvidence.hiddenCount > 0 ? LEGACY_DUPLICATE_NOTE : null,
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
  let duplicateRelatedType = "record";

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
    duplicateRelatedType = relatedType;
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
    const hasFile = isUploadFile(file);
    const textContent = normalizeTextContent(form.get("textContent"));
    if (!hasFile && !textContent) {
      return noStoreJson(
        { success: false, error: "Evidence file or pasted proof text is required" },
        { status: 400 }
      );
    }

    const attachmentId = randomUUID();
    let originalFilename: string | null = null;
    let contentType: string | null = null;
    let storagePath: string | null = null;
    let fileSizeBytes: number | null = null;
    let fileBuffer: Buffer | null = null;
    let evidenceHash: string | null = null;

    if (hasFile) {
      const validation = validateEvidenceFile(file);
      if (!validation.valid) {
        return noStoreJson({ success: false, error: validation.error }, { status: 400 });
      }

      originalFilename = sanitizeOriginalFilename(file.name || "trip-evidence");
      contentType = validation.contentType;
      storagePath = `${resolved.company.id}/${storagePathSegment(
        relatedType
      )}/${relatedId}/${attachmentId}-${originalFilename}`;
      fileSizeBytes = file.size;
      fileBuffer = Buffer.from(await file.arrayBuffer());
      evidenceHash = evidenceHashForFile(fileBuffer);
    } else if (textContent) {
      evidenceHash = evidenceHashForText(textContent);
    }

    if (!evidenceHash) {
      return noStoreJson(
        {
          success: false,
          error:
            "Evidence hashing is required before upload. Apply the evidence_hash migration and try again.",
        },
        { status: 424 }
      );
    }

    const duplicate = await findDuplicateEvidence({
      companyId: resolved.company.id,
      relatedType,
      relatedId,
      evidenceHash,
    });
    if (duplicate) {
      return noStoreJson(
        {
          success: false,
          duplicate: true,
          error: duplicateEvidenceMessage(relatedType),
        },
        { status: 409 }
      );
    }

    const legacyDuplicate = await findLegacyDuplicateEvidence({
      companyId: resolved.company.id,
      relatedType,
      relatedId,
      originalFilename,
      mimeType: contentType,
      fileSizeBytes,
      textContent,
    });
    if (legacyDuplicate) {
      return noStoreJson(
        {
          success: false,
          duplicate: true,
          legacy_duplicate: true,
          error: duplicateEvidenceMessage(relatedType),
        },
        { status: 409 }
      );
    }

    if (hasFile && fileBuffer && storagePath) {
      const uploadResult = await supabaseAdmin.storage
        .from(EVIDENCE_BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: contentType || "application/octet-stream",
          upsert: false,
        });

      if (uploadResult.error) {
        if (isEvidenceStorageMissing(uploadResult.error)) return storageSetupRequiredResponse();
        throw uploadResult.error;
      }
      uploadedPath = storagePath;
    }

    const { data: attachment, error: insertError } = await supabaseAdmin
      .from("evidence_attachments")
      .insert({
        id: attachmentId,
        company_id: resolved.company.id,
        related_type: relatedType,
        related_id: relatedId,
        evidence_type: evidenceType,
        storage_bucket: storagePath ? EVIDENCE_BUCKET : null,
        storage_path: storagePath,
        original_filename: originalFilename,
        mime_type: contentType,
        file_size_bytes: fileSizeBytes,
        evidence_hash: evidenceHash,
        text_content: textContent,
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
    if (isDuplicateEvidenceError(err)) {
      return noStoreJson(
        {
          success: false,
          duplicate: true,
          error: duplicateEvidenceMessage(duplicateRelatedType),
        },
        { status: 409 }
      );
    }
    if (isEvidenceSchemaMissing(err)) return evidenceSetupRequiredResponse();
    if (isEvidenceStorageMissing(err)) return storageSetupRequiredResponse();
    return noStoreJson(
      { success: false, error: err.message || "Failed to upload evidence" },
      { status: 500 }
    );
  }
}

async function findDuplicateEvidence({
  companyId,
  relatedType,
  relatedId,
  evidenceHash,
}: {
  companyId: string;
  relatedType: string;
  relatedId: string;
  evidenceHash: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("evidence_attachments")
    .select("id")
    .eq("company_id", companyId)
    .eq("related_type", relatedType)
    .eq("related_id", relatedId)
    .eq("evidence_hash", evidenceHash)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findLegacyDuplicateEvidence({
  companyId,
  relatedType,
  relatedId,
  originalFilename,
  mimeType,
  fileSizeBytes,
  textContent,
}: {
  companyId: string;
  relatedType: string;
  relatedId: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  textContent: string | null;
}) {
  if (originalFilename && mimeType && Number(fileSizeBytes || 0) > 0) {
    const { data, error } = await supabaseAdmin
      .from("evidence_attachments")
      .select("id")
      .eq("company_id", companyId)
      .eq("related_type", relatedType)
      .eq("related_id", relatedId)
      .is("evidence_hash", null)
      .eq("original_filename", originalFilename)
      .eq("mime_type", mimeType)
      .eq("file_size_bytes", fileSizeBytes)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data) return data;
  }

  if (textContent) {
    const normalizedText = normalizeTextForHash(textContent);
    const { data, error } = await supabaseAdmin
      .from("evidence_attachments")
      .select("id, text_content, storage_path")
      .eq("company_id", companyId)
      .eq("related_type", relatedType)
      .eq("related_id", relatedId)
      .is("evidence_hash", null)
      .is("storage_path", null)
      .limit(50);

    if (error) throw error;
    return (
      (data || []).find(
        (row: any) => normalizeTextForHash(row.text_content || "") === normalizedText
      ) || null
    );
  }

  return null;
}

function collapseDuplicateLookingEvidenceRows(rows: any[]) {
  const passthrough: any[] = [];
  const groups = new Map<string, any[]>();

  for (const row of rows || []) {
    const key = duplicateLookingEvidenceKey(row);
    if (!key) {
      passthrough.push(row);
      continue;
    }
    const existing = groups.get(key) || [];
    existing.push(row);
    groups.set(key, existing);
  }

  let hiddenCount = 0;
  const visibleRows = [...passthrough];

  for (const group of groups.values()) {
    const hasLegacyNullHash = group.some((row) => !row.evidence_hash);
    if (group.length === 1 || !hasLegacyNullHash) {
      visibleRows.push(...group);
      continue;
    }

    const sorted = [...group].sort(preferHashedThenNewest);
    visibleRows.push(sorted[0]);
    hiddenCount += sorted.length - 1;
  }

  return {
    rows: visibleRows.sort(sortUploadedNewestFirst),
    hiddenCount,
  };
}

function duplicateLookingEvidenceKey(row: any) {
  const filename = String(row.original_filename || "").trim().toLowerCase();
  const mimeType = String(row.mime_type || "").trim().toLowerCase();
  const size = Number(row.file_size_bytes || 0);

  if (filename && mimeType && size > 0) {
    return `file:${filename}|${mimeType}|${size}`;
  }

  if (!row.storage_path && row.text_content) {
    return `text:${normalizeTextForHash(row.text_content)}`;
  }

  return "";
}

function preferHashedThenNewest(a: any, b: any) {
  const hashRank = Number(Boolean(b.evidence_hash)) - Number(Boolean(a.evidence_hash));
  if (hashRank !== 0) return hashRank;
  return sortUploadedNewestFirst(a, b);
}

function sortUploadedNewestFirst(a: any, b: any) {
  return Date.parse(b.uploaded_at || "") - Date.parse(a.uploaded_at || "");
}

function evidenceHashForFile(buffer: Buffer) {
  return `file:${sha256Hex(buffer)}`;
}

function evidenceHashForText(text: string) {
  return `text:${sha256Hex(normalizeTextForHash(text))}`;
}

function normalizeTextForHash(text: string) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function duplicateEvidenceMessage(relatedType: string) {
  if (relatedType === "expense") return "This proof already exists for this expense.";
  if (relatedType === "trip") return "This proof already exists for this trip.";
  return "This proof already exists for this record.";
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
    text_content: row.text_content,
    verification_status: row.verification_status,
    uploaded_at: row.uploaded_at,
    has_file: Boolean(row.storage_path),
    has_text_content: Boolean(row.text_content),
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
    return "Expense evidence must be a receipt, M-Pesa proof, invoice, payment proof, or other expense proof.";
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

function normalizeTextContent(value: FormDataEntryValue | null) {
  const text = stringFormValue(value).replace(/\r\n/g, "\n");
  if (!text) return null;
  return text.slice(0, MAX_TEXT_CONTENT_CHARS);
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
      error: "Unsupported file type. Upload a proof image or PDF.",
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
      error:
        "Evidence attachment hashing is not available yet. Apply the evidence_attachments and evidence_hash migrations first.",
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
    text.includes("evidence_hash") ||
    text.includes("evidence_attachments_related_type_check") ||
    text.includes("evidence_attachments") &&
    (text.includes("does not exist") ||
      text.includes("schema cache") ||
      text.includes("could not find") ||
      text.includes("relation"))
  );
}

function isDuplicateEvidenceError(err: any) {
  const text = String(err?.message || err?.details || err?.hint || err || "").toLowerCase();
  return (
    err?.code === "23505" ||
    text.includes("evidence_attachments_unique_related_hash") ||
    text.includes("duplicate key")
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
