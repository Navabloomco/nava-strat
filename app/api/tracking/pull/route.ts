import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
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
    `);

  if (truckError) {
    console.error("DB ERROR:", truckError);
    return NextResponse.json({ error: truckError.message });
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

      // 🔥 PRINT DATA (VERY IMPORTANT)
      console.log("BLUETRAX RESPONSE:", JSON.stringify(raw).slice(0, 500));

      const list = Array.isArray(raw)
        ? raw
        : raw.data?.vehicles || raw.data || [];

      const mapping = provider.field_mapping || {};

      // 🔥 SMART MATCH (fix your problem)
      const normalize = (v: any) =>
        String(v || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

      const vehicle = list.find(
        (v: any) =>
          normalize(v[mapping.truck]) ===
          normalize(truck.external_vehicle_id)
      );

      if (!vehicle) {
        console.warn("NO MATCH FOUND FOR:", truck.external_vehicle_id);
        continue;
      }

      await supabase.from("tracking_logs").insert({
        truck_id: truck.id,
        latitude: vehicle[mapping.latitude],
        longitude: vehicle[mapping.longitude],
        speed: vehicle[mapping.speed] || 0,
        fuel_level: vehicle[mapping.fuel_level] || null,
        recorded_at:
          vehicle[mapping.recorded_at] || new Date().toISOString(),
      });

      results.push({ truck: truck.truck, status: "success" });

    } catch (err) {
      console.error("ERROR:", err);
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    details: results,
  });
}
