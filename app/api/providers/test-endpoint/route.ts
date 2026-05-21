import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 256 * 1024;
const TEST_TIMEOUT_MS = 12_000;
const MAX_SUGGESTIONS = 20;

type ProviderCapabilities = {
  can_use_provider_setup_tools: boolean;
};

type ResolveAccessResult =
  | {
      userId: string;
      companyId: string;
      isPlatformOwner: boolean;
      roles: string[];
      capabilities: ProviderCapabilities;
      error?: never;
    }
  | {
      error: NextResponse;
      userId?: never;
      companyId?: never;
      isPlatformOwner?: never;
      roles?: never;
      capabilities?: never;
    };

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveAccess(req, body.companyId);
    if (resolved.error) return resolved.error;

    if (!resolved.capabilities.can_use_provider_setup_tools) {
      return noStoreJson(
        { success: false, error: "Provider administration access required" },
        { status: 403 }
      );
    }

    const urlResult = await validateOutboundUrl(body.url);
    if (urlResult.error) {
      return noStoreJson(
        { success: false, error: urlResult.error },
        { status: 400 }
      );
    }
    const outboundUrl = String(urlResult.url);

    const method = normalizeHttpMethod(body.method);
    if (!method) {
      return noStoreJson(
        { success: false, error: "HTTP method must be GET or POST." },
        { status: 400 }
      );
    }

    const requestPayload = buildRequestPayload(body, method);
    if (requestPayload.error) {
      return noStoreJson(
        { success: false, error: requestPayload.error },
        { status: 400 }
      );
    }

    const headers = buildAllowedHeaders(body, method);
    if (headers.error) {
      return noStoreJson(
        { success: false, error: headers.error },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(outboundUrl, {
        method,
        headers: headers.headers,
        body:
          method === "GET"
            ? undefined
            : JSON.stringify(requestPayload.payload || {}),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const contentType = response.headers.get("content-type") || "";
    const limited = await readLimitedResponseText(response, MAX_RESPONSE_BYTES);
    const analysis = analyzeResponseBody(limited.text, contentType);
    const setupBlockers = buildSetupBlockers(
      response,
      analysis,
      limited.truncated,
      body.mode
    );

    return noStoreJson({
      success: true,
      status_code: response.status,
      content_type: contentType,
      response_type: analysis.response_type,
      top_level_keys: analysis.top_level_keys,
      array_paths: analysis.array_paths,
      token_like_paths: analysis.token_like_paths,
      row_path_suggestions: analysis.row_path_suggestions,
      field_mapping_suggestions: analysis.field_mapping_suggestions,
      sanitized_sample: analysis.sanitized_sample,
      setup_blockers: setupBlockers,
      truncated: limited.truncated,
      redirect_not_followed: response.status >= 300 && response.status < 400,
    });
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    console.error("Provider endpoint detection error:", {
      message: err?.message,
      aborted,
    });
    return noStoreJson(
      {
        success: false,
        error: aborted
          ? "Endpoint test timed out."
          : err.message || "Failed to test endpoint",
      },
      { status: aborted ? 408 : 500 }
    );
  }
}

async function resolveAccess(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveAccessResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const activeMemberships = memberships || [];
  const roles = Array.from(
    new Set(
      activeMemberships
        .map((membership) => String(membership.role || "").toLowerCase())
        .filter(Boolean)
    )
  );
  const isPlatformOwner = roles.includes("platform_owner");
  const canUseProviderSetupTools =
    isPlatformOwner || roles.includes("owner") || roles.includes("admin");

  if (isPlatformOwner && requestedCompanyId) {
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("id", requestedCompanyId)
      .maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: noStoreJson(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return {
      userId: user.id,
      companyId: company.id,
      isPlatformOwner,
      roles,
      capabilities: {
        can_use_provider_setup_tools: canUseProviderSetupTools,
      },
    };
  }

  const companyId = activeMemberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    userId: user.id,
    companyId,
    isPlatformOwner,
    roles,
    capabilities: {
      can_use_provider_setup_tools: canUseProviderSetupTools,
    },
  };
}

async function validateOutboundUrl(value: any) {
  const text = String(value || "").trim();
  if (!text) return { error: "Endpoint URL is required." };
  if (text.length > 2000) return { error: "Endpoint URL is too long." };

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { error: "Endpoint URL must be valid." };
  }

  const isProduction = process.env.NODE_ENV === "production";
  const protocol = parsed.protocol.toLowerCase();
  const allowedProtocol = isProduction
    ? protocol === "https:"
    : protocol === "https:" || protocol === "http:";
  if (!allowedProtocol) {
    return {
      error: isProduction
        ? "Endpoint URL must use https."
        : "Endpoint URL must use http or https.",
    };
  }

  if (parsed.username || parsed.password) {
    return { error: "Endpoint URL cannot include embedded credentials." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return {
      error:
        "Endpoint URL cannot target localhost, private, link-local, metadata, or internal hostnames.",
    };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { error: "Endpoint hostname could not be resolved." };
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return {
      error:
        "Endpoint DNS resolves to a private, link-local, metadata, or internal network address.",
    };
  }

  return { url: parsed.toString() };
}

function normalizeHttpMethod(value: any) {
  const method = String(value || "GET").trim().toUpperCase();
  return method === "GET" || method === "POST" ? method : "";
}

function buildRequestPayload(body: any, method: string) {
  if (method === "GET") return { payload: {} };

  if (body.mode === "login" && body.auth_method === "post_login") {
    const usernameField = safeProviderPath(body.login_username_field || "username");
    const passwordField = safeProviderPath(body.login_secret_field || "password");
    const username = safeCredential(body.username, 255);
    const password = safeCredential(body.password, 4000);

    if (!usernameField || !passwordField) {
      return { error: "Login credential field names are invalid." };
    }
    if (!username || !password) {
      return { error: "Login username and password are required." };
    }

    return {
      payload: {
        [usernameField]: username,
        [passwordField]: password,
      },
    };
  }

  const requestBody = body.request_body;
  if (
    requestBody === undefined ||
    requestBody === null ||
    String(requestBody).trim() === ""
  ) {
    return { payload: {} };
  }

  let parsed: any;
  try {
    parsed =
      typeof requestBody === "string" ? JSON.parse(requestBody) : requestBody;
  } catch {
    return { error: "POST body must be valid JSON." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "POST body must be a JSON object." };
  }

  const sensitiveKey = findSensitiveKey(parsed);
  if (sensitiveKey) {
    return {
      error: `POST body cannot contain credential-like key '${sensitiveKey}'. Use the auth fields instead.`,
    };
  }

  return { payload: parsed };
}

function buildAllowedHeaders(body: any, method: string) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain;q=0.5",
  };

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  const authMethod = String(body.auth_method || "none").trim().toLowerCase();
  if (authMethod === "api_key_header") {
    const headerName = safeHeaderName(body.api_key_header || "x-api-key");
    const apiKey = safeCredential(body.api_key, 4000);
    if (!headerName) return { error: "API key header name is invalid." };
    if (!apiKey) return { error: "API key is required." };
    headers[headerName] = apiKey;
  } else if (authMethod === "bearer_token") {
    const token = safeCredential(body.bearer_token, 4000);
    if (!token) return { error: "Bearer token is required." };
    headers.Authorization = `Bearer ${token}`;
  } else if (authMethod === "basic") {
    const username = safeCredential(body.username, 255);
    const password = safeCredential(body.password, 4000);
    if (!username || !password) {
      return { error: "Basic username and password are required." };
    }
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  return { headers };
}

async function readLimitedResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    return { text: "", truncated: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      const allowed = Math.max(0, value.byteLength - (total - maxBytes));
      text += decoder.decode(value.slice(0, allowed), { stream: false });
      truncated = true;
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return { text, truncated };
}

function analyzeResponseBody(text: string, contentType: string) {
  const parsed = parseResponse(text, contentType);
  const responseType = responseTypeOf(parsed);
  const topLevelKeys =
    parsed && !Array.isArray(parsed) && typeof parsed === "object"
      ? Object.keys(parsed).slice(0, MAX_SUGGESTIONS)
      : [];
  const arrayPaths = parsed === null ? [] : findArrayPaths(parsed).slice(0, MAX_SUGGESTIONS);
  const tokenLikePaths =
    parsed === null ? [] : findTokenLikePaths(parsed).slice(0, MAX_SUGGESTIONS);
  const rowPathSuggestions = suggestRowPaths(parsed, arrayPaths);
  const sampleRow = sampleRowForSuggestions(parsed, rowPathSuggestions);

  return {
    parsed,
    response_type: responseType,
    top_level_keys: topLevelKeys,
    array_paths: arrayPaths,
    token_like_paths: tokenLikePaths,
    row_path_suggestions: rowPathSuggestions,
    field_mapping_suggestions: suggestFieldMappings(sampleRow || parsed),
    sanitized_sample: sanitizeSample(parsed),
  };
}

function parseResponse(text: string, contentType: string) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  if (
    contentType.toLowerCase().includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(0, 1000);
    }
  }
  return trimmed.slice(0, 1000);
}

function responseTypeOf(value: any) {
  if (Array.isArray(value)) return "array";
  if (value && typeof value === "object") return "object";
  return "text";
}

function findArrayPaths(value: any, path = "$", output: string[] = []) {
  if (Array.isArray(value)) {
    output.push(path);
    const firstObject = value.find(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    );
    if (firstObject) findArrayPaths(firstObject, `${path}[]`, output);
    return output;
  }

  if (!value || typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    findArrayPaths(entry, path === "$" ? key : `${path}.${key}`, output);
  }
  return output;
}

function findTokenLikePaths(value: any, path = "$", output: string[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry && typeof entry === "object");
    if (first) findTokenLikePaths(first, `${path}[]`, output);
    return output;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = path === "$" ? key : `${path}.${key}`;
    if (isTokenLikeKey(key)) output.push(nextPath);
    findTokenLikePaths(entry, nextPath, output);
  }
  return output;
}

function suggestRowPaths(parsed: any, arrayPaths: string[]) {
  if (Array.isArray(parsed)) return ["$"];
  const scored = arrayPaths
    .filter((path) => !path.endsWith("[]"))
    .map((path) => {
      const value = getByPath(parsed, path);
      const first = Array.isArray(value) ? value[0] : null;
      const objectScore = first && typeof first === "object" ? 5 : 0;
      const nameScore = /vehicle|device|asset|truck|item|data|result/i.test(path) ? 3 : 0;
      const lengthScore = Array.isArray(value) && value.length > 0 ? 2 : 0;
      return { path, score: objectScore + nameScore + lengthScore };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.path);
  return Array.from(new Set(scored)).slice(0, 5);
}

function sampleRowForSuggestions(parsed: any, rowPaths: string[]) {
  if (Array.isArray(parsed)) return parsed.find((entry) => entry && typeof entry === "object");
  for (const path of rowPaths) {
    const value = getByPath(parsed, path);
    if (Array.isArray(value)) {
      const row = value.find((entry) => entry && typeof entry === "object");
      if (row) return row;
    }
  }
  return parsed && typeof parsed === "object" ? parsed : null;
}

function suggestFieldMappings(sample: any) {
  const paths = flattenObjectPaths(sample).slice(0, 250);
  return {
    vehicle: findBestPath(paths, [
      "registration",
      "reg_no",
      "vehicle",
      "vehicle_name",
      "plate",
      "truck",
      "truck_id",
      "unit",
      "unit_id",
      "device",
      "device_name",
      "name",
    ]),
    latitude: findBestPath(paths, ["latitude", "lat", "gps_lat", "position_latitude"]),
    longitude: findBestPath(paths, ["longitude", "lng", "lon", "gps_lng", "position_longitude"]),
    speed: findBestPath(paths, ["speed", "speed_kph", "speed_kmh", "velocity"]),
    timestamp: findBestPath(paths, [
      "recorded_at",
      "timestamp",
      "time",
      "current_time",
      "currenttime",
      "datetime",
      "gps_time",
      "server_time",
      "updated_at",
    ]),
    location_label: findBestPath(paths, [
      "location",
      "location_label",
      "address",
      "current_location",
      "currentlocation",
      "place",
    ]),
    ignition: findBestPath(paths, ["ignition", "ignition_on", "acc", "acc_on", "engine_on"]),
    engine_rpm: findBestPath(paths, ["engine_rpm", "rpm"]),
    fuel_level: findBestPath(paths, [
      "fuel_level",
      "fuellevel",
      "fuel",
      "current_fuel_level",
      "currentfuellevel",
      "tank_level",
    ]),
    odometer: findBestPath(paths, ["odometer", "odometer_km", "odo"]),
    mileage: findBestPath(paths, ["mileage", "distance", "distance_km"]),
    violations: findBestPath(paths, ["violations", "violations_count", "alerts"]),
  };
}

function flattenObjectPaths(value: any, path = "", depth = 0, output: string[] = []) {
  if (!value || typeof value !== "object" || depth > 6) return output;
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry && typeof entry === "object");
    if (first) flattenObjectPaths(first, path, depth + 1, output);
    return output;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    output.push(nextPath);
    if (entry && typeof entry === "object") {
      flattenObjectPaths(entry, nextPath, depth + 1, output);
    }
  }
  return output;
}

function findBestPath(paths: string[], candidates: string[]) {
  const normalizedCandidates = new Set(candidates.map(normalizeKey));
  const exact = paths.find((path) => normalizedCandidates.has(normalizeKey(lastPathPart(path))));
  if (exact) return exact;
  return (
    paths.find((path) => {
      const normalized = normalizeKey(path);
      return candidates.some((candidate) => normalized.includes(normalizeKey(candidate)));
    }) || null
  );
}

function sanitizeSample(value: any, key = "", depth = 0): any {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 2).map((entry) => sanitizeSample(entry, key, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return sanitizePrimitive(value, key);
  }

  const output: Record<string, any> = {};
  for (const [entryKey, entry] of Object.entries(value).slice(0, 40)) {
    output[entryKey] = sanitizeSample(entry, entryKey, depth + 1);
  }
  return output;
}

function sanitizePrimitive(value: any, key: string) {
  if (typeof value !== "string") return value;
  if (isSensitiveKey(key) || looksLikeSecret(value)) return maskString(value);
  return value.length > 120 ? `${value.slice(0, 80)}...` : value;
}

function buildSetupBlockers(
  response: Response,
  analysis: any,
  truncated: boolean,
  mode: any
) {
  const blockers: string[] = [];
  if (response.status >= 300 && response.status < 400) {
    blockers.push("Endpoint returned a redirect; redirects are not followed by setup detection.");
  } else if (!response.ok) {
    blockers.push(`Endpoint returned HTTP ${response.status}.`);
  }
  if (truncated) blockers.push("Response was truncated before analysis.");
  if (analysis.response_type === "text") {
    blockers.push("Response is not JSON, so row paths and field mappings may not be detectable.");
  }
  if (
    mode !== "login" &&
    analysis.response_type !== "text" &&
    analysis.row_path_suggestions.length === 0
  ) {
    blockers.push("No vehicle row array was detected.");
  }
  return blockers;
}

function getByPath(obj: any, path: string) {
  if (path === "$") return obj;
  return path.split(".").reduce((current, part) => current?.[part], obj);
}

function isBlockedHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return true;
  }
  if (
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".corp")
  ) {
    return true;
  }
  if (!net.isIP(host) && !host.includes(".")) return true;
  return isBlockedAddress(host);
}

function isBlockedAddress(address: string) {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const ipVersion = net.isIP(host);
  if (!ipVersion) return false;

  if (ipVersion === 4) {
    const parts = host.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part))) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return (
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.startsWith("::ffff:127.") ||
    host.startsWith("::ffff:10.") ||
    host.startsWith("::ffff:192.168.")
  );
}

function safeProviderPath(value: any) {
  const text = String(value || "").trim();
  if (!text || text.length > 160) return "";
  if (/https?:\/\//i.test(text) || /[{}]/.test(text)) return "";
  return text;
}

function safeHeaderName(value: any) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return "";
  const lower = text.toLowerCase();
  if (
    [
      "accept",
      "authorization",
      "content-type",
      "host",
      "cookie",
      "set-cookie",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-real-ip",
      "forwarded",
      "proxy-authorization",
      "proxy-authenticate",
    ].includes(lower)
  ) {
    return "";
  }
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(text) ? text : "";
}

function safeCredential(value: any, maxLength: number) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
}

function findSensitiveKey(value: any): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSensitiveKey(item);
      if (nested) return nested;
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) return key;
    const nested = findSensitiveKey(entry);
    if (nested) return nested;
  }
  return null;
}

function isSensitiveKey(key: string) {
  const normalized = normalizeKey(key);
  return [
    "password",
    "token",
    "cookie",
    "authorization",
    "api_key",
    "apikey",
    "api_hash",
    "user_api_hash",
    "hash",
    "jwt",
    "bearer",
    "credential",
    "secret",
    "auth",
  ].some((blocked) => normalized.includes(blocked));
}

function isTokenLikeKey(key: string) {
  const normalized = normalizeKey(key);
  return [
    "token",
    "access_token",
    "api_key",
    "api_hash",
    "user_api_hash",
    "hash",
    "jwt",
    "bearer",
  ].some((candidate) => normalized === candidate || normalized.endsWith(`_${candidate}`));
}

function looksLikeSecret(value: string) {
  const text = value.trim();
  return (
    text.length >= 32 &&
    /^[A-Za-z0-9._~+/=-]+$/.test(text) &&
    !/\s/.test(text)
  );
}

function maskString(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizeKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function lastPathPart(path: string) {
  const parts = String(path || "").split(".");
  return parts[parts.length - 1] || path;
}
