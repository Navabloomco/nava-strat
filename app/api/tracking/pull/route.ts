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
    // ============================================
    // 1. GET ACTIVE PROVIDERS
    // ============================================
    const { data: providers, error: providerError } = await supabase
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    if (providerError) {
      return Response.json({
        success: false,
        error: providerError.message
      });
    }

    // ============================================
    // 2. GET TRUCKS
    // ============================================
    const { data: trucks, error: truckError } = await supabase
      .from("trucks")
      .select("*");

    if (truckError) {
      return Response.json({
        success: false,
        error: truckError.message
      });
    }

    let inserted: any[] = [];

    // ============================================
    // 3. LOOP PROVIDERS
    // ============================================
    for (const provider of providers || []) {
      try {
        // ============================================
        // 4. LOGIN TO PROVIDER
        // ============================================
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
          inserted.push({
            provider: provider.provider_name,
            success: false,
            stage: "LOGIN",
            error: "No token received"
          });
          continue;
        }

        // ============================================
        // 5. FETCH LIVE FLEET
        // ============================================
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

        // ============================================
        // 6. PROCESS VEHICLES
        // ============================================
        for (const vehicle of vehicles) {
          const reg = vehicle.reg_no?.trim();
          if (!reg) continue;

          // ============================================
          // 7. MATCH TRUCK
          // ============================================
          const matchedTruck = trucks?.find(
            (t: any) => t.external_vehicle_id?.trim() === reg
          );

          if (!matchedTruck) {
            inserted.push({
              truck: reg,
              success: false,
              stage: "MATCHING",
              error: "Truck not found"
            });
            continue;
          }

          // ============================================
          // 8. UPSERT TRACKING LOG
          // ============================================
          const { error } = await supabase
            .from("tracking_logs")
            .upsert({
              truck_id: matchedTruck.id,
              latitude: vehicle.latitude,
              longitude: vehicle.longitude,
              speed: vehicle.speed,
              fuel_level: vehicle.fuellevel || null,
              recorded_at: vehicle.fixtime
            }, {
              onConflict: "truck_id,recorded_at"
            });

          // ============================================
          // 9. UPDATED LOW FUEL ALERT LOGIC
          // ============================================
          if (
            vehicle.fuellevel !== undefined &&
            vehicle.fuellevel !== null &&
            Number(vehicle.fuellevel) < 100 // Using your specified threshold
          ) {
            const { data: alertData, error: alertError } = await supabase
              .from("tracking_alerts")
              .insert({
                truck_id: matchedTruck.id,
                alert_type: "low_fuel",
                severity: "high",
                title: "Low Fuel Level",
                description: `Fuel level dropped below threshold for ${vehicle.reg_no}`,
                metadata: {
                  fuel_level: vehicle.fuellevel,
                  latitude: vehicle.latitude,
                  longitude: vehicle.longitude
                },
                status: "active"
              })
              .select();

            console.log("ALERT INSERT RESULT:", {
              alertData,
              alertError
            });
          }

          inserted.push({
            truck: reg,
            success: !error,
            error: error?.message || null
          });
        }
      } catch (providerError: any) {
        inserted.push({
          provider: provider.provider_name,
          success: false,
          stage: "PROVIDER",
          error: providerError.message
        });
      }
    }

    // ============================================
    // 10. RETURN RESULTS
    // ============================================
    return Response.json({
      success: true,
      inserted_count: inserted.filter((i) => i.success).length,
      inserted
    });

  } catch (err: any) {
    return Response.json({
      success: false,
      error: err.message
    });
  }
}
