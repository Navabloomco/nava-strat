import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // =========================
    // 1. GET DATA FROM SUPABASE
    // =========================
    const { data: providers } = await supabase
      .from("tracking_providers")
      .select("*");

    const { data: trucks } = await supabase
      .from("trucks")
      .select("*");

    if (!providers?.length) {
      return Response.json({ error: "No providers found" });
    }

    let results: any[] = [];

    for (const provider of providers) {
      try {
        // =========================
        // 2. LOGIN TO BLUETRAX
        // =========================
        const loginRes = await fetch(
          "https://public-api.bluetrax.co.ke/api/Login/Login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_name: "japhy", // your username
              key: provider.api_key,
            }),
          }
        );

        const loginData = await loginRes.json();

        if (!loginData.token) {
          console.log("❌ LOGIN FAILED:", loginData);
          continue;
        }

        const token = loginData.token;

        // =========================
        // 3. FETCH FLEET
        // =========================
        const fleetRes = await fetch(
          "https://public-api.bluetrax.co.ke/api/Public/fleet_current_locations",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const fleetData = await fleetRes.json();

        // 🔥 CRITICAL DEBUG
        console.log("🔥 FULL RAW RESPONSE:", fleetData);

        const vehicles = Array.isArray(fleetData)
          ? fleetData
          : fleetData.data || [];

        // MORE DEBUG
        console.log(
          "🚛 VEHICLE SAMPLE:",
          vehicles[0]
        );
        console.log(
          "🧠 AVAILABLE KEYS:",
          Object.keys(vehicles[0] || {})
        );

        // =========================
        // 4. NORMALIZE FUNCTION
        // =========================
        const normalize = (val: string) =>
          val?.toLowerCase().replace(/\s+/g, "").trim();

        // =========================
        // 5. MATCH TRUCKS
        // =========================
        for (const truck of trucks || []) {
          if (!truck.external_vehicle_id) continue;

          const match = vehicles.find((v: any) => {
            const possibleFields = [
              v.reg_no,
              v["reg no"],
              v.Vehicle,
              v.vehicle,
              v.name,
            ];

            return possibleFields.some(
              (field) =>
                normalize(field) ===
                normalize(truck.external_vehicle_id)
            );
          });

          if (!match) continue;

          results.push({
            truck_id: truck.id,
            plate: truck.external_vehicle_id,
            matched_with: match,
            lat: match.lat,
            lng: match.lng,
            speed: match.speed,
          });
        }
      } catch (err) {
        console.error("Provider error:", err);
      }
    }

    // =========================
    // 6. RESPONSE
    // =========================
    return Response.json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (err) {
    return Response.json({ error: String(err) });
  }
}
