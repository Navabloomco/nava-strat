import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// 🔑 ENV (make sure these exist in Vercel)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    // 1. Get trucks with providers
    const { data: trucks, error } = await supabase
      .from("trucks")
      .select("*")

    if (error) {
      return NextResponse.json({ error: error.message })
    }

    let results: any[] = []

    for (const truck of trucks || []) {
      // 🚨 skip if not linked
      if (!truck.tracking_provider_id || !truck.external_vehicle_id) {
        continue
      }

      // 2. Get provider
      const { data: provider } = await supabase
        .from("tracking_providers")
        .select("*")
        .eq("id", truck.tracking_provider_id)
        .single()

      if (!provider) continue

      // 3. Call Bluetrax API (POST!)
      const response = await fetch(provider.base_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": provider.api_key,
        },
      })

      const data = await response.json()

      console.log("🔥 BLUETRAX RAW:", JSON.stringify(data, null, 2))

      // 4. Extract vehicles array
      const vehicles = data?.data || data || []

      // normalize function
      const normalize = (val: string) =>
        val?.toLowerCase().replace(/\s+/g, "")

      // 5. Match truck
      const match = vehicles.find(
        (v: any) =>
          normalize(v.reg_no) === normalize(truck.external_vehicle_id)
      )

      if (!match) {
        console.log("❌ No match for:", truck.external_vehicle_id)
        continue
      }

      console.log("✅ MATCH FOUND:", match)

      // 6. Save tracking point
      const { error: insertError } = await supabase
        .from("tracking_points")
        .insert({
          truck_id: truck.id,
          latitude: match.lat,
          longitude: match.lng,
          speed: match.speed,
          recorded_at: match.fixtime,
        })

      if (insertError) {
        console.log("❌ Insert error:", insertError.message)
        continue
      }

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
