import {
  authenticateNavaEyeRequest,
  fetchAccessibleConversation,
  isMissingConversationSchemaError,
  jsonResponse,
  resolveNavaEyeCompanyAccess,
  sanitizeConversation,
  sanitizeConversationMessage,
  sanitizeId,
  NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
} from "../../../../../lib/api/navaEyeConversations";
import { recordAnalyticsEvent } from "../../../../../lib/api/analyticsEvents";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await authenticateNavaEyeRequest(req);
    if ("response" in auth) return auth.response;

    const conversationId = sanitizeId(context.params.id);
    if (!conversationId) {
      return jsonResponse(
        { success: false, error: "Valid conversation id required" },
        { status: 400 }
      );
    }

    const { data: conversation, error: conversationError } =
      await fetchAccessibleConversation(conversationId, auth.user.id);
    if (conversationError) {
      if (isMissingConversationSchemaError(conversationError)) {
        return jsonResponse(
          {
            success: false,
            setup_required: true,
            error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
          },
          { status: 503 }
        );
      }
      throw conversationError;
    }

    if (!conversation) {
      return jsonResponse(
        { success: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const resolved = await resolveNavaEyeCompanyAccess(auth, {
      conversationCompanyId: conversation.company_id,
    });
    if ("response" in resolved) return resolved.response;

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("nava_eye_conversation_messages")
      .select(
        "id, conversation_id, company_id, user_id, role, sender, content, intent, metadata, created_at"
      )
      .eq("conversation_id", conversation.id)
      .eq("company_id", resolved.company.id)
      .order("created_at", { ascending: true })
      .limit(100);

    if (messagesError) {
      if (isMissingConversationSchemaError(messagesError)) {
        return jsonResponse(
          {
            success: false,
            setup_required: true,
            error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
          },
          { status: 503 }
        );
      }
      throw messagesError;
    }

    return jsonResponse({
      success: true,
      company: resolved.company,
      conversation: sanitizeConversation(conversation),
      messages: (messages || []).map(sanitizeConversationMessage),
    });
  } catch (err: any) {
    console.error("Nava Eye conversation detail error:", err);
    return jsonResponse(
      { success: false, error: "Unable to load Nava Eye conversation" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  context: { params: { id: string } }
) {
  try {
    const auth = await authenticateNavaEyeRequest(req);
    if ("response" in auth) return auth.response;

    const conversationId = sanitizeId(context.params.id);
    if (!conversationId) {
      return jsonResponse(
        { success: false, error: "Valid conversation id required" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    if (String(body?.status || "").trim().toLowerCase() !== "closed") {
      return jsonResponse(
        { success: false, error: "Only closing conversations is supported in this MVP" },
        { status: 400 }
      );
    }

    const { data: conversation, error: conversationError } =
      await fetchAccessibleConversation(conversationId, auth.user.id);
    if (conversationError) {
      if (isMissingConversationSchemaError(conversationError)) {
        return jsonResponse(
          {
            success: false,
            setup_required: true,
            error: NAVA_EYE_CONVERSATION_SETUP_MESSAGE,
          },
          { status: 503 }
        );
      }
      throw conversationError;
    }

    if (!conversation) {
      return jsonResponse(
        { success: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const resolved = await resolveNavaEyeCompanyAccess(auth, {
      conversationCompanyId: conversation.company_id,
    });
    if ("response" in resolved) return resolved.response;

    if (conversation.status === "closed") {
      return jsonResponse({
        success: true,
        conversation: sanitizeConversation(conversation),
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("nava_eye_conversations")
      .update({
        status: "closed",
        closed_at: now,
        closed_by: auth.user.id,
        updated_at: now,
      })
      .eq("id", conversation.id)
      .eq("created_by", auth.user.id)
      .eq("company_id", resolved.company.id)
      .select(
        "id, company_id, created_by, title, status, last_intent, pending_followup, created_at, updated_at, closed_at, closed_by"
      )
      .single();

    if (updateError) throw updateError;

    await recordAnalyticsEvent({
      companyId: resolved.company.id,
      userId: auth.user.id,
      eventName: "nava_eye_conversation_closed",
      eventCategory: "nava_eye",
      source: "api/nava-eye/conversations/[id]",
      metadata: {
        conversation_id: conversation.id,
        previous_status: conversation.status || "open",
        new_status: "closed",
      },
    });

    return jsonResponse({
      success: true,
      conversation: sanitizeConversation(updated),
    });
  } catch (err: any) {
    console.error("Nava Eye conversation close error:", err);
    return jsonResponse(
      { success: false, error: "Unable to close Nava Eye conversation" },
      { status: 500 }
    );
  }
}
