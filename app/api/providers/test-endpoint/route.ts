import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  extractRowsByPath as extractRowsByNormalizedPath,
  isVehicleLikeRow as isNormalizedVehicleLikeRow,
  normalizeFieldMappingsRelativeToRow,
  normalizeRowPath,
  rankCandidateRowPaths,
} from "../../../../lib/providers/configNormalization";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const MAX_RESPONSE_BYTES = 256 * 1024;
const TEST_TIMEOUT_MS = 12_000;
const AUTO_TEST_TIMEOUT_MS = 7_000;
const MAX_SUGGESTIONS = 20;
const KNOWN_LOGIN_ENDPOINTS = ["/auth/login", "/login"];
const KNOWN_FLEET_ENDPOINTS = [
  "/get_devices",
  "/devices",
  "/vehicles",
  "/fleet",
  "/get_reports",
];

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

    if (body.mode === "auto_setup") {
      const autoResult = await autoTestSetup(body, resolved.companyId);
      if (autoResult.error) {
        return noStoreJson(
          { success: false, error: autoResult.error },
          { status: 400 }
        );
      }
      return noStoreJson({ success: true, ...autoResult });
    }

    const effectiveBody = await resolveTemplatedEndpoint(body);
    if ("error" in effectiveBody) {
      return noStoreJson(
        { success: false, error: effectiveBody.error },
        { status: 400 }
      );
    }

    const singleResult = await testEndpointCandidate(effectiveBody.body, TEST_TIMEOUT_MS);
    if (singleResult.error) {
      return noStoreJson(
        { success: false, error: singleResult.error },
        { status: 400 }
      );
    }

    return noStoreJson({
      success: true,
      ...publicDetectionResult(singleResult, effectiveBody.body.mode || null),
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

async function autoTestSetup(body: any, companyId: string) {
  const baseResult = await validateBaseUrl(body.base_url);
  if (baseResult.error) return { error: baseResult.error };

  const baseUrl = baseResult.baseUrl as string;
  const authMethod = String(body.auth_method || "none").trim().toLowerCase();
  const providerText = `${body.provider_name || ""} ${body.provider_website || ""} ${body.provider_notes || ""} ${body.login_url || ""} ${body.endpoint_url || ""} ${baseUrl}`.toLowerCase();
  const loginTokenHint = hasLoginTokenHint(providerText);
  const loginUrlCandidates = buildLoginUrlCandidates(baseUrl);
  const fleetUrlCandidates = buildFleetUrlCandidates(baseUrl, providerText);
  const tokenPathCandidates = [
    "user_api_hash",
    "data.user_api_hash",
    "token",
    "data.token",
    "access_token",
    "data.access_token",
  ];

  let loginResult: any = null;
  let tokenValue = "";
  let loginAttempts = 0;
  let loginAcceptedWithoutToken = false;
  const loginStatuses: number[] = [];

  if (authMethod === "post_login") {
    const username = safeCredential(body.username, 255);
    const password = safeCredential(body.password, 4000);
    if (!username || !password) {
      return { error: "Username and password are required for auto-testing POST login token setup." };
    }

    const usernameKeys = ["email", "username", "user_name"];
    const credentialPlacements = ["json_body", "query_params"];

    for (const loginUrl of loginUrlCandidates) {
      for (const usernameKey of usernameKeys) {
        for (const placement of credentialPlacements) {
          loginAttempts += 1;
          const candidate =
            placement === "query_params"
              ? {
                  mode: "login",
                  url: appendQueryParams(loginUrl, {
                    [usernameKey]: username,
                    password,
                  }),
                  method: "GET",
                  auth_method: "none",
                }
              : {
                  mode: "login",
                  url: loginUrl,
                  method: "POST",
                  auth_method: "post_login",
                  username,
                  password,
                  login_username_field: usernameKey,
                  login_secret_field: "password",
                };
          const result = await testEndpointCandidate(candidate, AUTO_TEST_TIMEOUT_MS);
          if (result.response?.status) loginStatuses.push(result.response.status);
          if (result.error || !result.response?.ok) continue;
          loginAcceptedWithoutToken = true;

          const matchedPath = tokenPathCandidates.find((path) =>
            isUsableToken(getByPath(result.analysis.parsed, path))
          );
          if (!matchedPath) continue;

          tokenValue = String(getByPath(result.analysis.parsed, matchedPath));
          loginResult = {
            login_url: loginUrl,
            token_path: matchedPath,
            credential_placement: placement,
            username_field: usernameKey,
            password_field: "password",
            status_code: result.response.status,
            token_preview: maskString(tokenValue),
            token_like_paths: result.analysis.token_like_paths,
          };
          break;
        }
        if (loginResult) break;
      }
      if (loginResult) break;
    }
  }

  if (authMethod === "post_login" && !loginResult) {
    return {
      base_url: baseUrl,
      login: null,
      fleet: null,
      login_candidates: loginUrlCandidates,
      fleet_candidates: fleetUrlCandidates,
      token_path_candidates: tokenPathCandidates,
      row_path_candidates: ["data", "items", "devices", "vehicles", "result.items"],
      connection_contract: buildAutoSetupConnectionContract({
        baseUrl,
        authMethod,
        loginResult: null,
        fleetResult: null,
      }),
      suggested_auth_method: null,
      failure_stage: loginAcceptedWithoutToken ? "token" : "login",
      attempts: {
        login: loginAttempts,
        fleet: 0,
      },
      setup_blockers: [
        loginAcceptedWithoutToken
          ? "Access token not found. Ask the provider which token or hash field is returned by login."
          : loginStatuses.includes(422)
            ? "The provider rejected the login request shape. Try query-parameter login or JSON-body login."
            : "Login failed. Check email/password or whether this provider expects query-parameter login.",
      ],
    };
  }

  const fleetAuthCandidates = buildFleetAuthCandidates(body, authMethod, tokenValue);
  let fleetResult: any = null;
  let fleetAttempts = 0;
  const fleetStatuses: number[] = [];

  for (const fleetUrl of fleetUrlCandidates) {
    for (const authCandidate of fleetAuthCandidates as any[]) {
      fleetAttempts += 1;
      const candidate = {
        mode: "fleet",
        url:
          authCandidate.token_placement === "query_user_api_hash"
            ? appendQueryParams(fleetUrl, { user_api_hash: authCandidate.token })
            : authCandidate.token_placement === "query_token"
              ? appendQueryParams(fleetUrl, { token: authCandidate.token })
              : fleetUrl,
        method: "GET",
        auth_method: authCandidate.auth_method,
        api_key_header: authCandidate.api_key_header,
        api_key: authCandidate.api_key,
        bearer_token: authCandidate.bearer_token,
        username: authCandidate.username,
        password: authCandidate.password,
      };
      const result = await testEndpointCandidate(candidate, AUTO_TEST_TIMEOUT_MS);
      if (result.response?.status) fleetStatuses.push(result.response.status);
      if (result.error || !result.response?.ok) continue;
      const rowPath = result.analysis.row_path_suggestions[0];
      if (!rowPath) continue;
      const rows = extractRowsByPath(result.analysis.parsed, rowPath);
      const detectedVehicleCount = rows.length;
      if (detectedVehicleCount < 1) continue;
      const fieldSuggestions = result.analysis.field_mapping_suggestions || {};
      const matchSummary = await summarizeDetectedAssetMatches(
        companyId,
        rows,
        fieldSuggestions.truck || fieldSuggestions.vehicle || undefined
      );
      const trackingVerified = Boolean(
        (fieldSuggestions.truck || fieldSuggestions.vehicle) &&
          fieldSuggestions.latitude &&
          fieldSuggestions.longitude &&
          (fieldSuggestions.recorded_at || fieldSuggestions.timestamp)
      );

      fleetResult = {
        endpoint_url: buildSavedFleetEndpointUrl(fleetUrl, authCandidate.token_placement),
        token_placement: authCandidate.token_placement,
        row_path: rowPath,
        field_mapping_suggestions: fieldSuggestions,
        detected_vehicle_count: detectedVehicleCount,
        matched_existing_assets: matchSummary.matched,
        unmatched_vehicle_count: matchSummary.unmatched,
        tracking_verified: trackingVerified,
        engine_fuel_verified: false,
        status_code: result.response.status,
        setup_blockers: buildSetupBlockers(
          result.response,
          result.analysis,
          result.truncated,
          "fleet"
        ),
      };
      break;
    }
    if (fleetResult) break;
  }

  return {
    base_url: baseUrl,
    login: loginResult,
    fleet: fleetResult,
    login_candidates: loginUrlCandidates,
    fleet_candidates: fleetUrlCandidates,
    token_path_candidates: tokenPathCandidates,
    row_path_candidates: ["data", "items", "devices", "vehicles", "result.items"],
    connection_contract: buildAutoSetupConnectionContract({
      baseUrl,
      authMethod,
      loginResult,
      fleetResult,
    }),
    suggested_auth_method:
      authMethod !== "post_login" && loginTokenHint ? "post_login" : null,
    failure_stage: !fleetResult ? "fleet" : null,
    attempts: {
      login: loginAttempts,
      fleet: fleetAttempts,
    },
    setup_blockers: [
      ...(authMethod !== "post_login" && loginTokenHint
        ? [
            `${authLabel(authMethod)} auth is selected, so login-token discovery was skipped. This provider appears to use user_api_hash. Switch to POST login token?`,
          ]
        : []),
      ...(authMethod === "post_login" && !loginResult
        ? [
            loginStatuses.includes(422)
              ? "The provider rejected the login request shape. Try query-parameter login or JSON-body login."
              : "No login candidate returned a usable token path.",
          ]
        : []),
      ...(!fleetResult
        ? [
            fleetStatuses.includes(401)
              ? "The provider rejected the fleet request. Confirm the login token is passed as user_api_hash."
              : "No vehicle rows found yet. Try another endpoint or ask your provider for the exact get_devices response.",
          ]
        : []),
    ],
  };
}

async function summarizeDetectedAssetMatches(
  companyId: string,
  rows: any[],
  vehiclePath?: string
) {
  if (!companyId || !vehiclePath || rows.length === 0) {
    return {
      matched: 0,
      unmatched: rows.length,
    };
  }

  const detectedKeys = new Set(
    rows
      .map((row) => normalizeVehicleMatchKey(getByPath(row, vehiclePath)))
      .filter(Boolean)
  );

  if (detectedKeys.size === 0) {
    return {
      matched: 0,
      unmatched: rows.length,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("truck_id, registration")
    .eq("company_id", companyId);

  if (error) throw error;

  const assetKeys = new Set<string>();
  for (const asset of data || []) {
    const truckKey = normalizeVehicleMatchKey(asset.truck_id);
    const registrationKey = normalizeVehicleMatchKey(asset.registration);
    if (truckKey) assetKeys.add(truckKey);
    if (registrationKey) assetKeys.add(registrationKey);
  }

  let matched = 0;
  for (const key of Array.from(detectedKeys)) {
    if (assetKeys.has(key)) matched++;
  }

  return {
    matched,
    unmatched: Math.max(0, detectedKeys.size - matched),
  };
}

function buildAutoSetupConnectionContract(input: {
  baseUrl: string;
  authMethod: string;
  loginResult: any;
  fleetResult: any;
}) {
  const reportEndpoint =
    input.authMethod === "post_login"
      ? appendQueryParams(`${input.baseUrl}/get_reports`, {
          user_api_hash: "{{user_api_hash}}",
        })
      : `${input.baseUrl}/get_reports`;

  return {
    version: 1,
    auth_channel: {
      auth_type: input.authMethod,
      login_url: input.loginResult?.login_url || null,
      token_paths: input.loginResult?.token_path
        ? [input.loginResult.token_path]
        : [],
      token_aliases: ["user_api_hash", "token", "access_token", "api_key", "hash"],
    },
    feeds: [
      {
        feed_type: "current_vehicles",
        endpoint_url: input.fleetResult?.endpoint_url || null,
        method: "GET",
        row_path: input.fleetResult?.row_path || null,
        token_placement: input.fleetResult?.token_placement || null,
        mapping: input.fleetResult?.field_mapping_suggestions || {},
      },
      {
        feed_type: "distance_report",
        endpoint_url: reportEndpoint,
        method: "GET",
        active: false,
        setup_required: true,
        required_parameters: [
          "date range",
          "report type",
          "vehicle/device id if required",
          "vehicle data group",
          "distance field mapping",
        ],
      },
    ],
  };
}

function normalizeVehicleMatchKey(value: any) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function resolveTemplatedEndpoint(body: any) {
  if (body.mode === "login") {
    return { body: resolveLoginEndpointUrl(body) };
  }
  return resolveTemplatedFleetEndpoint(body);
}

function resolveLoginEndpointUrl(body: any) {
  if (
    String(body.auth_method || "").trim().toLowerCase() !== "post_login" ||
    String(body.login_credential_placement || "").trim() !== "query_params"
  ) {
    return body;
  }

  const usernameField = safeProviderPath(body.login_username_field || "username");
  const passwordField = safeProviderPath(body.login_secret_field || "password");
  const username = safeCredential(body.username, 255);
  const password = safeCredential(body.password, 4000);
  if (!usernameField || !passwordField || !username || !password) return body;

  return {
    ...body,
    url: appendQueryParams(String(body.url || ""), {
      [usernameField]: username,
      [passwordField]: password,
    }),
    method: "GET",
    auth_method: "none",
  };
}

async function resolveTemplatedFleetEndpoint(body: any) {
  const url = String(body.url || "");
  const needsUserHash = url.includes("{{user_api_hash}}");
  const needsToken = url.includes("{{token}}");
  if (!needsUserHash && !needsToken) return { body };

  const authMethod = String(body.auth_method || "").trim().toLowerCase();
  if (authMethod !== "post_login") {
    return {
      error:
        "This fleet endpoint uses a login-token placeholder. Switch auth method to POST login token before testing.",
    };
  }

  const login = await runLoginTokenDetection(body, TEST_TIMEOUT_MS);
  if (login.error) return { error: login.error };
  const token = login.token as string;
  return {
    body: {
      ...body,
      url: url
        .split("{{user_api_hash}}")
        .join(encodeURIComponent(token))
        .split("{{token}}")
        .join(encodeURIComponent(token)),
      auth_method:
        needsUserHash || needsToken ? "none" : body.auth_method,
    },
  };
}

async function runLoginTokenDetection(body: any, timeoutMs: number) {
  const loginUrl = String(body.login_url || "").trim();
  if (!loginUrl) return { error: "Login endpoint URL is required before testing this tokenized fleet endpoint." };

  const tokenPath = safeProviderPath(body.login_token_path || "");
  if (!tokenPath) return { error: "Login token path is required before testing this tokenized fleet endpoint." };

  const username = safeCredential(body.username, 255);
  const password = safeCredential(body.password, 4000);
  if (!username || !password) {
    return { error: "Login username and password are required before testing this tokenized fleet endpoint." };
  }

  const usernameField = safeProviderPath(body.login_username_field || "username");
  const passwordField = safeProviderPath(body.login_secret_field || "password");
  if (!usernameField || !passwordField) {
    return { error: "Login credential field names are invalid." };
  }

  const placement =
    String(body.login_credential_placement || "json_body").trim() ===
    "query_params"
      ? "query_params"
      : "json_body";
  const candidate =
    placement === "query_params"
      ? {
          mode: "login",
          url: appendQueryParams(loginUrl, {
            [usernameField]: username,
            [passwordField]: password,
          }),
          method: "GET",
          auth_method: "none",
        }
      : {
          mode: "login",
          url: loginUrl,
          method: "POST",
          auth_method: "post_login",
          username,
          password,
          login_username_field: usernameField,
          login_secret_field: passwordField,
        };

  const result = await testEndpointCandidate(candidate, timeoutMs);
  if (result.error) return { error: result.error };
  if (!result.response?.ok) {
    return {
      error:
        result.response?.status === 422
          ? "The provider rejected the login request shape. Try query-parameter login or JSON-body login."
          : `Login endpoint returned HTTP ${result.response?.status || "error"}.`,
    };
  }
  const token = getByPath(result.analysis.parsed, tokenPath);
  if (!isUsableToken(token)) {
    return { error: "Login succeeded, but the configured token path did not return a usable token." };
  }
  return { token: String(token) };
}

async function testEndpointCandidate(body: any, timeoutMs: number) {
  const urlResult = await validateOutboundUrl(body.url);
  if (urlResult.error) return { error: urlResult.error };
  const outboundUrl = String(urlResult.url);

  const method = normalizeHttpMethod(body.method);
  if (!method) return { error: "HTTP method must be GET or POST." };

  const requestPayload = buildRequestPayload(body, method);
  if (requestPayload.error) return { error: requestPayload.error };

  const headers = buildAllowedHeaders(body, method);
  if (headers.error) return { error: headers.error };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

  return {
    response,
    contentType,
    analysis,
    truncated: limited.truncated,
  };
}

function publicDetectionResult(result: any, mode: any = null) {
  const response = result.response as Response;
  const setupBlockers = buildSetupBlockers(
    response,
    result.analysis,
    result.truncated,
    mode
  );

  return {
    status_code: response.status,
    content_type: result.contentType,
    response_type: result.analysis.response_type,
    top_level_keys: result.analysis.top_level_keys,
    array_paths: result.analysis.array_paths,
    token_like_paths: result.analysis.token_like_paths,
    row_path_suggestions: result.analysis.row_path_suggestions,
    field_mapping_suggestions: result.analysis.field_mapping_suggestions,
    sanitized_sample: result.analysis.sanitized_sample,
    setup_blockers: setupBlockers,
    truncated: result.truncated,
    redirect_not_followed: response.status >= 300 && response.status < 400,
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

async function validateBaseUrl(value: any) {
  const text = normalizeBaseUrl(value);
  if (!text) return { error: "Base URL is required." };
  const urlResult = await validateOutboundUrl(text);
  if (urlResult.error) return urlResult;
  return { baseUrl: text };
}

function normalizeBaseUrl(value: any) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();
    const matched =
      KNOWN_LOGIN_ENDPOINTS.find((endpoint) => lowerPath.endsWith(endpoint)) ||
      KNOWN_FLEET_ENDPOINTS.find((endpoint) => lowerPath.endsWith(endpoint)) ||
      "";
    parsed.search = "";
    if (matched) {
      const basePath = path.slice(0, path.length - matched.length).replace(/\/+$/, "");
      parsed.pathname = basePath || "/";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return text.replace(/\/+$/, "");
  }
}

function buildLoginUrlCandidates(baseUrl: string) {
  return uniqueStrings([
    `${baseUrl}/login`,
    `${baseUrl}/auth/login`,
    `${baseUrl}/Login`,
  ]);
}

function buildFleetUrlCandidates(baseUrl: string, providerText: string) {
  const fleetTrackLikely = hasLoginTokenHint(providerText);
  return uniqueStrings([
    ...(fleetTrackLikely ? [`${baseUrl}/get_devices?lang=en`] : []),
    `${baseUrl}/get_devices`,
    `${baseUrl}/devices`,
    `${baseUrl}/vehicles`,
    `${baseUrl}/fleet`,
    `${baseUrl}/fleet_current_locations`,
  ]);
}

function hasLoginTokenHint(value: string) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("fleettrack") ||
    text.includes("get_devices") ||
    text.includes("user_api_hash") ||
    text.includes("api_hash") ||
    text.includes("post_login")
  );
}

function authLabel(value: string) {
  const labels: Record<string, string> = {
    api_key_header: "API key header",
    bearer_token: "Bearer token",
    basic: "Basic username/password",
    none: "No auth",
  };
  return labels[value] || "The selected";
}

function buildFleetAuthCandidates(body: any, authMethod: string, loginToken: string) {
  if (authMethod === "post_login" && loginToken) {
    return [
      {
        token_placement: "query_user_api_hash",
        token: loginToken,
        auth_method: "none",
      },
      {
        token_placement: "query_token",
        token: loginToken,
        auth_method: "none",
      },
      {
        token_placement: "authorization_bearer",
        token: loginToken,
        auth_method: "bearer_token",
        bearer_token: loginToken,
      },
      {
        token_placement: "x_api_key",
        token: loginToken,
        auth_method: "api_key_header",
        api_key_header: "X-API-Key",
        api_key: loginToken,
      },
    ];
  }

  if (authMethod === "api_key_header") {
    return [
      {
        token_placement: "x_api_key",
        auth_method: "api_key_header",
        api_key_header: body.api_key_header || "x-api-key",
        api_key: body.api_key,
      },
    ];
  }
  if (authMethod === "bearer_token") {
    return [
      {
        token_placement: "authorization_bearer",
        auth_method: "bearer_token",
        bearer_token: body.bearer_token,
      },
    ];
  }
  if (authMethod === "basic") {
    return [
      {
        token_placement: "basic_auth",
        auth_method: "basic",
        username: body.username,
        password: body.password,
      },
    ];
  }
  return [{ token_placement: "none", auth_method: "none" }];
}

function buildSavedFleetEndpointUrl(url: string, tokenPlacement: string) {
  if (tokenPlacement === "query_user_api_hash") {
    return appendQueryParams(url, { user_api_hash: "{{user_api_hash}}" });
  }
  if (tokenPlacement === "query_token") {
    return appendQueryParams(url, { token: "{{token}}" });
  }
  return url;
}

function appendQueryParams(url: string, params: Record<string, string>) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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
  const selectedRowPath = rowPathSuggestions[0] || "$";

  return {
    parsed,
    response_type: responseType,
    top_level_keys: topLevelKeys,
    array_paths: arrayPaths,
    token_like_paths: tokenLikePaths,
    row_path_suggestions: rowPathSuggestions,
    field_mapping_suggestions: normalizeFieldMappingsRelativeToRow(
      suggestFieldMappings(sampleRow || parsed),
      selectedRowPath
    ),
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
  const candidatePaths = [
    ...(Array.isArray(parsed) ? ["$"] : []),
    ...arrayPaths.map(normalizeProviderRowPath),
  ].filter(Boolean);
  return rankCandidateRowPaths(parsed, candidatePaths)
    .map((entry) => entry.path)
    .slice(0, 5);
}

function sampleRowForSuggestions(parsed: any, rowPaths: string[]) {
  for (const path of rowPaths) {
    const rows = extractRowsByPath(parsed, path);
    if (rows[0]) return rows[0];
  }
  return isVehicleLikeRow(parsed) ? parsed : null;
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
  } else if (mode === "login" && response.status === 422) {
    blockers.push("The provider rejected the login request shape. Try query-parameter login or JSON-body login.");
  } else if (mode === "fleet" && response.status === 401) {
    blockers.push("The provider rejected the fleet request. Confirm the login token is passed as user_api_hash.");
  } else if (!response.ok) {
    blockers.push(`Endpoint returned HTTP ${response.status}.`);
  }
  if (truncated) blockers.push("Response was truncated before analysis.");
  if (analysis.response_type === "text") {
    blockers.push("Response is not JSON, so vehicle data groups and field mappings may not be detectable.");
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
  const normalizedPath = normalizeProviderRowPath(path);
  if (normalizedPath === "$") return obj;
  const lookupPath = normalizedPath.startsWith("$.")
    ? normalizedPath.slice(2)
    : normalizedPath;
  return lookupPath.split(".").reduce((current, part) => current?.[part], obj);
}

function extractRowsByPath(responseData: any, rowPath: string) {
  return extractRowsByNormalizedPath(responseData, rowPath);
}

function normalizeVehicleRows(value: any) {
  if (Array.isArray(value)) return value.filter(isVehicleLikeRow);
  if (isVehicleLikeRow(value)) return [value];
  return [];
}

function isVehicleLikeRow(value: any) {
  if (isNormalizedVehicleLikeRow(value)) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    hasAnyProviderField(value, [
      "vehicle",
      "truck",
      "truck_id",
      "reg",
      "reg_no",
      "registration",
      "plate",
      "unit_id",
      "device",
      "device_id",
    ])
  ) {
    return true;
  }

  const hasLatitude = hasAnyProviderField(value, ["latitude", "lat", "gps_lat", "y"]);
  const hasLongitude = hasAnyProviderField(value, [
    "longitude",
    "lng",
    "lon",
    "gps_lng",
    "gps_lon",
    "x",
  ]);
  const hasMovementContext = hasAnyProviderField(value, [
    "speed",
    "velocity",
    "kph",
    "speed_kph",
    "timestamp",
    "time",
    "fixtime",
    "currenttime",
    "current_time",
    "recorded_at",
    "gps_time",
  ]);
  return hasLatitude && hasLongitude && hasMovementContext;
}

function hasAnyProviderField(value: any, aliases: string[], depth = 0): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) {
    return false;
  }

  const normalizedAliases = new Set(aliases.map(normalizeKey));
  for (const [key, entry] of Object.entries(value)) {
    if (
      normalizedAliases.has(normalizeKey(key)) &&
      entry !== null &&
      entry !== undefined &&
      String(entry).trim() !== ""
    ) {
      return true;
    }

    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      hasAnyProviderField(entry, aliases, depth + 1)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeProviderRowPath(value: any) {
  return normalizeRowPath(value);
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
  if (/https?:\/\//i.test(text) || /[{},]/.test(text) || /\s/.test(text)) return "";
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

function isUsableToken(value: any) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text.length >= 4 && text.length <= 4000;
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
