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

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaStrat/1.0 contact@navabloom.co",
      },
    });

    const data = await response.json();

    const address = data.address || {};

    const readable =
      address.city ||
      address.town ||
      address.village ||
      address.county ||
      address.state ||
      data.display_name ||
      `${latitude}, ${longitude}`;

    return NextResponse.json({
      readable_location: readable,
      full_location: data.display_name || readable,
      raw: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Reverse geocoding failed" },
      { status: 500 }
    );
  }
}
