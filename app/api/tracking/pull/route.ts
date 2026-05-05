import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

export async function GET() {
  const { data: trucks } = await supabase
    .from("trucks")
    .select(`
      id,
      registration,
      external_vehicle_id,
      tracking_providers (*)
    `)
    .not("tracking_provider_id", "is", null);

  for (const truck of trucks || []) {
    const provider = truck.tracking_providers;

    if (!provider || !provider.fleet_url) continue;

    try {
      const res = await fetch(provider.fleet_url, {
        headers: {
          Authorization: provider.api_key || "",
        },
      });

      const data = await res.json();

      // 🔥 VERY SIMPLE MATCH (improve later)
      const vehicle = data.find(
        (v: any) => v.reg_no === truck.external_vehicle_id
      );

      if (!vehicle) continue;

      await supabase.from("tracking_logs").insert({
        truck_id: truck.id,
        latitude: vehicle.lat,
        longitude: vehicle.lng,
        speed: vehicle.speed || 0,
        recorded_at: new Date(),
      });

    } catch (err) {
      console.error("Tracking pull error", err);
    }
  }

  return NextResponse.json({ success: true });
}
