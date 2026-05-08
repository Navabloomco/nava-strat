import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
// Correct relative path for Vercel deployment
import { normalizeVehicle } from "../../../../lib/providers/normalizeVehicle";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { providerId } = await req.json();

    const { data: provider, error: pError } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", providerId)
      .single();

    if (pError || !provider) throw new Error("Provider not found in Vault");

    // --- 1. LOGIN HANDSHAKE ---
    const loginRes = await fetch(provider.login_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: provider.username,
        password: provider.api_key, 
      }),
    });

    const loginData = await loginRes.json();
    
    // DEBUG LOG: This allows you to see the REAL token path in the console
    console.log("--- DEBUG: BLUETRAX LOGIN RESPONSE ---");
    console.log(JSON.stringify(loginData, null, 2));

    // Currently assuming 'token' is the key. 
    // If it's nested (e.g. loginData.data.token), we will see it in the log.
    const token = loginData.token || loginData.access_token || loginData.data?.token;

    if (!token) {
      return NextResponse.json({
        success: false,
        stage: "AUTHENTICATION",
        message: "No token returned. Check console for 'DEBUG: BLUETRAX LOGIN RESPONSE'.",
        debug: loginData
      });
    }

    // --- 2. FLEET FETCH ---
    const fleetRes = await fetch(provider.fleet_url, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
    });

    const rawData = await fleetRes.json();

    // --- 3. EXTRACTION (Deterministic) ---
    const vehiclePath = provider.fleet_config?.vehicle_paths?.[0] || "data";
    const vehicleArray = rawData[vehiclePath] || [];

    if (vehicleArray.length === 0) {
      return NextResponse.json({
        success: false,
        stage: "EXTRACTION",
        message: `Connected, but 0 vehicles at path: '${vehiclePath}'`,
        debug: rawData
      });
    }

    // --- 4. PERSISTENCE ---
    const sample_normalized = normalizeVehicle(
      vehicleArray[0],
      provider.field_mapping || {},
      provider.provider_name
    );

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

    return NextResponse.json({
      success: true,
      message: `Sync Successful. Logged ${sample_normalized.truck_id}.`,
      sample_normalized,
      debug: { login: loginData, fleet: rawData }
    });

  } catch (err: any) {
    return NextResponse.json({ 
      success: false, 
      message: err.message,
      stage: "RUNTIME_ERROR"
    }, { status: 500 });
  }
}
