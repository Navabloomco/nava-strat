import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data: trucks } = await supabase
      .from("trucks")
      .select("*")

    let results: any[] = []

    for (const truck of trucks || []) {
      if (!truck.tracking_provider_id || !truck.external_vehicle_id) continue

      const { data: provider } = await supabase
        .from("tracking_providers")
        .select("*")
        .eq("id", truck.tracking_provider_id)
        .single()

      if (!provider) continue

      // 🔥 STEP 1: LOGIN → GET TOKEN
      const loginRes = await fetch(
        "https://public-api.bluetrax.co.ke/api/Login/Login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_name: provider.username,
            key: provider.api_key,
          }),
        }
      )

      const loginData = await loginRes.json()

      if (!loginData.token) {
        console.log("❌ LOGIN FAILED:", loginData)
        continue
      }

      const token = loginData.token

      // 🔥 STEP 2: FETCH FLEET WITH TOKEN
      const fleetRes = await fetch(
        "https://public-api.bluetrax.co.ke/api/Public/fleet_current_locations",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        }
      )

      const fleetData = await fleetRes.json()

      console.log("🔥 BLUETRAX RAW:", JSON.stringify(fleetData, null, 2))

      const vehicles = fleetData?.data || fleetData || []

      const normalize = (val: string) =>
        val?.toLowerCase().replace(/\s+/g, "")

      const match = vehicles.find(
        (v: any) =>
          normalize(v.reg_no) === normalize(truck.external_vehicle_id)
      )

      if (!match) {
        console.log("❌ No match:", truck.external_vehicle_id)
        continue
      }

      console.log("✅ MATCH:", match)

      await supabase.from("tracking_points").insert({
        truck_id: truck.id,
        latitude: match.lat,
        longitude: match.lng,
        speed: match.speed,
        recorded_at: match.fixtime,
      })

      results.push(match)
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      details: results,
    })
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    })
  }
}
