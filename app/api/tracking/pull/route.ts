import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

function normalize(val: any) {
  return String(val || "")
    .replace(/\s+/g, "") // remove spaces
    .toUpperCase();      // make uppercase
}

export async function GET() {
  // 1. Fetch trucks + provider
  const { data: trucks, error: truckError } = await supabase
    .from("trucks")
    .select(`
      id,
      truck,
      external_vehicle_id,
      tracking_providers (
        fleet_url,
        api_key,
        field_mapping
      )
    `)
    .not("tracking_provider_id", "is", null);

  if (truckError) {
    console.error("DB ERROR:", truckError);
    return NextResponse.json({ error: truckError.message }, { status: 500 });
  }

  const results = [];

  for (const truck of trucks || []) {
    // ⚠️ Supabase returns array for joins
    const provider = Array.isArray(truck.tracking_providers)
      ? truck.tracking_providers[0]
      : truck.tracking_providers;

    if (!provider || !provider.fleet_url) {
      console.warn(`Skipping ${truck.truck}: No provider`);
      continue;
    }

    try {
      // 2. Fetch provider data
      const res = await fetch(provider.fleet_url, {
        headers: {
          Authorization: provider.api_key || "",
        },
      });

      const raw = await res.json();

      // 3. Normalize response structure
      const list = Array.isArray(raw)
        ? raw
        : raw.data?.vehicles || raw.data || [];

      const mapping = provider.field_mapping || {
        truck: "reg_no",
        latitude: "lat",
        longitude: "lng",
        speed: "speed",
        fuel_level: "fuel_level",
        recorded_at: "time",
      };

      // 🔥 KEY FIX: smart matching (spaces + casing)
      const vehicle = list.find(
        (v: any) =>
          normalize(v[mapping.truck]) ===
          normalize(truck.external_vehicle_id)
      );

      if (!vehicle) {
        console.warn(`❌ No match for ${truck.truck}`);
        continue;
      }

      // 4. Insert tracking log
      const { error: logError } = await supabase
        .from("tracking_logs")
        .insert({
          truck_id: truck.id,
          latitude: vehicle[mapping.latitude],
          longitude: vehicle[mapping.longitude],
          speed: vehicle[mapping.speed] || 0,
          fuel_level: vehicle[mapping.fuel_level] || null,
          recorded_at:
            vehicle[mapping.recorded_at] ||
            new Date().toISOString(),
        });

      if (logError) throw logError;

      results.push({
        truck: truck.truck,
        status: "success",
      });

    } catch (err) {
      console.error(`🔥 ERROR for ${truck.truck}:`, err);
      results.push({
        truck: truck.truck,
        status: "error",
        message: String(err),
      });
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    details: results,
  });
}
