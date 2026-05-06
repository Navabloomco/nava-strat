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

    // =========================
    // 1. GET PROVIDERS
    // =========================
    const { data: providers, error } = await supabase
      .from("tracking_providers")
      .select("*")
      .eq("is_active", true);

    if (error) {
      return Response.json({
        success: false,
        error
      });
    }

    let output: any[] = [];

    // =========================
    // 2. LOOP PROVIDERS
    // =========================
    for (const provider of providers || []) {

      try {

        // =========================
        // 3. LOGIN
        // =========================
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

        // DEBUG
        console.log("LOGIN RESPONSE:", loginData);

        if (!loginData.token) {

          output.push({
            provider: provider.provider_name,
            status: "LOGIN_FAILED",
            response: loginData
          });

          continue;
        }

        // =========================
        // 4. FETCH FLEET
        // =========================
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

        // DEBUG
        console.log("FLEET DATA:", fleetData);

        output.push({
          provider: provider.provider_name,
          status: "SUCCESS",
          token_received: true,
          vehicles_found: Array.isArray(fleetData)
            ? fleetData.length
            : fleetData?.data?.length || 0,
          sample: Array.isArray(fleetData)
            ? fleetData[0]
            : fleetData?.data?.[0] || fleetData
        });

      } catch (providerError: any) {

        output.push({
          provider: provider.provider_name,
          status: "ERROR",
          message: providerError.message
        });

      }
    }

    // =========================
    // 5. RETURN
    // =========================
    return Response.json({
      success: true,
      providers_processed: providers?.length || 0,
      output,
      timestamp: new Date().toISOString()
    });

  } catch (err: any) {

    return Response.json({
      success: false,
      error: err.message
    });

  }
}
