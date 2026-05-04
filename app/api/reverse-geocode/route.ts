import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { latitude, longitude } = await req.json();

    if (!latitude || !longitude) {
      return NextResponse.json(
        { error: "Latitude and longitude required" },
        { status: 400 }
      );
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0 contact@navabloom.co",
      },
    });

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

    return NextResponse.json({
      readable_location: readableLocation,
      area,
      city,
      region,
      country,
      full_location: data.display_name || readableLocation,
      raw: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Reverse geocoding failed" },
      { status: 500 }
    );
  }
}
