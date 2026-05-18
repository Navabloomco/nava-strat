import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APPLY_ROLES = new Set(["platform_owner", "owner", "admin", "ops"]);
const CONTEXT_TYPES = new Set([
  "road_disruption",
  "traffic_congestion",
  "police_checkpoint",
  "port_delay",
  "border_delay",
  "loading_queue",
  "weather_delay",
  "dispatch_hold",
  "client_delay",
  "security_disruption",
  "other",
]);
const APPLY_SCOPES = new Set(["all_affected", "selected"]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
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

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("Invalid") ||
    message.includes("must")
    ? 400
    : 500;
}

async function resolveOpsAlertAccess(
  req: Request,
  requestedCompanyId?: string | null
) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const canApply =
    isPlatformOwner || roles.some((role) => APPLY_ROLES.has(role));

  if (!canApply) {
    return {
      error: noStoreJson(
        { success: false, error: "Operations alert context access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
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
      userId: user.id,
      roles,
      isPlatformOwner,
    };
  }

  const membership = activeMemberships.find((item) =>
    APPLY_ROLES.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Operations alert context access required" },
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
    userId: user.id,
    roles,
    isPlatformOwner,
  };
}

function normalizeBody(body: any) {
  const eventIds = Array.isArray(body.event_ids)
    ? Array.from(
        new Set(
          body.event_ids
            .map((eventId: any) => String(eventId || "").trim())
            .filter(Boolean)
        )
      )
    : [];
  const contextType = String(body.context_type || "").trim();
  const contextLabel = String(body.context_label || "").trim();
  const contextNote =
    typeof body.context_note === "string" && body.context_note.trim()
      ? body.context_note.trim()
      : null;
  const applyScope = String(body.apply_scope || "").trim();

  if (eventIds.length === 0) throw new Error("At least one event is required");
  if (!CONTEXT_TYPES.has(contextType)) throw new Error("Invalid context type");
  if (!contextLabel) throw new Error("Context label is required");
  if (!APPLY_SCOPES.has(applyScope)) throw new Error("Invalid apply scope");

  return {
    eventIds,
    contextType,
    contextLabel,
    contextNote,
    applyScope,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { eventIds, contextType, contextLabel, contextNote, applyScope } =
      normalizeBody(body);
    const resolved = await resolveOpsAlertAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("telemetry_events")
      .select("id, company_id, truck_id, event_type")
      .eq("company_id", resolved.company.id)
      .in("id", eventIds);

    if (eventsError) throw eventsError;

    const enabledTruckIdsResult = await supabaseAdmin
      .from("fleet_assets")
      .select("truck_id")
      .eq("company_id", resolved.company.id)
      .eq("status", "active")
      .eq("intelligence_enabled", true);

    if (enabledTruckIdsResult.error) throw enabledTruckIdsResult.error;

    const enabledTruckIds = new Set(
      (enabledTruckIdsResult.data || [])
        .map((asset) => asset.truck_id)
        .filter(Boolean)
    );
    const eligibleEventIds = (events || [])
      .filter((event) => event.event_type === "excessive_idle")
      .filter((event) => event.truck_id && enabledTruckIds.has(event.truck_id))
      .map((event) => event.id);
    const eligibleSet = new Set(eligibleEventIds);
    const skippedEventIds = eventIds.filter((eventId) => !eligibleSet.has(eventId));

    if (eligibleEventIds.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("telemetry_events")
        .update({
          context_type: contextType,
          context_label: contextLabel,
          context_note: contextNote,
          context_applied_by: resolved.userId,
          context_applied_at: new Date().toISOString(),
        })
        .eq("company_id", resolved.company.id)
        .eq("event_type", "excessive_idle")
        .in("id", eligibleEventIds);

      if (updateError) throw updateError;
    }

    return noStoreJson({
      success: true,
      apply_scope: applyScope,
      annotated_count: eligibleEventIds.length,
      skipped_count: skippedEventIds.length,
      skipped_event_ids: skippedEventIds,
    });
  } catch (err: any) {
    console.error("Apply alert context error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to apply alert context" },
      { status: badRequestStatus(err) }
    );
  }
}
