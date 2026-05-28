import { NextResponse } from "next/server";
import { supabase } from "../supabase";
import { supabaseAdmin } from "../supabaseAdmin";
import {
  getRoleCapabilities,
  normalizeRole,
  rolesForCompany,
} from "./roleAccess";

type Membership = {
  company_id: string | null;
  role: string | null;
  is_active?: boolean | null;
};

type NavaEyeAuthContext = {
  user: any;
  activeMemberships: Membership[];
  isPlatformOwner: boolean;
};

type ResolveCompanyInput = {
  requestedCompanyId?: string | null;
  conversationCompanyId?: string | null;
};

const MAX_METADATA_STRING_LENGTH = 240;
const MAX_METADATA_ARRAY_LENGTH = 20;
const MAX_METADATA_OBJECT_KEYS = 50;
const MAX_METADATA_DEPTH = 4;
const MAX_MESSAGE_LENGTH = 6000;

const DANGEROUS_METADATA_PARTS = [
  "password",
  "token",
  "cookie",
  "authorization",
  "api_key",
  "apikey",
  "provider_secret",
  "auth_config",
  "raw_payload",
  "credentials",
  "secret",
  "license",
  "phone",
  "employee_code",
  "private",
];

export const NAVA_EYE_CONVERSATION_SETUP_MESSAGE =
  "Nava Eye conversation tables are not installed yet. Apply the additive SQL for nava_eye_conversations and nava_eye_conversation_messages to enable threaded investigations.";

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

export async function authenticateNavaEyeRequest(
  req: Request
): Promise<NavaEyeAuthContext | { response: NextResponse }> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      response: jsonResponse({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return {
      response: jsonResponse({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      response: jsonResponse({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = (memberships || []).map((membership) => ({
    ...membership,
    role: normalizeRole(membership.role),
  }));

  if (activeMemberships.length === 0) {
    return {
      response: jsonResponse(
        { success: false, error: "No active company access" },
        { status: 403 }
      ),
    };
  }

  return {
    user,
    activeMemberships,
    isPlatformOwner: activeMemberships.some(
      (membership) => membership.role === "platform_owner"
    ),
  };
}

export async function resolveNavaEyeCompanyAccess(
  authContext: NavaEyeAuthContext,
  input: ResolveCompanyInput = {}
): Promise<any | { response: NextResponse }> {
  const requestedCompanyId = sanitizeId(input.requestedCompanyId);
  const conversationCompanyId = sanitizeId(input.conversationCompanyId);
  const targetCompanyId = conversationCompanyId || requestedCompanyId;

  if (conversationCompanyId && requestedCompanyId && conversationCompanyId !== requestedCompanyId) {
    return {
      response: jsonResponse(
        { success: false, error: "Conversation does not belong to the requested company" },
        { status: 403 }
      ),
    };
  }

  let companyId = targetCompanyId;

  if (!authContext.isPlatformOwner) {
    const accessibleIds = authContext.activeMemberships
      .map((membership) => membership.company_id)
      .filter(Boolean) as string[];

    if (companyId && !accessibleIds.includes(companyId)) {
      return {
        response: jsonResponse(
          { success: false, error: "No active company access" },
          { status: 403 }
        ),
      };
    }

    companyId = companyId || accessibleIds[0];
  }

  if (authContext.isPlatformOwner && !companyId) {
    return {
      response: jsonResponse(
        { success: false, error: "companyId is required for platform-owner Nava Eye requests" },
        { status: 400 }
      ),
    };
  }

  if (!companyId) {
    return {
      response: jsonResponse(
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
      response: jsonResponse({ success: false, error: "Company not found" }, { status: 404 }),
    };
  }

  const roles = rolesForCompany(
    authContext.activeMemberships,
    company.id,
    authContext.isPlatformOwner
  );

  return {
    company,
    roles,
    roleCapabilities: getRoleCapabilities(roles),
  };
}

export async function fetchAccessibleConversation(
  conversationId: string,
  userId: string
) {
  const query = supabaseAdmin
    .from("nava_eye_conversations")
    .select(
      "id, company_id, created_by, title, status, last_intent, pending_followup, created_at, updated_at, closed_at, closed_by"
    )
    .eq("id", conversationId)
    .eq("created_by", userId);

  const { data, error } = await query.is("deleted_at", null).maybeSingle();

  if (error && isMissingConversationDeleteColumnError(error)) {
    return supabaseAdmin
      .from("nava_eye_conversations")
      .select(
        "id, company_id, created_by, title, status, last_intent, pending_followup, created_at, updated_at, closed_at, closed_by"
      )
      .eq("id", conversationId)
      .eq("created_by", userId)
      .maybeSingle();
  }

  return { data, error };
}

export function isMissingConversationSchemaError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || error?.details || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("nava_eye_conversations") ||
    message.includes("nava_eye_conversation_messages") ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

export function isMissingConversationDeleteColumnError(error: any) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  return (
    message.includes("deleted_at") ||
    message.includes("deleted_by")
  );
}

export function sanitizeConversation(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    company_id: row.company_id,
    title: row.title || "Nava Eye conversation",
    status: row.status || "open",
    last_intent: row.last_intent || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at || null,
    closed_by: row.closed_by || null,
  };
}

export function sanitizeConversationMessage(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    company_id: row.company_id,
    role: row.role,
    sender: row.sender,
    content: safeConversationContent(row.content),
    intent: row.intent || null,
    metadata: sanitizeConversationMetadata(row.metadata),
    created_at: row.created_at,
  };
}

export function sanitizeConversationMetadata(metadata: any): Record<string, any> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return sanitizeMetadataObject(metadata, 0);
}

export function safeConversationContent(value: any) {
  return String(value || "").slice(0, MAX_MESSAGE_LENGTH);
}

export function sanitizeId(value: unknown) {
  const text = String(value || "").trim();
  if (!text || text.length > 120) return null;
  return text;
}

function sanitizeMetadataObject(value: Record<string, any>, depth: number): Record<string, any> {
  if (depth > MAX_METADATA_DEPTH) return {};

  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_METADATA_OBJECT_KEYS)) {
    if (!isSafeMetadataKey(key)) continue;
    const sanitized = sanitizeMetadataValue(entry, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }

  return output;
}

function sanitizeMetadataValue(value: any, depth: number): any {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value === null || typeof value === "boolean") return value;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_METADATA_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    if (depth > MAX_METADATA_DEPTH) return [];
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    return sanitizeMetadataObject(value, depth);
  }

  return undefined;
}

function isSafeMetadataKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  return !DANGEROUS_METADATA_PARTS.some((part) => normalized.includes(part));
}
