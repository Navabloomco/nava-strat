import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";
import {
  normalizeDistanceTruckKey,
  normalizeProviderTripSummary,
  parseDistanceCsv,
} from "../../../../../lib/telemetry/distance";
import type { ProviderTripSummary } from "../../../../../lib/telemetry/distance";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ProviderCapabilities = {
  can_view_provider_status: boolean;
  can_add_provider: boolean;
  can_update_provider_credentials: boolean;
  can_test_provider: boolean;
  can_edit_advanced_provider_config: boolean;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      userId: string;
      isPlatformOwner: boolean;
      roles: string[];
      capabilities: ProviderCapabilities;
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      userId?: never;
      isPlatformOwner?: never;
      roles?: never;
      capabilities?: never;
    };

type AssetMatch = {
  id: string;
  provider_id?: string | null;
  truck_id: string | null;
  registration: string | null;
  intelligence_enabled?: boolean | null;
  odometer_health?: string | null;
  distance_quality?: Record<string, any> | null;
};

const MAX_CSV_BYTES = 2_000_000;
const MAX_CSV_ROWS = 2_000;

function getProviderCapabilities(roles: string[], isPlatformOwner: boolean) {
  const normalizedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const isCompanyAdmin =
    normalizedRoles.has("owner") || normalizedRoles.has("admin");

  if (isPlatformOwner || normalizedRoles.has("platform_owner")) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: true,
    };
  }

  if (isCompanyAdmin) {
    return {
      can_view_provider_status: true,
      can_add_provider: true,
      can_update_provider_credentials: true,
      can_test_provider: true,
      can_edit_advanced_provider_config: false,
    };
  }

  return {
    can_view_provider_status: true,
    can_add_provider: false,
    can_update_provider_credentials: false,
    can_test_provider: false,
    can_edit_advanced_provider_config: false,
  };
}

async function resolveCompany(
  req: Request,
  requestedCompanyId?: string | null
): Promise<ResolveCompanyResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );
  const capabilities = getProviderCapabilities(roles, isPlatformOwner);

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

    if (companyError) throw companyError;
    if (!company) {
      return {
        error: NextResponse.json(
          { success: false, error: "Company not found" },
          { status: 404 }
        ),
      };
    }

    return {
      company: company as ResolvedCompany,
      userId: user.id,
      isPlatformOwner,
      roles,
      capabilities,
    };
  }

  const companyId = activeMemberships
    .map((membership) => membership.company_id)
    .filter(Boolean)[0];

  if (!companyId) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  const { data: company, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id, name, slug")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError) throw companyError;
  if (!company) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    isPlatformOwner,
    roles,
    capabilities,
  };
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = await resolveCompany(req, body.companyId);
    if (resolved.error) return resolved.error;

    if (
      !resolved.capabilities.can_update_provider_credentials &&
      !resolved.capabilities.can_edit_advanced_provider_config
    ) {
      return NextResponse.json(
        { success: false, error: "Provider administration access required" },
        { status: 403 }
      );
    }

    const csvText = String(body.csvText || body.csv || "");
    const dryRun = body.dryRun !== false;
    if (!csvText.trim()) {
      return NextResponse.json(
        { success: false, error: "CSV content is required" },
        { status: 400 }
      );
    }
    if (new TextEncoder().encode(csvText).length > MAX_CSV_BYTES) {
      return NextResponse.json(
        { success: false, error: "CSV file is too large for this import path" },
        { status: 413 }
      );
    }

    const provider = await loadProvider(params.id, resolved.company.id);
    if (!provider) {
      return NextResponse.json(
        { success: false, error: "Provider not found" },
        { status: 404 }
      );
    }

    const providerTimezone =
      provider.provider_timezone ||
      provider.fleet_config?.provider_timezone ||
      "Africa/Nairobi";
    const parsed = parseDistanceCsv(csvText, { maxRows: MAX_CSV_ROWS });
    const summaries = parsed.rows
      .map((row) =>
        normalizeProviderTripSummary(row, provider.field_mapping || {}, {
          companyId: resolved.company.id,
          providerId: provider.id,
          providerTimezone,
        })
      )
      .filter(Boolean) as ProviderTripSummary[];

    const assetsResult = await loadProviderAssets(resolved.company.id, provider.id);
    if (assetsResult.error) {
      throw new Error(assetsResult.error);
    }

    const assetsByTruck = buildAssetMatchMap(assetsResult.assets, provider.id);
    const matchedSummaries: ProviderTripSummary[] = [];
    const unmatchedRows: Array<{ truck_id: string; provider_trip_key: string | null }> = [];
    const odometerHealthCounts: Record<string, number> = {};
    const distanceSourceCounts: Record<string, number> = {};

    for (const summary of summaries) {
      const matchedAsset = assetsByTruck.get(normalizeDistanceTruckKey(summary.truck_id));
      incrementCount(odometerHealthCounts, summary.odometer_health);
      incrementCount(distanceSourceCounts, summary.distance_source);

      if (!matchedAsset) {
        unmatchedRows.push({
          truck_id: summary.truck_id,
          provider_trip_key: summary.provider_trip_key,
        });
        continue;
      }

      summary.asset_id = matchedAsset.id;
      summary.truck_id = matchedAsset.truck_id || matchedAsset.registration || summary.truck_id;
      summary.metadata = {
        ...summary.metadata,
        source: "manual_provider_csv_import",
        import_file_name: safeFileName(body.fileName),
      };
      matchedSummaries.push(summary);
    }

    const preview = {
      dry_run: dryRun,
      provider_id: provider.id,
      provider_name: provider.provider_name,
      company_id: resolved.company.id,
      company_name: resolved.company.name,
      headers: parsed.headers.slice(0, 30),
      rows_parsed: parsed.rows.length,
      summaries_parsed: summaries.length,
      matched_assets: matchedSummaries.length,
      unmatched_rows: unmatchedRows.length,
      unmatched_samples: unmatchedRows.slice(0, 10),
      static_zero_count: matchedSummaries.filter(
        (summary) => summary.odometer_health === "static_zero"
      ).length,
      static_nonzero_count: matchedSummaries.filter(
        (summary) => summary.odometer_health === "static_nonzero"
      ).length,
      mismatch_count: matchedSummaries.filter(
        (summary) => summary.odometer_health === "mismatch"
      ).length,
      rollover_suspected_count: matchedSummaries.filter(
        (summary) => summary.odometer_health === "rollover_suspected"
      ).length,
      rows_would_write: matchedSummaries.length,
      odometer_health_counts: odometerHealthCounts,
      distance_source_counts: distanceSourceCounts,
      fleet_asset_columns_missing: assetsResult.distanceColumnsMissing,
      setup_required: false,
    };

    if (dryRun) {
      return NextResponse.json({
        success: true,
        message: "Distance report dry run complete",
        preview,
      });
    }

    const importResult = await importDistanceSummaries(
      matchedSummaries,
      assetsResult.assetsById,
      resolved.company.id
    );

    const status = importResult.table_missing ? 409 : 200;
    return NextResponse.json(
      {
        success: !importResult.table_missing,
        message: importResult.table_missing
          ? "Distance schema setup is required before provider trip summaries can be stored."
          : "Distance report imported",
        preview: {
          ...preview,
          dry_run: false,
          rows_written: importResult.rows_written,
          rows_updated: importResult.rows_updated,
          asset_distance_updates: importResult.asset_distance_updates,
          setup_required:
            importResult.table_missing || importResult.fleet_asset_columns_missing,
          table_missing: importResult.table_missing,
          fleet_asset_columns_missing:
            importResult.fleet_asset_columns_missing ||
            assetsResult.distanceColumnsMissing,
          errors: importResult.errors,
        },
      },
      { status }
    );
  } catch (err: any) {
    console.error("Provider distance import error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Distance import failed" },
      { status: 500 }
    );
  }
}

async function loadProvider(providerId: string, companyId: string) {
  const query = supabaseAdmin
    .from("tracking_providers")
    .select(
      "id, company_id, provider_name, provider_slug, provider_timezone, fleet_config, field_mapping"
    )
    .eq("id", providerId)
    .eq("company_id", companyId)
    .maybeSingle();
  const { data, error } = await query;

  if (isMissingColumnError(error)) {
    const retry = await supabaseAdmin
      .from("tracking_providers")
      .select("id, company_id, provider_name, provider_slug, fleet_config, field_mapping")
      .eq("id", providerId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data ? { ...retry.data, provider_timezone: null } : null;
  }

  if (error) throw error;
  return data;
}

async function loadProviderAssets(companyId: string, providerId: string) {
  const { data, error } = await supabaseAdmin
    .from("fleet_assets")
    .select("id, provider_id, truck_id, registration, intelligence_enabled, odometer_health, distance_quality")
    .eq("company_id", companyId);

  if (isMissingDistanceColumnError(error)) {
    const retry = await supabaseAdmin
      .from("fleet_assets")
      .select("id, provider_id, truck_id, registration, intelligence_enabled")
      .eq("company_id", companyId);

    if (retry.error) {
      return {
        assets: [] as AssetMatch[],
        assetsById: new Map<string, AssetMatch>(),
        distanceColumnsMissing: true,
        error: retry.error.message,
      };
    }

    const assets = (retry.data || []) as AssetMatch[];
    return {
      assets,
      assetsById: new Map(assets.map((asset) => [asset.id, asset])),
      distanceColumnsMissing: true,
      error: null,
    };
  }

  if (error) {
    return {
      assets: [] as AssetMatch[],
      assetsById: new Map<string, AssetMatch>(),
      distanceColumnsMissing: false,
      error: error.message,
    };
  }

  const assets = (data || []) as AssetMatch[];
  return {
    assets,
    assetsById: new Map(assets.map((asset) => [asset.id, asset])),
    distanceColumnsMissing: false,
    error: null,
  };
}

function buildAssetMatchMap(assets: AssetMatch[], preferredProviderId?: string) {
  const map = new Map<string, AssetMatch>();
  for (const asset of sortAssetsByPreferredProvider(assets, preferredProviderId)) {
    for (const value of [asset.truck_id, asset.registration]) {
      const key = normalizeDistanceTruckKey(value);
      if (key && !map.has(key)) map.set(key, asset);
    }
  }
  return map;
}

function sortAssetsByPreferredProvider(
  assets: AssetMatch[],
  preferredProviderId?: string
) {
  return [...assets].sort((a, b) => {
    const aPreferred = preferredProviderId && a.provider_id === preferredProviderId ? 0 : 1;
    const bPreferred = preferredProviderId && b.provider_id === preferredProviderId ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aEnabled = a.intelligence_enabled ? 0 : 1;
    const bEnabled = b.intelligence_enabled ? 0 : 1;
    return aEnabled - bEnabled;
  });
}

async function importDistanceSummaries(
  summaries: ProviderTripSummary[],
  assetsById: Map<string, AssetMatch>,
  companyId: string
) {
  const result = {
    rows_written: 0,
    rows_updated: 0,
    asset_distance_updates: 0,
    table_missing: false,
    fleet_asset_columns_missing: false,
    errors: [] as string[],
  };

  for (const summary of summaries) {
    if (!summary.asset_id) continue;

    const writeResult = await upsertProviderTripSummary(summary);
    if (writeResult.tableMissing) {
      result.table_missing = true;
      break;
    }
    if (writeResult.error) {
      result.errors.push(writeResult.error);
      continue;
    }
    if (writeResult.updated) result.rows_updated += 1;
    else result.rows_written += 1;

    if (!result.fleet_asset_columns_missing) {
      const asset = assetsById.get(summary.asset_id);
      if (shouldUpdateAssetDistanceState(asset, summary)) {
        const assetResult = await updateFleetAssetDistanceState(summary, companyId, asset);
        if (assetResult.columnsMissing) {
          result.fleet_asset_columns_missing = true;
        } else if (assetResult.error) {
          result.errors.push(assetResult.error);
        } else {
          result.asset_distance_updates += 1;
        }
      }
    }
  }

  result.errors = result.errors.slice(0, 10);
  return result;
}

async function upsertProviderTripSummary(summary: ProviderTripSummary) {
  const payload = {
    company_id: summary.company_id,
    asset_id: summary.asset_id,
    provider_id: summary.provider_id,
    truck_id: summary.truck_id,
    provider_trip_key: summary.provider_trip_key,
    report_date: summary.report_date,
    start_time: summary.start_time,
    end_time: summary.end_time,
    start_location: summary.start_location,
    end_location: summary.end_location,
    start_odometer_km: summary.start_odometer_km,
    end_odometer_km: summary.end_odometer_km,
    odometer_delta_km: summary.odometer_delta_km,
    provider_mileage_km: summary.provider_mileage_km,
    motion_duration_minutes: summary.motion_duration_minutes,
    violations_count: summary.violations_count,
    distance_source: summary.distance_source,
    distance_quality: summary.distance_quality,
    metadata: summary.metadata,
    updated_at: new Date().toISOString(),
  };

  try {
    if (summary.provider_trip_key) {
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("provider_trip_summaries")
        .select("id")
        .eq("provider_id", summary.provider_id)
        .eq("provider_trip_key", summary.provider_trip_key)
        .limit(1)
        .maybeSingle();

      if (isMissingDistanceTableError(lookupError)) return { tableMissing: true };
      if (lookupError) return { error: lookupError.message };

      if (existing?.id) {
        const { error } = await supabaseAdmin
          .from("provider_trip_summaries")
          .update(payload)
          .eq("id", existing.id);
        if (isMissingDistanceTableError(error)) return { tableMissing: true };
        return { updated: true, error: error?.message || null };
      }
    }

    const { error } = await supabaseAdmin
      .from("provider_trip_summaries")
      .insert(payload);
    if (isMissingDistanceTableError(error)) return { tableMissing: true };
    return { updated: false, error: error?.message || null };
  } catch (err: any) {
    return { error: err.message || "Distance summary write failed" };
  }
}

async function updateFleetAssetDistanceState(
  summary: ProviderTripSummary,
  companyId: string,
  existingAsset?: AssetMatch
) {
  if (!summary.asset_id) return { error: null };

  const existingQuality =
    existingAsset?.distance_quality &&
    typeof existingAsset.distance_quality === "object" &&
    !Array.isArray(existingAsset.distance_quality)
      ? existingAsset.distance_quality
      : {};
  const payload = {
    odometer_health: summary.odometer_health,
    last_distance_update_at: new Date().toISOString(),
    distance_quality: {
      ...existingQuality,
      ...(summary.asset_distance_quality || {}),
      latest_provider_trip_key: summary.provider_trip_key,
      latest_report_date: summary.report_date,
    },
  };

  const { error } = await supabaseAdmin
    .from("fleet_assets")
    .update(payload)
    .eq("id", summary.asset_id)
    .eq("company_id", companyId);

  if (isMissingDistanceColumnError(error)) return { columnsMissing: true };
  return { error: error?.message || null };
}

function shouldUpdateAssetDistanceState(
  asset: AssetMatch | undefined,
  summary: ProviderTripSummary
) {
  if (!asset) return false;
  const existingHealth = String(asset.odometer_health || "unknown");
  return healthPriority(summary.odometer_health) >= healthPriority(existingHealth);
}

function healthPriority(value: string | null | undefined) {
  switch (String(value || "unknown")) {
    case "rollover_suspected":
    case "mismatch":
      return 4;
    case "static_zero":
    case "static_nonzero":
      return 3;
    case "valid":
      return 2;
    default:
      return 1;
  }
}

function incrementCount(target: Record<string, number>, key: string | null | undefined) {
  const safeKey = String(key || "unknown");
  target[safeKey] = (target[safeKey] || 0) + 1;
}

function safeFileName(value: any) {
  const text = String(value || "").trim();
  return text ? text.replace(/[^\w .-]/g, "").slice(0, 120) : null;
}

function isMissingColumnError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "PGRST204" ||
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}

function isMissingDistanceTableError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("provider_trip_summaries") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

function isMissingDistanceColumnError(error: any) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "PGRST204" ||
    message.includes("odometer_health") ||
    message.includes("distance_quality") ||
    message.includes("last_distance_update_at") ||
    message.includes("schema cache") ||
    message.includes("column")
  );
}
