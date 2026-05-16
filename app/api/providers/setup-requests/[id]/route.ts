import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_STATUSES = new Set([
  "new",
  "reviewing",
  "template_in_progress",
  "verified",
  "closed",
]);

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeRequest(request: any) {
  return {
    id: request.id,
    company_id: request.company_id,
    user_id: request.user_id,
    provider_name: request.provider_name,
    provider_website: request.provider_website || null,
    provider_contact: request.provider_contact || null,
    access_type_known: request.access_type_known || "unsure",
    notes: request.notes || null,
    status: request.status || "new",
    internal_notes: request.internal_notes || null,
    created_at: request.created_at || null,
    updated_at: request.updated_at || null,
  };
}

async function requirePlatformOwner(req: Request) {
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
    .select("role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const isPlatformOwner = (memberships || []).some(
    (membership) => membership.role === "platform_owner"
  );

  if (!isPlatformOwner) {
    return {
      error: noStoreJson(
        { success: false, error: "Platform owner access required" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformOwner(req);
    if (auth.error) return auth.error;

    const body = await req.json();
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      const status = String(body.status || "").trim();
      if (!ALLOWED_STATUSES.has(status)) {
        return noStoreJson(
          { success: false, error: "Invalid request status" },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    if (Object.prototype.hasOwnProperty.call(body, "internal_notes")) {
      updates.internal_notes = body.internal_notes
        ? String(body.internal_notes)
        : null;
    }

    const { data: request, error } = await supabaseAdmin
      .from("provider_setup_requests")
      .update(updates)
      .eq("id", params.id)
      .select(
        "id, company_id, user_id, provider_name, provider_website, provider_contact, access_type_known, notes, status, internal_notes, created_at, updated_at"
      )
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      request: sanitizeRequest(request),
    });
  } catch (err: any) {
    console.error("Provider setup request update error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update provider request" },
      { status: 500 }
    );
  }
}
