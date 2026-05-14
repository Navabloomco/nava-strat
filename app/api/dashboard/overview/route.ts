// app/api/dashboard/overview/route.ts
import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { getCurrentCompany } from "../../../../lib/auth/getCurrentCompany";
import { getFleetHealth } from "../../../../lib/intelligence/fleetHealthService";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { reverseGeocode } from "../../../../lib/location/reverseGeocode";

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const company = await getCurrentCompany(user.id);
    const fleetHealth = await getFleetHealth(company.id);

    // Active memories
    const { data: memories } = await supabaseAdmin
      .from("nava_eye_memory")
      .select("*")
      .eq("company_id", company.id)
      .eq("status", "active")
      .order("last_seen_at", { ascending: false })
      .limit(10);

    // Real Uganda detection using reverse geocode on latest telemetry
    const { data: latestTelemetry } = await supabaseAdmin
      .from("telemetry_logs")
      .select("truck_id, latitude, longitude")
      .eq("company_id", company.id)
      .order("recorded_at", { ascending: false })
      .limit(100); // enough to cover active trucks

    const ugandaTrucks = [];
    const processed = new Set();
    for (const point of latestTelemetry || []) {
      if (processed.has(point.truck_id)) continue;
      processed.add(point.truck_id);
      if (point.latitude && point.longitude) {
        const loc = await reverseGeocode(point.latitude, point.longitude);
        if (loc?.country?.toLowerCase() === "uganda") {
          ugandaTrucks.push({ truck_id: point.truck_id, location: loc.town || loc.display_name || "Uganda" });
        }
      }
    }

    return NextResponse.json({
      success: true,
      company: { id: company.id, name: company.name },
      fleet_health: fleetHealth,
      active_memories: memories || [],
      trucks_in_uganda: ugandaTrucks,
    });
  } catch (err: any) {
    console.error("Dashboard overview error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
