import { supabaseAdmin } from "../supabaseAdmin";
import { normalizeVehicle } from "./normalizeVehicle";

export type ProviderRecord = {
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

export type SyncResult = {
  success: boolean;
  message: string;
  vehicleCount: number;
  sample_normalized?: any;
  debug?: any;
};

type AuthResult = {
  success: boolean;
  token?: string | null;
  message?: string;
  debug?: any;
};

type FleetResult = {
  success: boolean;
  vehicles: any[];
  message?: string;
  debug?: any;
};

export async function runProviderSync(
  provider: ProviderRecord
): Promise<SyncResult> {
  try {
    const auth = await authenticateProvider(provider);

    if (!auth.success) {
      return {
        success: false,
        message: auth.message || "Provider authentication failed",
        vehicleCount: 0,
        debug: auth.debug || null,
      };
    }

    const fleet = await fetchFleet(provider, auth.token || null);

    if (!fleet.success) {
      return {
        success: false,
        message: fleet.message || "Fleet fetch failed",
        vehicleCount: 0,
        debug: fleet.debug || null,
      };
    }

    let sample_normalized = null;
    let syncedCount = 0;
    const errors: string[] = [];

    for (const rawVehicle of fleet.vehicles) {
      try {
        const normalized = normalizeVehicle(
          rawVehicle,
          provider.field_mapping || {},
          provider.provider_name
        );

        if (!sample_normalized) {
          sample_normalized = normalized;
        }

        const { error: assetError } = await supabaseAdmin
          .from("fleet_assets")
          .upsert(
            {
              provider_id: provider.id,
              provider_name: provider.provider_name,

              truck_id: normalized.truck_id,
              registration: normalized.truck_id,

              latitude: normalized.latitude,
              longitude: normalized.longitude,

              last_seen_at: normalized.recorded_at,

              raw_payload: normalized.raw,

              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "provider_id,truck_id",
            }
          );

        if (assetError) {
          throw new Error(`Asset registry write failed: ${assetError.message}`);
        }

        const { error: telemetryError } = await supabaseAdmin
          .from("telemetry_logs")
          .insert({
            provider_id: provider.id,

            truck_id: normalized.truck_id,

            latitude: normalized.latitude,
            longitude: normalized.longitude,

            speed: normalized.speed,
            fuel_level: normalized.fuel_level,

            recorded_at: normalized.recorded_at,

            raw_payload: normalized.raw,

            validation: normalized.validation,
          });

        if (telemetryError) {
          throw new Error(`Telemetry log write failed: ${telemetryError.message}`);
        }

        syncedCount++;
      } catch (err: any) {
        errors.push(err.message || "Unknown vehicle sync error");
      }
    }

    return {
      success: errors.length === 0,
      message:
        errors.length === 0
          ? `Synced ${syncedCount} vehicles.`
          : `Synced ${syncedCount}/${fleet.vehicles.length} vehicles with ${errors.length} errors.`,
      vehicleCount: syncedCount,
      sample_normalized,
      debug: {
        errors,
        fleet_debug: fleet.debug || null,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || "Unknown provider sync error",
      vehicleCount: 0,
      debug: err,
    };
  }
}

async function authenticateProvider(provider: ProviderRecord): Promise<AuthResult> {
  const authType = (provider.auth_type || "POST_LOGIN").toUpperCase();
  const config = provider.auth_config || {};

  if (authType === "NONE") {
    return {
      success: true,
      token: null,
    };
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

async function fetchFleet(
  provider: ProviderRecord,
  token: string | null
): Promise<FleetResult> {
  if (!provider.fleet_url) {
    return {
      success: false,
      vehicles: [],
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
      vehicles: [],
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

  return {
    success: true,
    vehicles: vehicleArray,
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

function maskPayload(payload: any) {
  const masked = { ...payload };

  if (masked.key) masked.key = "***MASKED***";
  if (masked.api_key) masked.api_key = "***MASKED***";
  if (masked.password) masked.password = "***MASKED***";
  if (masked.token) masked.token = "***MASKED***";

  return masked;
}
