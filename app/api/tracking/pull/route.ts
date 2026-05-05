export const dynamic = "force-dynamic";

import { supabase } from "../../../../lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  console.log("🚀 RUNNING PULL");

  const { data: trucks, error } = await supabase
    .from("trucks")
    .select(`
      id,
      external_vehicle_id,
      tracking_providers (
        fleet_url,
        api_key,
        field_mapping
      )
    `);

  console.log("🚚 TRUCKS:", trucks);

  if (error) {
    console.error("❌ DB ERROR:", error);
    return NextResponse.json({ error: error.message });
  }

  const results = [];

  for (const truck of trucks || []) {
    console.log("➡️ TRUCK:", truck);

    const provider = Array.isArray(truck.tracking_providers)
      ? truck.tracking_providers[0]
      : truck.tracking_providers;

    if (!provider) {
      console.log("❌ NO PROVIDER");
      continue;
    }

    try {
      const res = await fetch(provider.fleet_url, {
        headers: {
          Authorization: provider.api_key || "",
        },
      });

      const raw = await res.json();
      console.log("📦 RAW:", raw);

      const list = Array.isArray(raw)
        ? raw
        : raw.data || [];

      console.log("🚛 VEHICLES:", list.length);

      const mapping = provider.field_mapping;

      const vehicle = list.find(
        (v: any) =>
          String(v[mapping.truck]).toLowerCase().replace(/\s/g, "") ===
          String(truck.external_vehicle_id).toLowerCase().replace(/\s/g, "")
      );

      console.log("🔍 MATCH:", vehicle);

      if (!vehicle) continue;

      await supabase.from("tracking_logs").insert({
        truck_id: truck.id,
        latitude: vehicle[mapping.latitude],
        longitude: vehicle[mapping.longitude],
        speed: vehicle[mapping.speed] || 0,
        fuel_level: vehicle[mapping.fuel_level] || null,
        recorded_at: vehicle[mapping.recorded_at] || new Date().toISOString(),
      });

      results.push({ truck: truck.external_vehicle_id, status: "success" });

    } catch (err) {
      console.error("🔥 ERROR:", err);
    }
  }

  return NextResponse.json({
    success: true,
    processed: results.length,
    details: results,
  });
}
