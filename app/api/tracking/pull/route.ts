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
      return Response.json({ success: false, error: providerError.message });
    }

    // ============================================
    // 2. GET TRUCKS
    // ============================================
    const { data: trucks, error: truckError } = await supabase
      .from("trucks")
      .select("*");

    if (truckError) {
      return Response.json({ success: false, error: truckError.message });
    }

    let inserted: any[] = [];

    // ============================================
    // 3. LOOP PROVIDERS
    // ============================================
    for (const provider of providers || []) {
      try {
        // Fetch Mapping for this specific provider
        const mapping = provider.field_mapping || {};

        // ============================================
        // 4. UNIVERSAL LOGIN HANDSHAKE
        // ============================================
        const loginResponse = await fetch(provider.login_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_name: provider.username,
            key: provider.api_key
          })
        });

        const loginData = await loginResponse.json();
        const token = loginData.token || loginData.access_token || loginData.data?.token || null;

        if (!token) {
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
        const fleetResponse = await fetch(provider.fleet_url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store"
        });

        const fleetData = await fleetResponse.json();
        const vehicles = Array.isArray(fleetData) ? fleetData : fleetData?.data || [];

        // ============================================
        // 6. PROCESS VEHICLES (TRUE UNIVERSALITY)
        // ============================================
        for (const vehicle of vehicles) {
          // Dynamic Mapping applied here
          const reg = vehicle[mapping.truck]?.trim();
          if (!reg) continue;

          // ============================================
          // 7. MATCH TRUCK
          // ============================================
          const matchedTruck = trucks?.find(
            (t: any) => t.external_vehicle_id?.trim() === reg
          );

          if (!matchedTruck) {
            inserted.push({ truck: reg, success: false, stage: "MATCHING", error: "Not found" });
            continue;
          }

          // ============================================
          // 8. UPSERT TRACKING LOG
          // ============================================
          const { error: upsertError } = await supabase
            .from("tracking_logs")
            .upsert({
              truck_id: matchedTruck.id,
              latitude: vehicle[mapping.latitude],
              longitude: vehicle[mapping.longitude],
              speed: vehicle[mapping.speed],
              fuel_level: vehicle[mapping.fuel_level] || null,
              recorded_at: vehicle[mapping.recorded_at]
            }, {
              onConflict: "truck_id,recorded_at"
            });

          // =========================================
          // 9. SMART AGNOSTIC ALERT ENGINE
          // =========================================
          const currentFuel = vehicle[mapping.fuel_level] !== undefined ? Number(vehicle[mapping.fuel_level]) : null;
          const currentSpeed = vehicle[mapping.speed] !== undefined ? Number(vehicle[mapping.speed]) : 0;

          if (currentFuel !== null) {
            
            // -------------------------------------
            // LOW FUEL ALERT (Cooldown: 6 Hours)
            // -------------------------------------
            if (currentFuel < 20) {
              const { data: existingAlert } = await supabase
                .from("tracking_alerts")
                .select("id")
                .eq("truck_id", matchedTruck.id)
                .eq("alert_type", "low_fuel")
                .gte("created_at", new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString())
                .limit(1)
                .single();

              if (!existingAlert) {
                let severity = "medium";
                if (currentFuel < 10) severity = "critical";
                else if (currentFuel < 15) severity = "high";

                await supabase.from("tracking_alerts").insert({
                  truck_id: matchedTruck.id,
                  alert_type: "low_fuel",
                  severity,
                  title: "Low Fuel Alert",
                  description: `${matchedTruck.truck || reg} fuel is at ${currentFuel}%`,
                  metadata: {
                    fuel_level: currentFuel,
                    location: { lat: vehicle[mapping.latitude], lng: vehicle[mapping.longitude] }
                  },
                  status: "active"
                });
              }
            }

            // -------------------------------------
            // FUEL THEFT DETECTION (Cooldown: 12 Hours)
            // -------------------------------------
            if (currentFuel < 10 && currentSpeed < 5) {
              const { data: theftAlert } = await supabase
                .from("tracking_alerts")
                .select("id")
                .eq("truck_id", matchedTruck.id)
                .eq("alert_type", "possible_fuel_theft")
                .gte("created_at", new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString())
                .limit(1)
                .single();

              if (!theftAlert) {
                await supabase.from("tracking_alerts").insert({
                  truck_id: matchedTruck.id,
                  alert_type: "possible_fuel_theft",
                  severity: "critical",
                  title: "Possible Fuel Theft",
                  description: `${matchedTruck.truck || reg} critical fuel drop while stationary`,
                  metadata: {
                    fuel_level: currentFuel,
                    speed: currentSpeed,
                    location: { lat: vehicle[mapping.latitude], lng: vehicle[mapping.longitude] }
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
          stage: "PROVIDER_FAIL",
          error: providerError.message
        });
      }
    }

    return Response.json({
      success: true,
      processed: inserted.length,
      inserted
    });

  } catch (err: any) {
    return Response.json({ success: false, error: err.message });
  }
}
