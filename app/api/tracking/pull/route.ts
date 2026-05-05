import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  const { data: trucks, error } = await supabase
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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const truck of trucks || []) {
    const provider = Array.isArray(truck.tracking_providers)
      ? truck.tracking_providers[0]
      : truck.tracking_providers;

    if (!provider || !provider.fleet_url) continue;

    try {
      const res = await fetch(provider.fleet_url, {
        headers: {
          Authorization: provider.api_key || "",
        },
      });

      const raw = await res.json();

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

      const vehicle = list.find(
        (v: any) =>
          String(v[mapping.truck]) ===
          String(truck.external_vehicle_id)
      );

      if (!vehicle) {
        console.warn(`No match for ${truck.truck}`);
        continue;
      }

      await supabase.from("tracking_logs").insert({
        truck_id: truck.id,
        latitude: vehicle[mapping.latitude],
        longitude: vehicle[mapping.longitude],
        speed: vehicle[mapping.speed] || 0,
        fuel_level: vehicle[mapping.fuel_level] || null,
        recorded_at:
          vehicle[mapping.recorded_at] ||
          new Date().toISOString(),
      });

      results.push({ truck: truck.truck, status: "success" });

    } catch (err) {
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
