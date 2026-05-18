import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

async function requireActiveMembership(req: Request) {
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
    .select("company_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1);

  if (membershipError) throw membershipError;

  if (!memberships?.length) {
    return {
      error: noStoreJson(
        { success: false, error: "Active company access required" },
        { status: 403 }
      ),
    };
  }

  return { user };
}

function parseCoordinate(value: any, fieldName: string, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }

  return parsed;
}

function badRequestStatus(error: any) {
  const message = String(error?.message || "");
  return message.includes("must be") ? 400 : 500;
}

export async function POST(req: Request) {
  try {
    const access = await requireActiveMembership(req);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const latitude = parseCoordinate(body.latitude, "Latitude", -90, 90);
    const longitude = parseCoordinate(body.longitude, "Longitude", -180, 180);

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed: ${response.status}`);
    }

    const data = await response.json();
    const address = data.address || {};

    const area =
      address.suburb ||
      address.neighbourhood ||
      address.quarter ||
      address.residential ||
      address.village ||
      address.hamlet ||
      address.road ||
      null;

    const city =
      address.city ||
      address.town ||
      address.municipality ||
      address.county ||
      null;

    const region = address.state || address.region || address.county || null;
    const country = address.country || null;

    let readableLocation = "";

    if (area && city && area !== city) {
      readableLocation = `${area}, ${city}`;
    } else if (city) {
      readableLocation = city;
    } else if (area) {
      readableLocation = area;
    } else if (region) {
      readableLocation = region;
    } else {
      readableLocation = data.display_name || `${latitude}, ${longitude}`;
    }

    return noStoreJson({
      success: true,
      location: {
        readable_location: readableLocation,
        area,
        city,
        region,
        country,
        full_location: data.display_name || readableLocation,
      },
    });
  } catch (error: any) {
    const status = badRequestStatus(error);
    if (status >= 500) {
      console.error("Reverse geocoding error:", error);
    }
    return noStoreJson(
      { success: false, error: error.message || "Reverse geocoding failed" },
      { status }
    );
  }
}
