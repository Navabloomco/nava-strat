import {
  authenticateNavaEyeRequest,
  isMissingConversationDeleteColumnError,
  isMissingConversationSchemaError,
  jsonResponse,
  resolveNavaEyeCompanyAccess,
  sanitizeConversation,
  NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
} from "../../../../lib/api/navaEyeConversations";
import { recordAnalyticsEvent } from "../../../../lib/api/analyticsEvents";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const auth = await authenticateNavaEyeRequest(req);
    if ("response" in auth) return auth.response;

    const url = new URL(req.url);
    const status = normalizeStatus(url.searchParams.get("status"));
    const companyId = url.searchParams.get("companyId");
    const resolved = await resolveNavaEyeCompanyAccess(auth, {
      requestedCompanyId: companyId,
    });
    if ("response" in resolved) return resolved.response;

    const selectFields =
      "id, company_id, created_by, title, status, last_intent, pending_followup, created_at, updated_at, closed_at, closed_by";
    let query = supabaseAdmin
      .from("nava_eye_conversations")
      .select(selectFields)
      .eq("company_id", resolved.company.id)
      .eq("created_by", auth.user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (status) {
      query = query.eq("status", status);
    }

    let { data, error } = await query;
    if (error) {
      if (isMissingConversationDeleteColumnError(error)) {
        let fallbackQuery = supabaseAdmin
          .from("nava_eye_conversations")
          .select(selectFields)
          .eq("company_id", resolved.company.id)
          .eq("created_by", auth.user.id)
          .order("updated_at", { ascending: false })
          .limit(50);

        if (status) {
          fallbackQuery = fallbackQuery.eq("status", status);
        }

        const fallback = await fallbackQuery;
        data = fallback.data;
        error = fallback.error;
      }
    }

    if (error) {
      if (isMissingConversationSchemaError(error)) {
        return jsonResponse({
          success: false,
          setup_required: true,
          error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
          conversations: [],
        });
      }
      throw error;
    }

    return jsonResponse({
      success: true,
      company: resolved.company,
      conversations: (data || []).map(sanitizeConversation),
    });
  } catch (err: any) {
    console.error("Nava Eye conversations list error:", err);
    return jsonResponse(
      { success: false, error: "Unable to load Nava Eye conversations" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateNavaEyeRequest(req);
    if ("response" in auth) return auth.response;

    const body = await req.json().catch(() => ({}));
    const resolved = await resolveNavaEyeCompanyAccess(auth, {
      requestedCompanyId: body?.companyId,
    });
    if ("response" in resolved) return resolved.response;

    const title = sanitizeTitle(body?.title) || "New Nava Eye conversation";
    const { data, error } = await supabaseAdmin
      .from("nava_eye_conversations")
      .insert({
        company_id: resolved.company.id,
        created_by: auth.user.id,
        title,
        status: "open",
        pending_followup: {},
      })
      .select(
        "id, company_id, created_by, title, status, last_intent, pending_followup, created_at, updated_at, closed_at, closed_by"
      )
      .single();

    if (error) {
      if (isMissingConversationSchemaError(error)) {
        return jsonResponse(
          {
            success: false,
            setup_required: true,
            error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    await recordAnalyticsEvent({
      companyId: resolved.company.id,
      userId: auth.user.id,
      eventName: "nava_eye_conversation_created",
      eventCategory: "nava_eye",
      source: "api/nava-eye/conversations",
      metadata: {
        conversation_id: data?.id,
        status: "open",
      },
    });

    return jsonResponse({
      success: true,
      conversation: sanitizeConversation(data),
    });
  } catch (err: any) {
    console.error("Nava Eye conversation create error:", err);
    return jsonResponse(
      { success: false, error: "Unable to create Nava Eye conversation" },
      { status: 500 }
    );
  }
}

function normalizeStatus(value: string | null) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "open" || status === "closed") return status;
  return null;
}

function sanitizeTitle(value: unknown) {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  if (!title) return null;
  return title.slice(0, 120);
}
