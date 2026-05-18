import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CheckStatus = "pass" | "warn" | "fail";

type HealthCheck = {
  category: "Environment" | "Tables/Columns" | "Constraints/RPCs";
  name: string;
  status: CheckStatus;
  detail: string;
};

type RequiredTable = {
  table: string;
  columns: string[];
};

const REQUIRED_TABLES: RequiredTable[] = [
  {
    table: "companies",
    columns: [
      "id",
      "name",
      "slug",
      "subscription_plan",
      "business_type",
      "primary_asset_types",
      "main_billing_unit",
      "operating_regions",
      "primary_use_case",
      "asset_unit_price",
      "billing_currency",
      "included_assets",
    ],
  },
  {
    table: "company_users",
    columns: ["user_id", "company_id", "role", "is_active"],
  },
  {
    table: "fleet_assets",
    columns: [
      "id",
      "company_id",
      "provider_id",
      "provider_name",
      "truck_id",
      "registration",
      "status",
      "asset_category",
      "billing_status",
      "intelligence_enabled",
      "provider_location_label",
      "first_seen_at",
      "last_seen_at",
      "updated_at",
      "latitude",
      "longitude",
    ],
  },
  {
    table: "telemetry_logs",
    columns: [
      "id",
      "company_id",
      "provider_id",
      "truck_id",
      "latitude",
      "longitude",
      "speed",
      "recorded_at",
    ],
  },
  {
    table: "telemetry_events",
    columns: [
      "id",
      "company_id",
      "truck_id",
      "event_type",
      "latitude",
      "longitude",
      "context_type",
      "context_label",
      "context_note",
      "context_applied_by",
      "context_applied_at",
    ],
  },
  {
    table: "tracking_providers",
    columns: [
      "id",
      "company_id",
      "provider_name",
      "provider_slug",
      "is_active",
      "last_sync_at",
    ],
  },
  {
    table: "client_visibility_links",
    columns: [],
  },
  {
    table: "drivers",
    columns: [
      "id",
      "company_id",
      "full_name",
      "phone",
      "employee_code",
      "license_number",
      "license_expiry",
      "status",
      "notes",
    ],
  },
  {
    table: "asset_driver_assignments",
    columns: [
      "id",
      "company_id",
      "asset_id",
      "truck_id",
      "driver_id",
      "driver_name",
      "journey_id",
      "assigned_from",
      "assigned_to",
      "assignment_status",
    ],
  },
  {
    table: "fuel_providers",
    columns: ["id", "company_id", "name", "default_price_per_liter", "is_active"],
  },
  {
    table: "journey_templates",
    columns: [
      "id",
      "company_id",
      "name",
      "client_name",
      "from_location",
      "to_location",
      "expected_fuel_liters",
      "is_active",
    ],
  },
  {
    table: "spare_lifecycle_events",
    columns: [
      "id",
      "company_id",
      "event_type",
      "event_at",
      "part_name",
      "quantity",
      "asset_id",
      "truck_id",
      "vendor_name",
      "mechanic_name",
      "cost",
    ],
  },
  {
    table: "spare_catalog_parts",
    columns: [
      "id",
      "company_id",
      "name",
      "category",
      "brand",
      "model",
      "part_number",
      "retreadable",
      "max_retreads",
      "is_active",
    ],
  },
  {
    table: "truck_route_fuel_profiles",
    columns: [
      "company_id",
      "truck",
      "from_location",
      "to_location",
      "avg_fuel_liters",
      "trip_count",
    ],
  },
];

const OPTIONAL_COLUMN_CHECKS = [
  {
    table: "fuel_providers",
    column: "current_price_per_liter",
    detail:
      "Pilot checklist names current_price_per_liter; current app code uses default_price_per_liter.",
  },
  {
    table: "truck_route_fuel_profiles",
    column: "route_key",
    detail:
      "Pilot checklist names route_key; current fuel profile code matches from_location and to_location.",
  },
];

const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 5000;

function noStoreJson(body: any, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeError(error: any) {
  return String(error?.message || error?.details || error || "Unknown error");
}

function present(value: string | undefined, placeholder?: string) {
  return Boolean(value && value.trim() && value !== placeholder);
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  timeoutValue: T
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );

  return results;
}

function buildEnvironmentChecks(): HealthCheck[] {
  const envs = [
    {
      name: "CRON_SECRET",
      value: process.env.CRON_SECRET,
      statusWhenMissing: "fail" as CheckStatus,
      detail:
        "Required for provider sync and Nava Eye event cron routes to run during pilot.",
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      value: process.env.NEXT_PUBLIC_SUPABASE_URL,
      statusWhenMissing: "fail" as CheckStatus,
      detail: "Required by browser and server Supabase clients.",
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      statusWhenMissing: "fail" as CheckStatus,
      detail: "Required by browser Supabase auth/session flows.",
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY,
      placeholder: "placeholder-service-role-key",
      statusWhenMissing: "fail" as CheckStatus,
      detail: "Required by secured API routes and provider sync server logic.",
    },
    {
      name: "NEXT_PUBLIC_SITE_URL",
      value: process.env.NEXT_PUBLIC_SITE_URL,
      statusWhenMissing: "warn" as CheckStatus,
      detail:
        "Used as a fallback when generating client visibility links outside a normal request origin.",
    },
  ];

  return envs.map((env) => {
    const isPresent = present(env.value, env.placeholder);
    return {
      category: "Environment",
      name: env.name,
      status: isPresent ? "pass" : env.statusWhenMissing,
      detail: isPresent ? "Configured. Value hidden." : env.detail,
    };
  });
}

async function probeTable(table: string): Promise<any> {
  return withTimeout<any>(
    supabaseAdmin
      .from(table)
      .select("*", { head: true, count: "exact" })
      .limit(0)
      .then(({ error }) => error),
    PROBE_TIMEOUT_MS,
    { message: `Timed out checking ${table}` }
  );
}

async function probeColumn(table: string, column: string): Promise<any> {
  return withTimeout<any>(
    supabaseAdmin
      .from(table)
      .select(column, { head: true })
      .limit(0)
      .then(({ error }) => error),
    PROBE_TIMEOUT_MS,
    { message: `Timed out checking ${table}.${column}` }
  );
}

async function buildTableColumnChecks(): Promise<HealthCheck[]> {
  type ProbeTask =
    | { kind: "table"; table: string }
    | {
        kind: "column";
        table: string;
        column: string;
        optional?: boolean;
        optionalDetail?: string;
      };

  const tasks: ProbeTask[] = [];

  for (const required of REQUIRED_TABLES) {
    tasks.push({ kind: "table", table: required.table });
    for (const column of required.columns) {
      tasks.push({ kind: "column", table: required.table, column });
    }
  }

  for (const check of OPTIONAL_COLUMN_CHECKS) {
    tasks.push({
      kind: "column",
      table: check.table,
      column: check.column,
      optional: true,
      optionalDetail: check.detail,
    });
  }

  return runLimited(tasks, PROBE_CONCURRENCY, async (task) => {
    if (task.kind === "table") {
      const tableError = await probeTable(task.table);
      return {
        category: "Tables/Columns",
        name: `${task.table} table`,
        status: tableError ? "fail" : "pass",
        detail: tableError
          ? `Missing, inaccessible, or slow table: ${sanitizeError(tableError)}`
          : "Table is reachable.",
      } as HealthCheck;
    }

    const columnError = await probeColumn(task.table, task.column);
    return {
      category: "Tables/Columns",
      name: `${task.table}.${task.column}`,
      status: columnError ? (task.optional ? "warn" : "fail") : "pass",
      detail: columnError
        ? task.optional
          ? task.optionalDetail || `Optional column unavailable: ${sanitizeError(columnError)}`
          : `Missing, inaccessible, or slow column: ${sanitizeError(columnError)}`
        : "Column is reachable.",
    } as HealthCheck;
  });
}

async function checkFleetAssetsUniqueIndex(): Promise<HealthCheck> {
  const metadataErrors: string[] = [];

  try {
    const { data, error } = await withTimeout<any>(
      (supabaseAdmin as any)
      .schema("pg_catalog")
      .from("pg_indexes")
      .select("indexname,indexdef")
      .eq("schemaname", "public")
        .eq("tablename", "fleet_assets"),
      PROBE_TIMEOUT_MS,
      { data: null, error: { message: "Timed out checking pg_indexes" } }
    );

    if (error) throw error;

    const matchingIndex = (data || []).find((index: any) => {
      const definition = String(index.indexdef || "").toLowerCase();
      return (
        definition.includes("unique") &&
        definition.includes("provider_id") &&
        definition.includes("truck_id")
      );
    });

    if (matchingIndex) {
      return {
        category: "Constraints/RPCs",
        name: "fleet_assets(provider_id, truck_id) unique index",
        status: "pass",
        detail: `Found ${matchingIndex.indexname}.`,
      };
    }
  } catch (err) {
    metadataErrors.push(sanitizeError(err));
  }

  try {
    const { data: constraints, error: constraintError } = await withTimeout<any>(
      (supabaseAdmin as any)
      .schema("information_schema")
      .from("table_constraints")
      .select("constraint_name,constraint_type,table_schema,table_name")
      .eq("table_schema", "public")
      .eq("table_name", "fleet_assets")
        .eq("constraint_type", "UNIQUE"),
      PROBE_TIMEOUT_MS,
      {
        data: null,
        error: { message: "Timed out checking information_schema.table_constraints" },
      }
    );

    if (constraintError) throw constraintError;

    const constraintNames = (constraints || []).map((item: any) => item.constraint_name);
    if (constraintNames.length > 0) {
      const { data: columns, error: columnError } = await withTimeout<any>(
        (supabaseAdmin as any)
        .schema("information_schema")
        .from("key_column_usage")
        .select("constraint_name,column_name,ordinal_position")
        .eq("table_schema", "public")
        .eq("table_name", "fleet_assets")
          .in("constraint_name", constraintNames),
        PROBE_TIMEOUT_MS,
        {
          data: null,
          error: { message: "Timed out checking information_schema.key_column_usage" },
        }
      );

      if (columnError) throw columnError;

      for (const name of constraintNames) {
        const names = (columns || [])
          .filter((item: any) => item.constraint_name === name)
          .sort((a: any, b: any) => Number(a.ordinal_position) - Number(b.ordinal_position))
          .map((item: any) => item.column_name);

        if (names.includes("provider_id") && names.includes("truck_id")) {
          return {
            category: "Constraints/RPCs",
            name: "fleet_assets(provider_id, truck_id) unique constraint",
            status: "pass",
            detail: `Found ${name}.`,
          };
        }
      }
    }

    return {
      category: "Constraints/RPCs",
      name: "fleet_assets(provider_id, truck_id) unique constraint",
      status: "fail",
      detail:
        "No unique constraint/index for provider_id + truck_id was found. Provider sync upsert depends on it.",
    };
  } catch (err) {
    metadataErrors.push(sanitizeError(err));
  }

  return {
    category: "Constraints/RPCs",
    name: "fleet_assets(provider_id, truck_id) unique constraint",
    status: "warn",
    detail: `Could not inspect database metadata safely. Verify manually. Metadata errors: ${metadataErrors.join(
      " | "
    )}`,
  };
}

async function checkClientVisibilityRpc(): Promise<HealthCheck> {
  try {
    const { data, error } = await withTimeout<any>(
      (supabaseAdmin as any)
      .schema("information_schema")
      .from("routines")
      .select("routine_name,routine_schema")
      .eq("routine_schema", "public")
      .eq("routine_name", "record_client_visibility_link_access")
        .limit(1),
      PROBE_TIMEOUT_MS,
      { data: null, error: { message: "Timed out checking information_schema.routines" } }
    );

    if (error) throw error;

    const found = Array.isArray(data) && data.length > 0;
    return {
      category: "Constraints/RPCs",
      name: "record_client_visibility_link_access RPC",
      status: found ? "pass" : "warn",
      detail: found
        ? "Function is present."
        : "Function was not found. Client portal still works, but access counts will not update.",
    };
  } catch (err) {
    return {
      category: "Constraints/RPCs",
      name: "record_client_visibility_link_access RPC",
      status: "warn",
      detail: `Could not inspect routines safely. Verify manually. ${sanitizeError(err)}`,
    };
  }
}

function overallStatus(checks: HealthCheck[]): CheckStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

async function requirePlatformOwner(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("company_users")
    .select("company_id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) throw membershipError;

  const isPlatformOwner = (memberships || []).some(
    (membership) =>
      String(membership.role || "").trim().toLowerCase() === "platform_owner"
  );

  if (!isPlatformOwner) {
    return {
      error: noStoreJson(
        { success: false, error: "Platform owner access required" },
        { status: 403 }
      ),
    };
  }

  return { user };
}

export async function GET(req: Request) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const checks = [
      ...buildEnvironmentChecks(),
      ...(await buildTableColumnChecks()),
      await checkFleetAssetsUniqueIndex(),
      await checkClientVisibilityRpc(),
    ];

    return noStoreJson({
      success: true,
      overall_status: overallStatus(checks),
      checked_at: new Date().toISOString(),
      checks,
    });
  } catch (err: any) {
    console.error("Platform health check error:", err);
    return noStoreJson(
      {
        success: false,
        overall_status: "fail",
        checks: [
          {
            category: "Constraints/RPCs",
            name: "health check execution",
            status: "fail",
            detail: err.message || "Health check failed.",
          },
        ],
      },
      { status: 500 }
    );
  }
}
