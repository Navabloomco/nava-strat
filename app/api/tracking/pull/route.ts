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
    // 1. GET ACTIVE PROVIDERS
    const { data: providers, error: providerError } = await supabase
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    if (providerError) return Response.json({ success: false, error: providerError.message });

    // 2. GET CURRENT KNOWN TRUCKS
    const { data: trucksData } = await supabase.from("trucks").select("*");
    let trucks = trucksData || [];

    let results: any[] = [];

    // 3. LOOP PROVIDERS (ISOLATION)
    for (const provider of providers || []) {
      let vehiclesProcessed = 0;
      
      try {
        const mapping = provider.field_mapping || {};

        // 4. UNIVERSAL LOGIN WITH JSON VALIDATION
        const loginResponse = await fetch(provider.login_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_name: provider.username, key: provider.api_key })
        });

        let loginData: any = {};
        try {
          loginData = await loginResponse.json();
        } catch {
          loginData = { error: "Invalid JSON from provider login" };
        }

        const token = loginData.token || loginData.access_token || loginData.data?.token || null;

        if (!token) {
          await supabase.from("tracking_sync_logs").insert({
            provider_id: provider.id,
            provider_name: provider.provider_name,
            status: "error",
            stage: "LOGIN",
            message: loginData.error || loginData.message || "No token received",
            vehicles_processed: 0
          });
          results.push({ provider: provider.provider_name, success: false, stage: "LOGIN", error: "Auth Failed" });
          continue;
        }

        // 5. FETCH LIVE FLEET WITH JSON VALIDATION
        const fleetResponse = await fetch(provider.fleet_url, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
          cache: "no-store"
        });

        let fleetData: any = {};
        try {
          fleetData = await fleetResponse.json();
        } catch {
          fleetData = { error: "Invalid JSON from fleet fetch" };
        }

        const vehicles = Array.isArray(fleetData) ? fleetData : fleetData?.data || [];

        // 6. PROCESS VEHICLES
        for (const vehicle of vehicles) {
          const reg = vehicle[mapping.truck]?.trim();
          
          // FIX 3: REQUIRED VALIDATION
          if (
            !reg || 
            !vehicle[mapping.latitude] || 
            !vehicle[mapping.longitude] || 
            !vehicle[mapping.recorded_at]
          ) {
            continue; 
          }

          // 7. MATCH OR AUTO-CREATE TRUCK
          let matchedTruck = trucks.find(t => t.external_vehicle_id?.trim() === reg);
          
          if (!matchedTruck) {
            const { data: newTruck } = await supabase
              .from("trucks")
              .insert({
                truck: reg,
                registration_number: reg,
                external_vehicle_id: reg,
                tracking_provider_id: provider.id,
                status: "active"
              })
              .select().single();
            
            if (newTruck) {
              matchedTruck = newTruck;
              // FIX 1: AVOID MEMORY MUTATION
              trucks = [...trucks, newTruck];
            }
          }

          if (matchedTruck) {
            // 8. UPSERT LOG
            await supabase.from("tracking_logs").upsert({
              truck_id: matchedTruck.id,
              latitude: vehicle[mapping.latitude],
              longitude: vehicle[mapping.longitude],
              speed: vehicle[mapping.speed],
              fuel_level: vehicle[mapping.fuel_level] || null,
              recorded_at: vehicle[mapping.recorded_at]
            }, { onConflict: "truck_id,recorded_at" });

            vehiclesProcessed++;
          }
        }

        // 9. LOG SUCCESSFUL SYNC
        await supabase.from("tracking_sync_logs").insert({
          provider_id: provider.id,
          provider_name: provider.provider_name,
          status: "success",
          stage: "COMPLETED",
          message: `Successfully processed ${vehiclesProcessed} vehicles`,
          vehicles_processed: vehiclesProcessed
        });

        results.push({ provider: provider.provider_name, success: true, processed: vehiclesProcessed });

      } catch (err: any) {
        await supabase.from("tracking_sync_logs").insert({
          provider_id: provider.id,
          provider_name: provider.provider_name,
          status: "error",
          stage: "SYSTEM",
          message: err.message,
          vehicles_processed: vehiclesProcessed
        });
        results.push({ provider: provider.provider_name, success: false, error: err.message });
      }
    }

    return Response.json({ success: true, results });
  } catch (err: any) {
    return Response.json({ success: false, error: err.message });
  }
}
