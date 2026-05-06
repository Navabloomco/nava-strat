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
        // 4. LOGIN HANDSHAKE (Universal)
        // ============================================
        const loginResponse = await fetch(provider.login_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            user_name: provider.username,
            key: provider.api_key
          })
        });

        const loginData = await loginResponse.json();

        console.log("PROVIDER LOGIN RESPONSE:", loginData);

        const token =
          loginData.token ||
          loginData.access_token ||
          loginData.data?.token ||
          null;

        if (!token) {
          inserted.push({
            provider: provider.provider_name,
            success: false,
            stage: "LOGIN",
            error: "No token received",
            raw_response: loginData
          });
          continue;
        }

        // ============================================
        // 5. FETCH LIVE FLEET
        // ============================================
        const fleetResponse = await fetch(provider.fleet_url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          },
          cache: "no-store"
        });

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
          // 8. UPSERT TRACKING LOG (Duplicate Prevention via onConflict)
          // ============================================
          const { error: upsertError } = await supabase
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

          // =========================================
          // 9. SMART LOW FUEL ALERT ENGINE
          // =========================================
          if (
            vehicle.fuellevel !== undefined &&
            vehicle.fuellevel !== null
          ) {
            const fuelLevel = Number(vehicle.fuellevel);

            // -------------------------------------
            // LOW FUEL ALERT
            // -------------------------------------
            if (fuelLevel < 20) {
              // CHECK FOR RECENT ALERT (6-hour window)
              const { data: existingAlert } = await supabase
                .from("tracking_alerts")
                .select("id, created_at")
                .eq("truck_id", matchedTruck.id)
                .eq("alert_type", "low_fuel")
                .gte(
                  "created_at",
                  new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString()
                )
                .limit(1)
                .single();

              // ONLY INSERT IF NO RECENT ALERT
              if (!existingAlert) {
                let severity = "medium";

                if (fuelLevel < 10) {
                  severity = "critical";
                } else if (fuelLevel < 15) {
                  severity = "high";
                }

                await supabase
                  .from("tracking_alerts")
                  .insert({
                    truck_id: matchedTruck.id,
                    alert_type: "low_fuel",
                    severity,
                    title: "Low Fuel Alert",
                    description: `${matchedTruck.truck || reg} fuel level is at ${fuelLevel}%`,
                    metadata: {
                      fuel_level: fuelLevel,
                      provider: provider.provider_name,
                      location: {
                        lat: vehicle.latitude,
                        lng: vehicle.longitude
                      }
                    },
                    status: "active"
                  });
              }
            }

            // -------------------------------------
            // CRITICAL FUEL THEFT DETECTION
            // -------------------------------------
            if (
              fuelLevel < 10 &&
              Number(vehicle.speed || 0) < 5
            ) {
              const { data: theftAlert } = await supabase
                .from("tracking_alerts")
                .select("id")
                .eq("truck_id", matchedTruck.id)
                .eq("alert_type", "possible_fuel_theft")
                .gte(
                  "created_at",
                  new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString()
                )
                .limit(1)
                .single();

              if (!theftAlert) {
                await supabase
                  .from("tracking_alerts")
                  .insert({
                    truck_id: matchedTruck.id,
                    alert_type: "possible_fuel_theft",
                    severity: "critical",
                    title: "Possible Fuel Theft",
                    description: `${matchedTruck.truck || reg} has critically low fuel while stationary`,
                    metadata: {
                      fuel_level: fuelLevel,
                      speed: vehicle.speed,
                      provider: provider.provider_name
                    },
                    status: "active"
                  });
              }
            }
          }

          inserted.push({
            truck: reg,
            success: !upsertError,
            error: upsertError?.message || null
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
