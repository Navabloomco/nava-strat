import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizeVehicle } from "@/lib/providers/normalizeVehicle";

// We use the Service Role Key here because this is a backend process 
// that needs to bypass Row Level Security to write logs.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { providerId } = await req.json();

    // 1. Fetch the Provider configuration from the Vault
    const { data: provider, error: pError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", providerId)
      .single();

    if (pError || !provider) throw new Error("Provider not found in Vault");

    // 2. Perform the Handshake (Login to Bluetrax)
    const loginRes = await fetch(provider.login_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: provider.username,
        password: provider.api_key, // In Bluetrax, api_key stores the password
      }),
    });

    const loginData = await loginRes.json();
    if (!loginData.token) throw new Error("Authentication failed: No token returned");

    // 3. Fetch Fleet Telemetry
    const fleetRes = await fetch(provider.fleet_url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${loginData.token}`
      },
    });

    const rawData = await fleetRes.json();

    // 4. Extract Vehicles using your Deterministic Path
    // It defaults to 'data' if the path isn't set yet.
    const vehiclePath = provider.fleet_config?.vehicle_paths?.[0] || "data";
    const vehicleArray = rawData[vehiclePath] || [];

    if (vehicleArray.length === 0) {
      return NextResponse.json({
        success: false,
        stage: "EXTRACTION",
        message: `Connected, but found 0 vehicles at path: '${vehiclePath}'`,
        debug: rawData
      });
    }

    // 5. Normalize and Persist (The "Memory" Phase)
    // We'll normalize the first truck found to verify the mapping works.
    const sample_normalized = normalizeVehicle(
      vehicleArray[0],
      provider.field_mapping || {},
      provider.provider_name
    );

    // Write this specific ping to our new telemetry_logs table
    const { error: logError } = await supabaseAdmin
      .from("telemetry_logs")
      .insert({
        provider_id: provider.id,
        truck_id: sample_normalized.truck_id,
        latitude: sample_normalized.latitude,
        longitude: sample_normalized.longitude,
        speed: sample_normalized.speed,
        fuel_level: sample_normalized.fuel_level,
        recorded_at: sample_normalized.recorded_at || new Date().toISOString(),
        raw_payload: sample_normalized.raw,
        validation: sample_normalized.validation,
      });

    if (logError) throw new Error(`Logging failed: ${logError.message}`);

    // Update the provider status in the vault
    await supabaseAdmin
      .from("tracking_providers")
      .update({ 
        last_test_status: "success", 
        last_test_at: new Date().toISOString() 
      })
      .eq("id", providerId);

    return NextResponse.json({
      success: true,
      message: `Connected. Found ${vehicleArray.length} vehicles. Logged ${sample_normalized.truck_id}.`,
      sample_normalized,
      debug: rawData
    });

  } catch (err: any) {
    console.error("API Route Error:", err.message);
    return NextResponse.json({ 
      success: false, 
      message: err.message,
      stage: "RUNTIME"
    }, { status: 500 });
  }
}
