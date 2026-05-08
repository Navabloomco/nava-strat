import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ProviderRecord = {
  id: string;
  provider_name: string;
  auth_type: string | null;
  login_url: string | null;
  fleet_url: string | null;
  username: string | null;
  api_key: string | null;
  password: string | null;
  bearer_token: string | null;
  auth_config?: any;
  fleet_config?: any;
};

export async function POST(req: Request) {
  try {
    const { providerId } = await req.json();

    if (!providerId) {
      return NextResponse.json(
        { success: false, message: "providerId is required" },
        { status: 400 }
      );
    }

    const { data: provider, error } = await supabaseAdmin
      .from("tracking_providers")
      .select("*")
      .eq("id", providerId)
      .single();

    if (error || !provider) {
      return NextResponse.json(
        { success: false, message: "Provider not found" },
        { status: 404 }
      );
    }

    const startedAt = Date.now();
    const auth = await authenticateProvider(provider as ProviderRecord);

    if (!auth.success) {
      await updateStatus(provider.id, "failure", auth.message);
      return NextResponse.json({
        success: false,
        stage: "AUTH",
        provider: provider.provider_name,
        message: auth.message,
        debug: auth.debug || null,
      });
    }

    const fleet = await testFleet(provider as ProviderRecord, auth.token || null);
    const latencyMs = Date.now() - startedAt;

    if (!fleet.success) {
      await updateStatus(provider.id, "failure", fleet.message);
      return NextResponse.json({
        success: false,
        stage: "FLEET",
        provider: provider.provider_name,
        message: fleet.message,
        latency_ms: latencyMs,
        debug: fleet.debug || null,
      });
    }

    await updateStatus(
      provider.id,
      "success",
      `Connected. Found ${fleet.vehicleCount} vehicles. Latency ${latencyMs}ms.`
    );

    return NextResponse.json({
      success: true,
      provider: provider.provider_name,
      message: `Connected. Found ${fleet.vehicleCount} vehicles.`,
      vehicle_count: fleet.vehicleCount,
      latency_ms: latencyMs,
      sample_vehicle: fleet.sampleVehicle || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        stage: "SYSTEM",
        message: err.message || "Unknown provider test error",
      },
      { status: 500 }
    );
  }
}

async function authenticateProvider(provider: ProviderRecord) {
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.auth_config || {};

  if (authType === "NONE") return { success: true, token: null };

  if (authType === "BEARER") {
    const token = provider.bearer_token || provider.api_key;
    if (!token) return { success: false, message: "Bearer token missing" };
    return { success: true, token };
  }

  if (authType === "API_KEY") {
    if (!provider.api_key) return { success: false, message: "API key missing" };
    return { success: true, token: provider.api_key };
  }

  if (authType === "BASIC_AUTH") {
    if (!provider.username || !(provider.password || provider.api_key)) {
      return { success: false, message: "Basic auth credentials missing" };
    }
    const raw = `${provider.username}:${provider.password || provider.api_key}`;
    return { success: true, token: Buffer.from(raw).toString("base64") };
  }

  if (authType === "POST_LOGIN") {
    if (!provider.login_url) return { success: false, message: "Login URL missing" };

    const method = config.method || "POST";
    const headers = buildHeaders(config.headers || {}, provider, null);
    const payload = buildPayload(config.payload, provider);

    const response = await fetch(provider.login_url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await safeJson(response);
    const token = getByPaths(data, config.token_paths || defaultTokenPaths());

    if (!response.ok || !token) {
      return {
        success: false,
        message: extractProviderError(data) || `Login failed with HTTP ${response.status}`,
        debug: data,
      };
    }
    return { success: true, token, debug: data };
  }

  return { success: false, message: `Unsupported auth_type: ${authType}` };
}

async function testFleet(provider: ProviderRecord, token: string | null) {
  if (!provider.fleet_url) return { success: false, message: "Fleet URL missing" };

  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.fleet_config || {};
  const method = config.method || "POST";
  const headers = buildHeaders(config.headers || {}, provider, token);

  if (token) {
    if (authType === "API_KEY") {
      const apiKeyHeader = config.api_key_header || "x-api-key";
      headers[apiKeyHeader] = token;
    } else if (authType === "BASIC_AUTH") {
      headers["Authorization"] = `Basic ${token}`;
    } else {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const payload = buildPayload(config.payload, provider);
  const response = await fetch(provider.fleet_url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await safeJson(response);
  if (!response.ok) return { success: false, message: `Fleet API returned HTTP ${response.status}`, debug: data };

  const vehicles = getByPaths(data, config.vehicle_paths || defaultVehiclePaths());
  const vehicleArray = Array.isArray(vehicles) ? vehicles : [];

  return {
    success: true,
    vehicleCount: vehicleArray.length,
    sampleVehicle: vehicleArray[0] || null,
    debug: data,
  };
}

function buildPayload(template: any, provider: ProviderRecord) {
  if (!template) {
    return {
      user_name: provider.username,
      key: provider.api_key,
      username: provider.username,
      password: provider.password || provider.api_key,
      api_key: provider.api_key,
    };
  }
  const output: any = {};
  Object.keys(template).forEach((key) => {
    output[key] = resolveTemplateValue(template[key], provider, null);
  });
  return output;
}

function buildHeaders(template: any, provider: ProviderRecord, token: string | null) {
  const output: Record<string, string> = {};
  Object.keys(template).forEach((key) => {
    output[key] = String(resolveTemplateValue(template[key], provider, token));
  });
  return output;
}

function resolveTemplateValue(value: any, provider: ProviderRecord, token: string | null) {
  if (typeof value !== "string") return value;
  return value
    .replace("{{username}}", provider.username || "")
    .replace("{{api_key}}", provider.api_key || "")
    .replace("{{password}}", provider.password || "")
    .replace("{{bearer_token}}", provider.bearer_token || "")
    .replace("{{token}}", token || "");
}

async function safeJson(response: Response) {
  try { return await response.json(); } 
  catch { return { raw: "Non-JSON", status: response.status, statusText: response.statusText }; }
}

function getByPaths(data: any, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(data, path);
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function getByPath(obj: any, path: string) {
  if (path === "$") return obj;
  return path.split(".").reduce((current, part) => {
    if (current === undefined || current === null) return undefined;
    return current[part];
  }, obj);
}

function defaultTokenPaths() { return ["token", "access_token", "jwt", "bearer_token", "data.token", "result.token"]; }
function defaultVehiclePaths() { return ["$", "data", "result", "vehicles", "items"]; }

function extractProviderError(data: any) {
  if (!data) return null;
  if (Array.isArray(data.Error)) return data.Error.join(", ");
  return data.message || data.error || data.Error || null;
}

async function updateStatus(providerId: string, status: "success" | "failure", message: string) {
  await supabaseAdmin
    .from("tracking_providers")
    .update({
      last_test_status: status,
      last_test_message: message,
      last_test_at: new Date().toISOString(),
    })
    .eq("id", providerId);
}
