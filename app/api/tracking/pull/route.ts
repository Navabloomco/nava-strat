import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });

  // 1. Fetch trucks and their associated provider
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

  if (truckError) return NextResponse.json({ error: truckError.message }, { status: 500 });

  const results = [];

  for (const truck of trucks || []) {
    // FIX: Supabase joins return an array. We must grab the first item.
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

      // Handle different API list formats safely
      const list = Array.isArray(raw)
        ? raw
        : raw.data?.vehicles || raw.data || [];

      const mapping = provider.field_mapping || {};

      // DYNAMIC MAPPING: Find the vehicle using the key defined in your UI
      const vehicle = list.find(
        (v: any) => String(v[mapping.truck]) === String(truck.external_vehicle_id)
      );

      if (!vehicle) {
        console.warn(`Vehicle ${truck.reg_no} not found in provider data`);
        continue;
      }

      // INGESTION: Map the raw API fields to Nava's database schema
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
      console.error(`Tracking pull error for ${truck.reg_no}:`, err);
      results.push({ truck: truck.reg_no, status: "error", message: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, details: results });
}
