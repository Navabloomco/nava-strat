import { NextResponse } from "next/server";

function suggestRadius(placeName: string, typeGuess: string) {
  const text = `${placeName} ${typeGuess}`.toLowerCase();

  if (text.includes("shell") || text.includes("total") || text.includes("rubis") || text.includes("station")) {
    return { type: "fuel", radius: 150, confidence: "high" };
  }

  if (text.includes("border") || text.includes("malaba") || text.includes("busia")) {
    return { type: "border", radius: 1500, confidence: "medium" };
  }

  if (text.includes("yard") || text.includes("depot") || text.includes("garage")) {
    return { type: "yard", radius: 500, confidence: "medium" };
  }

  if (text.includes("port") || text.includes("mombasa port")) {
    return { type: "depot", radius: 1200, confidence: "medium" };
  }

  return { type: "client", radius: 300, confidence: "medium" };
}

export async function POST(req: Request) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json(
        { error: "Search query required" },
        { status: 400 }
      );
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=1&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0 contact@navabloom.co",
      },
    });

    const results = await response.json();

    if (!results || results.length === 0) {
      return NextResponse.json(
        { error: "No location found" },
        { status: 404 }
      );
    }

    const place = results[0];
    const suggestion = suggestRadius(query, place.type || place.class || "");

    return NextResponse.json({
      name: query,
      display_name: place.display_name,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      suggested_type: suggestion.type,
      suggested_radius: suggestion.radius,
      confidence: suggestion.confidence,
      source: "openstreetmap",
      raw: place,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Place search failed" },
      { status: 500 }
    );
  }
}
