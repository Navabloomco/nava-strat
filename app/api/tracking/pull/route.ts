export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {

    // =========================
    // 1. GET PROVIDERS
    // =========================
    const { data: providers } = await supabase
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    // =========================
    // 2. GET TRUCKS
    // =========================
    const { data: trucks } = await supabase
      .from("trucks")
      .select("*");

    let inserted = [];

    for (const provider of providers || []) {

      // =========================
      // 3. LOGIN
      // =========================
      const loginResponse = await fetch(
        provider.login_url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            user_name: provider.username,
            key: provider.api_key
          }),
          cache: "no-store"
        }
      );

      const loginData = await loginResponse.json();

      if (!loginData.token) {
        continue;
      }

      // =========================
      // 4. FETCH FLEET
      // =========================
      const fleetResponse = await fetch(
        provider.fleet_url,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${loginData.token}`
          },
          cache: "no-store"
        }
      );

      const fleetData = await fleetResponse.json();

      const vehicles = Array.isArray(fleetData)
        ? fleetData
        : fleetData?.data || [];

      // =========================
      // 5. LOOP VEHICLES
      // =========================
      for (const vehicle of vehicles) {

        const reg = vehicle.reg_no?.trim();

        if (!reg) continue;

        // MATCH TRUCK
        const matchedTruck = trucks?.find(
          (t: any) =>
            t.external_vehicle_id?.trim() === reg
        );

        if (!matchedTruck) continue;

        // =========================
        // 6. INSERT TRACKING LOG
        // =========================
        const { error } = await supabase
          .from("tracking_logs")
          .insert({
            truck_id: matchedTruck.id,
            latitude: vehicle.latitude,
            longitude: vehicle.longitude,
            speed: vehicle.speed,
            fuel_level: vehicle.fuellevel || null,
            recorded_at: vehicle.fixtime
          });

        inserted.push({
          truck: reg,
          success: !error,
          error: error?.message || null
        });

      }

    }

    return Response.json({
      success: true,
      inserted_count: inserted.length,
      inserted
    });

  } catch (err: any) {

    return Response.json({
      success: false,
      error: err.message
    });

  }
}
