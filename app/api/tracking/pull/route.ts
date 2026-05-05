import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  // 1. Fetch trucks and their associated provider mapping
  const { data: trucks, error: truckError } = await supabase
    .from("trucks")
    .select(`
      id, 
      reg_no, 
      external_vehicle_id, 
      tracking_providers (
        fleet_url, 
        api_key, 
        field_mapping
      )
    `);

  if (truckError) {
    console.error("Database Fetch Error:", truckError);
    return NextResponse.json({ error: truckError.message }, { status: 500 });
  }

  const results = [];

  for (const truck of trucks || []) {
    // FIX: Safely handle Supabase relational array return
    const provider = Array.isArray(truck.tracking_providers)
      ? truck.tracking_providers[0]
      : truck.tracking_providers;

    // Safety check for provider configuration
    if (!provider || !provider.fleet_url) continue;

    try {
      const res = await fetch(provider.fleet_url, {
        headers: {
          Authorization: provider.api_key || "",
        },
        cache: "no-store", // Prevents stale data caching
      });

      const raw = await res.json();

      // Normalize API structures: Handles arrays or nested 'data' objects
      const list = Array.isArray(raw)
        ? raw
        : raw.data?.vehicles || raw.data || [];

      // Fallback mapping to prevent crashes
      const mapping = provider.field_mapping || {
        truck: "reg_no",
        latitude: "lat",
        longitude: "lng",
        speed: "speed",
        fuel_level: "fuel_level",
        recorded_at: "time",
      };

      // DYNAMIC MAPPING: Find the vehicle by its external ID
      const vehicle = list.find(
        (v: any) => String(v[mapping.truck]) === String(truck.external_vehicle_id)
      );

      // Validate vehicle data exists and contains coordinates
      if (!vehicle || !vehicle[mapping.latitude] || !vehicle[mapping.longitude]) {
        console.warn(`Skipping ${truck.reg_no}: Missing data or coordinates.`);
        continue;
      }

      // INGESTION: Dynamic mapping into our standard tracking_logs schema
      const { error: logError } = await supabase.from("tracking_logs").insert({
        truck_id: truck.id,
        latitude: vehicle[mapping.latitude],
        longitude: vehicle[mapping.longitude],
        speed: vehicle[mapping.speed] || 0,
        fuel_level: vehicle[mapping.fuel_level] || null,
        recorded_at: vehicle[mapping.recorded_at] || new Date().toISOString(),
      });

      if (logError) throw logError;
      results.push({ truck: truck.reg_no, status: "success" });

    } catch (err) {
      console.error(`Ingestion failure for ${truck.reg_no}:`, err);
      results.push({ truck: truck.reg_no, status: "error", message: String(err) });
    }
  }

  return NextResponse.json({ 
    success: true, 
    processed: results.length, 
    details: results 
  });
}
