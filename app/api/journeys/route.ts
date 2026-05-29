import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { supabase } from "../../../lib/supabase";
import {
  canEditJourneys,
  canViewFinance,
  canViewJourneys,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";
import { parseProviderTimestamp } from "../../../lib/timeFormatting";

export const dynamic = "force-dynamic";

const OPERATIONAL_JOURNEY_FIELDS =
  "id, internal_trip_id, asset_id, driver_id, client_name, truck, driver, from_location, to_location, route, expected_fuel_liters, status, start_time, end_time, created_at";
const FINANCE_JOURNEY_FIELDS = `${OPERATIONAL_JOURNEY_FIELDS}, loaded_quantity, offloaded_quantity, billing_quantity, billing_unit, rate_type, rate_amount, rate_currency, fx_rate, revenue_original, revenue_kes, revenue_status`;

function normalizeOptionalText(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : null;
}

function normalizeDriverText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text) return text.toUpperCase();
  }
  return null;
}

function normalizeUuid(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTimestamp(value: unknown) {
  if (value === undefined) return undefined;
  const text = String(value || "").trim();
  if (!text) return null;
  const date = parseProviderTimestamp(text);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function billingUnitFromRateType(rateType: string) {
  return rateType.startsWith("per_") ? rateType.replace("per_", "") : rateType;
}

function calculateRevenueFields(input: {
  rateType: string;
  rateAmount: number | null;
  rateCurrency: string;
  fxRate: number;
  billingQuantity: number | null;
}) {
  if (!input.rateAmount || input.rateAmount <= 0) {
    return null;
  }

  const billingQuantity = input.rateType === "per_truck" ? 1 : Number(input.billingQuantity || 0);
  const revenueOriginal = input.rateAmount * billingQuantity;
  const revenueKes =
    input.rateCurrency === "KES" ? revenueOriginal : revenueOriginal * Number(input.fxRate || 1);

  return {
    billing_quantity: billingQuantity,
    billing_unit: billingUnitFromRateType(input.rateType),
    revenue_original: revenueOriginal,
    revenue_kes: revenueKes,
    revenue_status: revenueOriginal > 0 ? "calculated" : "pending",
  };
}

function commercialPayloadWasSubmitted(body: Record<string, any>) {
  const commercialKeys = [
    "loaded_quantity",
    "loaded_tonnage",
    "offloaded_quantity",
    "offloaded_tonnage",
    "billing_quantity",
    "billing_unit",
    "rate_type",
    "rate_amount",
    "rate_currency",
    "fx_rate",
    "revenue_original",
    "revenue_kes",
    "revenue_status",
    "revenue_notes",
  ];

  return commercialKeys.some((key) => {
    if (!(key in body)) return false;
    const value = body[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function isJourneyAssetForeignKeyError(error: any) {
  const text = String(
    error?.message || error?.details || error?.hint || error || ""
  ).toLowerCase();
  return (
    text.includes("journeys_asset_id_fkey") ||
    (text.includes("foreign key") &&
      text.includes("journeys") &&
      text.includes("asset_id"))
  );
}

async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { user: null, error: "Unauthorized" };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { user: null, error: "Unauthorized" };
  }

  return { user, error: null };
}

async function resolveCompany(userId: string, requestedCompanyId?: string | null) {
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    let companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    if (normalizedRequestedCompanyId) {
      companyQuery = companyQuery.eq("id", normalizedRequestedCompanyId);
    } else {
      companyQuery = companyQuery.order("name", { ascending: true }).limit(1);
    }

    const { data: company, error: companyError } =
      await companyQuery.maybeSingle();

    if (companyError) throw companyError;
    return {
      company,
      isPlatformOwner,
      roles: company ? rolesForCompany(activeMemberships, company.id, true) : [],
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
    return { company: null, isPlatformOwner, roles: [] };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  return {
    company,
    isPlatformOwner,
    roles: company ? rolesForCompany(activeMemberships, company.id) : [],
  };
}

export async function GET(req: Request) {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestedCompanyId = searchParams.get("companyId");
    const resolved = await resolveCompany(user.id, requestedCompanyId);
    const { company } = resolved;

    if (!company) {
      return NextResponse.json(
        { success: false, error: "Company not found or access denied" },
        { status: 403 }
      );
    }
    if (!canViewJourneys(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Journey access required" },
        { status: 403 }
      );
    }

    const journeySelect = canViewFinance(resolved.roles)
      ? FINANCE_JOURNEY_FIELDS
      : OPERATIONAL_JOURNEY_FIELDS;

    const { data: journeys, error: journeysError } = await supabaseAdmin
      .from("journeys")
      .select(journeySelect)
      .eq("company_id", company.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (journeysError) throw journeysError;

    return NextResponse.json({
      success: true,
      company,
      journeys: journeys || [],
    });
  } catch (err: any) {
    console.error("Trips GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load trips" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const resolved = await resolveCompany(user.id, body.companyId || null);
    const { company } = resolved;

    if (!company) {
      return NextResponse.json(
        { success: false, error: "Company not found or access denied" },
        { status: 403 }
      );
    }
    if (!canEditJourneys(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Journey edit access required" },
        { status: 403 }
      );
    }
    const canManageCommercialDetails = canViewFinance(resolved.roles);

    const assetId = normalizeUuid(body.asset_id);
    const driverId = normalizeUuid(body.driver_id);
    let selectedAsset: any = null;
    let selectedDriver: any = null;

    if (assetId) {
      const { data: asset, error: assetError } = await supabaseAdmin
        .from("fleet_assets")
        .select("id, truck_id, registration, provider_name, status, intelligence_enabled")
        .eq("company_id", company.id)
        .eq("id", assetId)
        .maybeSingle();

      if (assetError) throw assetError;
      if (!asset) {
        return NextResponse.json(
          { success: false, error: "Selected asset was not found for this company" },
          { status: 400 }
        );
      }
      selectedAsset = asset;
    }

    if (driverId) {
      const { data: driverRecord, error: driverError } = await supabaseAdmin
        .from("drivers")
        .select("id, full_name, status")
        .eq("company_id", company.id)
        .eq("id", driverId)
        .maybeSingle();

      if (driverError) throw driverError;
      if (!driverRecord) {
        return NextResponse.json(
          { success: false, error: "Selected driver was not found for this company" },
          { status: 400 }
        );
      }
      selectedDriver = driverRecord;
    }

    const cleanTruck =
      typeof body.truck === "string" && body.truck.trim()
        ? body.truck.trim().toUpperCase()
        : String(selectedAsset?.registration || selectedAsset?.truck_id || "")
            .trim()
            .toUpperCase();
    const status =
      typeof body.status === "string" && body.status.trim()
        ? body.status.trim()
        : "active";
    const manualDriverText = normalizeDriverText(
      body.manual_driver_text,
      body.driver
    );

    if (!cleanTruck || !body.client_name || !body.from_location || !body.to_location) {
      return NextResponse.json(
        { success: false, error: "Client, truck, from, and to are required" },
        { status: 400 }
      );
    }

    if (status === "active") {
      const { data: existing, error: checkError } = await supabaseAdmin
        .from("journeys")
        .select("id, client_name, from_location, to_location")
        .eq("company_id", company.id)
        .eq("truck", cleanTruck)
        .eq("status", "active")
        .limit(1);

      if (checkError) throw checkError;

      if (existing && existing.length > 0) {
        const journey = existing[0];
        return NextResponse.json(
          {
            success: false,
            error: `${cleanTruck} already has an active journey: ${
              journey.client_name || "NO CLIENT"
            } — ${journey.from_location || "—"} → ${
              journey.to_location || "—"
            }. Complete or cancel it first.`,
          },
          { status: 409 }
        );
      }
    }

    const insertPayload: Record<string, any> = {
      company_id: company.id,
      is_demo: false,
      internal_trip_id: body.internal_trip_id || null,
      asset_id: selectedAsset?.id || null,
      driver_id: selectedDriver?.id || null,
      client_name:
        typeof body.client_name === "string"
          ? body.client_name.trim().toUpperCase()
          : body.client_name,
      truck: cleanTruck,
      driver:
        selectedDriver?.full_name?.toUpperCase() || manualDriverText || null,
      from_location:
        typeof body.from_location === "string"
          ? body.from_location.trim().toUpperCase()
          : body.from_location,
      to_location:
        typeof body.to_location === "string"
          ? body.to_location.trim().toUpperCase()
          : body.to_location,
      route:
        typeof body.route === "string" && body.route.trim()
          ? body.route.trim().toUpperCase()
          : `${String(body.from_location || "").trim().toUpperCase()} → ${String(
              body.to_location || ""
            )
              .trim()
              .toUpperCase()}`,
      expected_fuel_liters: body.expected_fuel_liters ?? null,
      status,
    };

    const startTime = normalizeTimestamp(body.start_time);
    const endTime = normalizeTimestamp(body.end_time);
    if (startTime !== undefined) insertPayload.start_time = startTime;
    if (endTime !== undefined) insertPayload.end_time = endTime;

    const commercialFieldsIgnored =
      !canManageCommercialDetails && commercialPayloadWasSubmitted(body);

    if (canManageCommercialDetails) {
      const loadedQuantity = normalizeNumber(body.loaded_quantity ?? body.loaded_tonnage);
      const offloadedQuantity = normalizeNumber(body.offloaded_quantity ?? body.offloaded_tonnage);
      const billingQuantity = normalizeNumber(
        body.billing_quantity ?? offloadedQuantity ?? loadedQuantity
      );
      const rateAmount = normalizeNumber(body.rate_amount);
      const rateType =
        typeof body.rate_type === "string" && body.rate_type.trim()
          ? body.rate_type.trim()
          : "per_tonne";
      const rateCurrency =
        typeof body.rate_currency === "string" && body.rate_currency.trim()
          ? body.rate_currency.trim().toUpperCase()
          : "KES";
      const providedFxRate = normalizeNumber(body.fx_rate);
      if (rateAmount !== null && rateCurrency !== "KES" && providedFxRate === null) {
        return NextResponse.json(
          { success: false, error: "FX rate is required when rate currency is not KES" },
          { status: 400 }
        );
      }
      const fxRate = rateCurrency === "KES" ? 1 : providedFxRate || 1;

      if (loadedQuantity !== null) insertPayload.loaded_quantity = loadedQuantity;
      if (offloadedQuantity !== null) insertPayload.offloaded_quantity = offloadedQuantity;
      if (body.loaded_tonnage !== undefined) insertPayload.loaded_tonnage = loadedQuantity;
      if (body.offloaded_tonnage !== undefined) insertPayload.offloaded_tonnage = offloadedQuantity;
      if (billingQuantity !== null) {
        insertPayload.billing_quantity = billingQuantity;
        insertPayload.billing_unit = billingUnitFromRateType(rateType);
      }
      if (rateAmount !== null) {
        insertPayload.rate_type = rateType;
        insertPayload.rate_amount = rateAmount;
        insertPayload.rate_currency = rateCurrency;
        insertPayload.fx_rate = fxRate;
        const revenue = calculateRevenueFields({
          rateType,
          rateAmount,
          rateCurrency,
          fxRate,
          billingQuantity,
        });
        if (revenue) Object.assign(insertPayload, revenue);
      }
      const revenueNotes = normalizeOptionalText(body.revenue_notes);
      if (revenueNotes !== undefined) insertPayload.revenue_notes = revenueNotes;
    }

    let assetLinkOmitted = false;
    let { data: journey, error: insertError } = await supabaseAdmin
      .from("journeys")
      .insert(insertPayload)
      .select(OPERATIONAL_JOURNEY_FIELDS)
      .single();

    if (insertError && selectedAsset?.id && isJourneyAssetForeignKeyError(insertError)) {
      const retryPayload = {
        ...insertPayload,
        asset_id: null,
      };
      const retry = await supabaseAdmin
        .from("journeys")
        .insert(retryPayload)
        .select(OPERATIONAL_JOURNEY_FIELDS)
        .single();

      journey = retry.data;
      insertError = retry.error;
      assetLinkOmitted = !retry.error;
    }

    if (insertError) throw insertError;

    const warnings = [
      ...(assetLinkOmitted
        ? [
            "Selected provider asset was preserved as the trip vehicle text, but asset_id was left empty because the current journey schema does not accept fleet_assets IDs.",
          ]
        : []),
      ...(commercialFieldsIgnored
        ? [
            "Finance fields were ignored because revenue, rates, FX, and billing quantities are restricted to finance and management roles.",
          ]
        : []),
    ];

    return NextResponse.json({
      success: true,
      company,
      journey,
      asset_link: selectedAsset
        ? {
            selected_fleet_asset_id: selectedAsset.id,
            saved_asset_id: journey?.asset_id || null,
            status: assetLinkOmitted ? "omitted_fk_mismatch" : "linked",
            note: assetLinkOmitted
              ? "Selected provider asset was preserved as the trip vehicle text, but asset_id was left empty because the current journey schema does not accept fleet_assets IDs."
              : null,
          }
        : null,
      warnings,
    });
  } catch (err: any) {
    console.error("Trips POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to create journey" },
      { status: 500 }
    );
  }
}
