import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GEOFENCE_TYPES = new Set([
  "depot",
  "yard",
  "port",
  "customer_site",
  "loading_zone",
  "offloading_zone",
  "border_point",
  "restricted_area",
  "risk_zone",
  "service_area",
  "other",
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

function ensureGeofenceType(type: string) {
  return GEOFENCE_TYPES.has(type) ? type : "other";
}

function smartSuggestion(query: string, osmClass: string, osmType: string, displayName: string) {
  const text = `${query} ${osmClass} ${osmType} ${displayName}`.toLowerCase();

  if (
    text.includes("fuel") ||
    text.includes("petrol") ||
    text.includes("gas station") ||
    text.includes("shell") ||
    text.includes("total") ||
    text.includes("rubis") ||
    osmType.includes("fuel")
  ) {
    return { type: "service_area", radius: 150, confidence: "high" };
  }

  if (
    text.includes("border") ||
    text.includes("malaba") ||
    text.includes("busia") ||
    text.includes("namanga")
  ) {
    return { type: "border_point", radius: 1500, confidence: "high" };
  }

  if (
    text.includes("port") ||
    text.includes("harbour") ||
    text.includes("mombasa port")
  ) {
    return { type: "port", radius: 1200, confidence: "high" };
  }

  if (text.includes("icd") || text.includes("container depot")) {
    return { type: "depot", radius: 1200, confidence: "medium" };
  }

  if (
    text.includes("loading") ||
    text.includes("warehouse") ||
    text.includes("factory") ||
    text.includes("plant") ||
    text.includes("mill")
  ) {
    return { type: "loading_zone", radius: 600, confidence: "medium" };
  }

  if (
    text.includes("yard") ||
    text.includes("garage") ||
    text.includes("workshop") ||
    text.includes("depot")
  ) {
    return { type: "yard", radius: 600, confidence: "medium" };
  }

  if (
    text.includes("risk") ||
    text.includes("restricted") ||
    text.includes("security")
  ) {
    return { type: "risk_zone", radius: 800, confidence: "medium" };
  }

  if (
    text.includes("mall") ||
    text.includes("shopping") ||
    text.includes("centre") ||
    text.includes("center") ||
    text.includes("logistics") ||
    osmType.includes("mall")
  ) {
    return { type: "customer_site", radius: 500, confidence: "medium" };
  }

  if (
    osmClass === "amenity" ||
    osmClass === "shop" ||
    osmClass === "office" ||
    osmClass === "building"
  ) {
    return { type: "customer_site", radius: 300, confidence: "medium" };
  }

  return { type: "other", radius: 300, confidence: "low" };
}

export async function POST(req: Request) {
  try {
    const access = await requireActiveMembership(req);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();

    if (!query) {
      return noStoreJson(
        { success: false, error: "Search query required" },
        { status: 400 }
      );
    }

    if (query.length > 120) {
      return noStoreJson(
        { success: false, error: "Search query is too long" },
        { status: 400 }
      );
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=1&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Place search failed: ${response.status}`);
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
      return noStoreJson(
        {
          success: false,
          error: "Location not found. Try adding town and country.",
        },
        { status: 404 }
      );
    }

    const place = results[0];
    const latitude = Number(place.lat);
    const longitude = Number(place.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return noStoreJson(
        { success: false, error: "Location search returned an invalid result" },
        { status: 502 }
      );
    }

    const suggestion = smartSuggestion(
      query,
      String(place.class || ""),
      String(place.type || ""),
      String(place.display_name || "")
    );

    return noStoreJson({
      success: true,
      place: {
        name: query,
        display_name: String(place.display_name || query),
        latitude,
        longitude,
        suggested_type: ensureGeofenceType(suggestion.type),
        suggested_radius: suggestion.radius,
        confidence: suggestion.confidence,
      },
    });
  } catch (error: any) {
    console.error("Place search error:", error);
    return noStoreJson(
      { success: false, error: error.message || "Place search failed" },
      { status: 500 }
    );
  }
}
