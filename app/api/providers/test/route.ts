import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { normalizeVehicle } from "../../../../lib/providers/normalizeVehicle";

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
  field_mapping?: any;
};

type RuntimeResult = {
  success: boolean;
  token?: string | null;
  message?: string;
  debug?: any;
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
        {
          success: false,
          stage: "DATABASE",
          message: "Provider not found in database",
          debug: error,
        },
        { status: 404 }
      );
    }

    const startedAt = Date.now();

    const auth = await authenticateProvider(provider as ProviderRecord);

    if (!auth.success) {
      await updateStatus(provider.id, "failure", auth.message || "Auth failed");

      return NextResponse.json({
        success: false,
        stage: "AUTHENTICATION",
        provider: provider.provider_name,
        message: auth.message || "Authentication failed",
        debug: auth.debug || null,
      });
    }

    const fleet = await testFleet(provider as ProviderRecord, auth.token || null);
    const latencyMs = Date.now() - startedAt;

    if (!fleet.success) {
      await updateStatus(provider.id, "failure", fleet.message || "Fleet fetch failed");

      return NextResponse.json({
        success: false,
        stage: "FLEET",
        provider: provider.provider_name,
        message: fleet.message || "Fleet fetch failed",
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
      sample_normalized: fleet.sample_normalized || null,
      debug: fleet.debug || null,
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

async function authenticateProvider(
  provider: ProviderRecord
): Promise<RuntimeResult> {
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.auth_config || {};

  if (authType === "NONE") {
    return { success: true, token: null };
  }

  if (authType === "BEARER") {
    const token = provider.bearer_token || provider.api_key;

    if (!token) {
      return {
        success: false,
        message: "Bearer token missing",
      };
    }

    return {
      success: true,
      token,
    };
  }

  if (authType === "API_KEY") {
    if (!provider.api_key) {
      return {
        success: false,
        message: "API key missing",
      };
    }

    return {
      success: true,
      token: provider.api_key,
    };
  }

  if (authType === "BASIC_AUTH") {
    if (!provider.username || !(provider.password || provider.api_key)) {
      return {
        success: false,
        message: "Basic auth credentials missing",
      };
    }

    const raw = `${provider.username}:${provider.password || provider.api_key}`;
    const token = Buffer.from(raw).toString("base64");

    return {
      success: true,
      token,
    };
  }

  if (authType === "POST_LOGIN") {
    if (!provider.login_url) {
      return {
        success: false,
        message: "Login URL missing",
      };
    }

    const method = String(config.method || "POST").toUpperCase();

    const payloadTemplate =
      config.payload && typeof config.payload === "object"
        ? config.payload
        : {
            user_name: "{{username}}",
            key: "{{api_key}}",
          };

    const payload = buildPayload(payloadTemplate, provider);

    const headers = buildHeaders(config.headers || {}, provider, null);

    const response = await fetch(provider.login_url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: method === "GET" ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await safeJson(response);

    const tokenPaths =
      Array.isArray(config.token_paths) && config.token_paths.length > 0
        ? config.token_paths
        : defaultTokenPaths();

    const token = getByPaths(data, tokenPaths);

    if (!response.ok || !token) {
      return {
        success: false,
        message: "No token returned",
        debug: {
          status: response.status,
          statusText: response.statusText,
          auth_type: authType,
          login_url: provider.login_url,
          payload_sent: maskPayload(payload),
          token_paths_checked: tokenPaths,
          auth_response: data,
        },
      };
    }

    return {
      success: true,
      token,
      debug: data,
    };
  }

  return {
    success: false,
    message: `Unsupported auth_type: ${authType}`,
  };
}

async function testFleet(provider: ProviderRecord, token: string | null) {
  if (!provider.fleet_url) {
    return {
      success: false,
      message: "Fleet URL missing",
    };
  }

  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.fleet_config || {};
  const method = String(config.method || "POST").toUpperCase();

  const headers = buildHeaders(config.headers || {}, provider, token);

  if (token) {
    if (authType === "API_KEY") {
      headers[config.api_key_header || "x-api-key"] = token;
    } else if (authType === "BASIC_AUTH") {
      headers.Authorization = `Basic ${token}`;
    } else {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const payload = buildPayload(config.payload || {}, provider);

  const response = await fetch(provider.fleet_url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: method === "GET" ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await safeJson(response);

  if (!response.ok) {
    return {
      success: false,
      message: `Fleet API returned HTTP ${response.status}`,
      debug: {
        status: response.status,
        statusText: response.statusText,
        fleet_response: data,
      },
    };
  }

  const vehiclePaths =
    Array.isArray(config.vehicle_paths) && config.vehicle_paths.length > 0
      ? config.vehicle_paths
      : defaultVehiclePaths();

  const vehicles = getByPaths(data, vehiclePaths);
  const vehicleArray = Array.isArray(vehicles) ? vehicles : [];

  let sample_normalized = null;

  if (vehicleArray.length > 0) {
    sample_normalized = normalizeVehicle(
      vehicleArray[0],
      provider.field_mapping || {},
      provider.provider_name
    );

    await supabaseAdmin.from("telemetry_logs").insert({
      provider_id: provider.id,
      truck_id: sample_normalized.truck_id,
      latitude: sample_normalized.latitude,
      longitude: sample_normalized.longitude,
      speed: sample_normalized.speed,
      fuel_level: sample_normalized.fuel_level,
      recorded_at: sample_normalized.recorded_at,
      raw_payload: sample_normalized.raw,
      validation: sample_normalized.validation,
    });
  }

  return {
    success: true,
    vehicleCount: vehicleArray.length,
    sample_normalized,
    debug: {
      vehicle_paths_checked: vehiclePaths,
      fleet_response: data,
    },
  };
}

/* ----------------------------- */
/* Helper Utilities */
/* ----------------------------- */

function buildPayload(template: any, provider: ProviderRecord) {
  const output: any = {};

  if (!template || typeof template !== "object") {
    return output;
  }

  Object.keys(template).forEach((key) => {
    output[key] = resolveTemplateValue(template[key], provider, null);
  });

  return output;
}

function buildHeaders(
  template: any,
  provider: ProviderRecord,
  token: string | null
) {
  const output: Record<string, string> = {};

  if (!template || typeof template !== "object") {
    return output;
  }

  Object.keys(template).forEach((key) => {
    output[key] = String(resolveTemplateValue(template[key], provider, token));
  });

  return output;
}

function resolveTemplateValue(
  value: any,
  provider: ProviderRecord,
  token: string | null
) {
  if (typeof value !== "string") return value;

  return value
    .replaceAll("{{username}}", provider.username || "")
    .replaceAll("{{api_key}}", provider.api_key || "")
    .replaceAll("{{password}}", provider.password || "")
    .replaceAll("{{bearer_token}}", provider.bearer_token || "")
    .replaceAll("{{token}}", token || "");
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {
      raw: "Non-JSON response",
      status: response.status,
      statusText: response.statusText,
    };
  }
}

function getByPaths(data: any, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(data, path);

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function getByPath(obj: any, path: string) {
  if (path === "$") return obj;

  return path.split(".").reduce((current, part) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    return current[part];
  }, obj);
}

function defaultTokenPaths() {
  return [
    "token",
    "access_token",
    "jwt",
    "bearer_token",
    "data.token",
    "data.access_token",
    "result.token",
    "result.access_token",
  ];
}

function defaultVehiclePaths() {
  return [
    "$",
    "data",
    "result",
    "vehicles",
    "items",
    "data.vehicles",
    "data.items",
    "result.vehicles",
    "result.items",
  ];
}

function extractProviderError(data: any) {
  if (!data) return null;

  if (Array.isArray(data.Error)) return data.Error.join(", ");
  if (Array.isArray(data.errors)) return data.errors.join(", ");

  return data.message || data.error || data.Error || data.statusMessage || null;
}

function maskPayload(payload: any) {
  const masked = { ...payload };

  if (masked.key) masked.key = "***MASKED***";
  if (masked.api_key) masked.api_key = "***MASKED***";
  if (masked.password) masked.password = "***MASKED***";
  if (masked.token) masked.token = "***MASKED***";

  return masked;
}

async function updateStatus(
  providerId: string,
  status: string,
  message: string
) {
  await supabaseAdmin
    .from("tracking_providers")
    .update({
      last_test_status: status,
      last_test_message: message,
      last_test_at: new Date().toISOString(),
    })
    .eq("id", providerId);
}
