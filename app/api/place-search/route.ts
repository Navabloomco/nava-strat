import { NextResponse } from "next/server";

function smartSuggestion(query: string, osmClass: string, osmType: string, displayName: string) {
  const text = `${query} ${osmClass} ${osmType} ${displayName}`.toLowerCase();

  if (
    text.includes("shell") ||
    text.includes("total") ||
    text.includes("rubis") ||
    text.includes("petrol") ||
    text.includes("fuel") ||
    text.includes("gas station") ||
    osmType.includes("fuel")
  ) {
    return { type: "fuel", radius: 150, confidence: "high" };
  }

  if (
    text.includes("border") ||
    text.includes("malaba") ||
    text.includes("busia") ||
    text.includes("namanga")
  ) {
    return { type: "border", radius: 1500, confidence: "high" };
  }

  if (
    text.includes("port") ||
    text.includes("harbour") ||
    text.includes("mombasa port") ||
    text.includes("icd") ||
    text.includes("container depot")
  ) {
    return { type: "depot", radius: 1200, confidence: "medium" };
  }

  if (
    text.includes("mall") ||
    text.includes("shopping") ||
    text.includes("centre") ||
    text.includes("center") ||
    osmType.includes("mall")
  ) {
    return { type: "client", radius: 500, confidence: "medium" };
  }

  if (
    text.includes("warehouse") ||
    text.includes("factory") ||
    text.includes("plant") ||
    text.includes("mill") ||
    text.includes("logistics")
  ) {
    return { type: "client", radius: 600, confidence: "medium" };
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
    osmClass === "amenity" ||
    osmClass === "shop" ||
    osmClass === "office" ||
    osmClass === "building"
  ) {
    return { type: "client", radius: 300, confidence: "medium" };
  }

  return { type: "client", radius: 300, confidence: "low" };
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Search query required" }, { status: 400 });
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=1&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0 contact@navabloomco.com",
      },
    });

    const results = await response.json();

    if (!results || results.length === 0) {
      return NextResponse.json(
        {
          error: "Location not found. Try adding town/country, e.g. Shell Bonje Mombasa Kenya.",
        },
        { status: 404 }
      );
    }

    const place = results[0];

    const suggestion = smartSuggestion(
      query,
      place.class || "",
      place.type || "",
      place.display_name || ""
    );

    return NextResponse.json({
      name: query,
      display_name: place.display_name,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      suggested_type: suggestion.type,
      suggested_radius: suggestion.radius,
      confidence: suggestion.confidence,
      source: "openstreetmap",
      osm_class: place.class || null,
      osm_type: place.type || null,
      raw: place,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Place search failed" },
      { status: 500 }
    );
  }
}
