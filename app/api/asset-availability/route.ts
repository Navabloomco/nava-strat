import { NextResponse } from "next/server";
import {
  canEditJourneys,
  canViewFinance,
  canViewJourneys,
  canViewOps,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";
import {
  ASSET_AVAILABILITY_FIELDS,
  fetchActiveAssetAvailabilityEvents,
  findAssetAvailabilityForTarget,
  buildAssetAvailabilityLookup,
  isAssetAvailabilitySchemaMissing,
  labelAssetAvailabilityStatus,
  normalizeAssetAvailabilityStatus,
  toSafeAssetAvailabilityEvent,
} from "../../../lib/operations/assetAvailability";
import { normalizeVehicleKey } from "../../../lib/intelligence/entityResolver";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { parseProviderTimestamp } from "../../../lib/timeFormatting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
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
        error: noStoreJson({ success: false, error: "Company not found" }, { status: 404 }),
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

    if (!canViewOps(resolved.roles) && !canViewJourneys(resolved.roles) && !canViewFinance(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Availability access required" },
        { status: 403 }
      );
    }

    const events = await fetchActiveAssetAvailabilityEvents(resolved.company.id);
    if (events.missing) return availabilitySetupRequiredResponse();

    const target = {
      asset_id: cleanUuid(searchParams.get("assetId")),
      truck_id: cleanText(searchParams.get("truckId")),
    };
    const lookup = buildAssetAvailabilityLookup(events.rows);
    const availability =
      target.asset_id || target.truck_id
        ? findAssetAvailabilityForTarget(lookup, target)
        : null;

    return noStoreJson({
      success: true,
      company: resolved.company,
      availability,
      active_availability: target.asset_id || target.truck_id ? undefined : events.rows,
      capabilities: {
        can_edit_availability: canEditJourneys(resolved.roles),
      },
    });
  } catch (err: any) {
    console.error("Asset availability GET error:", err);
    if (isAssetAvailabilitySchemaMissing(err)) return availabilitySetupRequiredResponse();
    return noStoreJson(
      { success: false, error: "Failed to load asset availability." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    if (!canEditJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Operations edit access required" },
        { status: 403 }
      );
    }

    const status = normalizeAssetAvailabilityStatus(body.status);
    if (!status) {
      return noStoreJson(
        { success: false, error: "Choose a valid availability status." },
        { status: 400 }
      );
    }

    const asset = await loadAsset(resolved.company.id, cleanUuid(body.asset_id || body.assetId));
    const truckId = cleanTruckText(
      body.truck_id ||
        body.truckId ||
        asset?.registration ||
        asset?.truck_id
    );
    if (!asset && !truckId) {
      return noStoreJson(
        { success: false, error: "Choose a truck or asset before marking availability." },
        { status: 400 }
      );
    }

    const journeyId = cleanUuid(body.journey_id || body.journeyId);
    if (journeyId) {
      const journey = await loadJourney(resolved.company.id, journeyId);
      if (!journey) {
        return noStoreJson({ success: false, error: "Trip not found." }, { status: 404 });
      }
    }

    const existing = await findMatchingActiveEvents({
      companyId: resolved.company.id,
      assetId: asset?.id || null,
      truckId,
    });
    await endAvailabilityEvents(resolved.company.id, existing.map((event) => event.id));

    if (status === "available") {
      return noStoreJson({
        success: true,
        company: resolved.company,
        availability: null,
        ended_count: existing.length,
        message: "Availability status cleared. The asset is available unless another active status is recorded.",
      });
    }

    const startedAt = normalizeStartedAt(body.started_at || body.startedAt);
    const payload = {
      company_id: resolved.company.id,
      asset_id: asset?.id || null,
      truck_id: truckId,
      journey_id: journeyId || null,
      status,
      source: "manual",
      started_at: startedAt || new Date().toISOString(),
      note: cleanNote(body.note),
      created_by: resolved.userId,
    };

    const { data, error } = await supabaseAdmin
      .from("asset_availability_events")
      .insert(payload)
      .select(ASSET_AVAILABILITY_FIELDS)
      .single();

    if (error) throw error;
    const availability = toSafeAssetAvailabilityEvent(data);

    return noStoreJson(
      {
        success: true,
        company: resolved.company,
        availability,
        ended_count: existing.length,
        message: `${labelAssetAvailabilityStatus(status)} recorded.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("Asset availability POST error:", err);
    if (isAssetAvailabilitySchemaMissing(err)) return availabilitySetupRequiredResponse();
    return noStoreJson(
      { success: false, error: "Failed to save asset availability." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    if (!canEditJourneys(resolved.roles)) {
      return noStoreJson(
        { success: false, error: "Operations edit access required" },
        { status: 403 }
      );
    }

    const id = cleanUuid(body.id);
    if (!id) {
      return noStoreJson(
        { success: false, error: "Availability status id is required." },
        { status: 400 }
      );
    }

    const { data: existing, error: loadError } = await supabaseAdmin
      .from("asset_availability_events")
      .select(ASSET_AVAILABILITY_FIELDS)
      .eq("company_id", resolved.company.id)
      .eq("id", id)
      .maybeSingle();

    if (loadError) throw loadError;
    if (!existing) {
      return noStoreJson({ success: false, error: "Availability status not found." }, { status: 404 });
    }

    const endedAt = normalizeStartedAt(body.ended_at || body.endedAt) || new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("asset_availability_events")
      .update({ ended_at: endedAt, updated_at: new Date().toISOString() })
      .eq("company_id", resolved.company.id)
      .eq("id", id)
      .select(ASSET_AVAILABILITY_FIELDS)
      .single();

    if (error) throw error;

    return noStoreJson({
      success: true,
      company: resolved.company,
      availability: toSafeAssetAvailabilityEvent(data),
      message: "Availability status ended.",
    });
  } catch (err: any) {
    console.error("Asset availability PATCH error:", err);
    if (isAssetAvailabilitySchemaMissing(err)) return availabilitySetupRequiredResponse();
    return noStoreJson(
      { success: false, error: "Failed to end asset availability status." },
      { status: 500 }
    );
  }
}

async function loadAsset(companyId: string, assetId: string | null) {
  if (!assetId) return null;
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, truck_id, registration, company_id")
    .eq("company_id", companyId)
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadJourney(companyId: string, journeyId: string) {
  const { data, error } = await supabaseAdmin
    .from("journeys")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_demo", false)
    .eq("id", journeyId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findMatchingActiveEvents(input: {
  companyId: string;
  assetId: string | null;
  truckId: string | null;
}) {
  const { data, error } = await supabaseAdmin
    .from("asset_availability_events")
    .select(ASSET_AVAILABILITY_FIELDS)
    .eq("company_id", input.companyId)
    .is("ended_at", null)
    .limit(5000);

  if (error) throw error;
  const truckKey = normalizeVehicleKey(input.truckId || "");
  return (data || []).filter((event: any) => {
    if (input.assetId && event.asset_id === input.assetId) return true;
    if (!truckKey) return false;
    return normalizeVehicleKey(event.truck_id || "") === truckKey;
  });
}

async function endAvailabilityEvents(companyId: string, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabaseAdmin
    .from("asset_availability_events")
    .update({ ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) throw error;
}

function availabilitySetupRequiredResponse() {
  return noStoreJson(
    {
      success: false,
      setup_required: true,
      error: "Asset availability status is not set up yet. Apply the asset availability migration.",
    },
    { status: 424 }
  );
}

function cleanUuid(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanText(value: any) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanTruckText(value: any) {
  const text = cleanText(value);
  return text ? text.toUpperCase() : null;
}

function cleanNote(value: any) {
  const text = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : null;
}

function normalizeStartedAt(value: any) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const timestamp = parseProviderTimestamp(String(value));
  if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toISOString();
}
