import { supabaseAdmin } from "../supabaseAdmin";

export type LocationInfo = {
  display_name: string;
  town?: string | null;
  county?: string | null;
  country?: string | null;
};

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<LocationInfo | null> {
  try {
    // ROUNDING = MASSIVE COST SAVER
    const roundedLat = Number(lat.toFixed(3));
    const roundedLng = Number(lng.toFixed(3));

    // CHECK CACHE FIRST
    const { data: cached } = await supabaseAdmin
      .from("location_cache")
      .select("*")
      .eq("rounded_lat", roundedLat)
      .eq("rounded_lng", roundedLng)
      .single();

    if (cached) {
      return {
        display_name: cached.display_name,
        town: cached.town,
        county: cached.county,
        country: cached.country,
      };
    }

    // CALL OPENSTREETMAP NOMINATIM
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=jsonv2` +
      `&lat=${lat}` +
      `&lon=${lng}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "NavaEye/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Reverse geocode failed: ${response.status}`
      );
    }

    const result = await response.json();

    const address = result.address || {};

    const locationData = {
      display_name:
        result.display_name || "Unknown Location",

      town:
        address.city ||
        address.town ||
        address.village ||
        address.suburb ||
        null,

      county:
        address.county ||
        address.state_district ||
        null,

      country:
        address.country || null,
    };

    // SAVE TO CACHE
    await supabaseAdmin
      .from("location_cache")
      .insert({
        latitude: lat,
        longitude: lng,

        rounded_lat: roundedLat,
        rounded_lng: roundedLng,

        display_name:
          locationData.display_name,

        town: locationData.town,
        county: locationData.county,
        country: locationData.country,

        raw_response: result,
      });

    return locationData;
  } catch (err) {
    console.error(
      "Reverse geocode failure:",
      err
    );

    return null;
  }
}
