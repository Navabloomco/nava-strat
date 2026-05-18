import { NextResponse } from "next/server";
import { supabase } from "../../../../../lib/supabase";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANAGE_ROLES = new Set(["owner", "admin", "platform_owner"]);

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
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

function sanitizeProvider(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    default_price_per_liter:
      provider.current_price_per_liter === null ||
      provider.current_price_per_liter === undefined
        ? null
        : Number(provider.current_price_per_liter),
    is_active: provider.is_active !== false,
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("must") ||
    message.includes("Invalid")
    ? 400
    : 500;
}

function normalizeProviderUpdate(body: any) {
  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    updates.name = name;
  }

  if (body.default_price_per_liter !== undefined) {
    const rawPrice = body.default_price_per_liter;
    if (rawPrice === null || rawPrice === "") {
      updates.current_price_per_liter = null;
    } else {
      const price = Number(rawPrice);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error("Default price per liter must be a positive number");
      }
      updates.current_price_per_liter = price;
    }
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No valid updates provided");
  }

  return updates;
}

async function resolveFuelProviderAccess(
  req: Request,
  requestedCompanyId?: string | null
) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return {
      error: noStoreJson(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
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
  const hasManageRole =
    isPlatformOwner || roles.some((role) => MANAGE_ROLES.has(role));

  if (!hasManageRole) {
    return {
      error: noStoreJson(
        { success: false, error: "Fuel provider management access required" },
        { status: 403 }
      ),
    };
  }

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin.from("companies").select("id, name, slug");
    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).maybeSingle()
      : await companyQuery.order("name", { ascending: true }).limit(1).maybeSingle();

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
      company: company as ResolvedCompany,
      userId: user.id,
      roles,
      isPlatformOwner,
    };
  }

  const membership = activeMemberships.find((item) =>
    MANAGE_ROLES.has(String(item.role || "").toLowerCase())
  );
  const companyId = membership?.company_id;

  if (!companyId) {
    return {
      error: noStoreJson(
        { success: false, error: "Fuel provider management access required" },
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
      error: noStoreJson(
        { success: false, error: "Unable to resolve company access" },
        { status: 403 }
      ),
    };
  }

  return {
    company: company as ResolvedCompany,
    userId: user.id,
    roles,
    isPlatformOwner,
  };
}

async function selectFuelProviderById(companyId: string, id: string) {
  const baseSelect =
    "id, name, current_price_per_liter, is_active, created_at";
  const withUpdatedAt = `${baseSelect}, updated_at`;

  const result = await supabaseAdmin
    .from("fuel_providers")
    .select(withUpdatedAt)
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();

  if (!result.error) return result;

  const message = String(result.error.message || "");
  if (!message.includes("updated_at")) return result;

  return supabaseAdmin
    .from("fuel_providers")
    .select(baseSelect)
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveFuelProviderAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("fuel_providers")
      .select("id, company_id")
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Fuel provider not found" },
        { status: 404 }
      );
    }

    const updates = normalizeProviderUpdate(body);

    const { error: updateError } = await supabaseAdmin
      .from("fuel_providers")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id);

    if (updateError) throw updateError;

    const { data: provider, error: providerError } =
      await selectFuelProviderById(resolved.company.id, params.id);

    if (providerError) throw providerError;
    if (!provider) {
      return noStoreJson(
        { success: false, error: "Fuel provider not found" },
        { status: 404 }
      );
    }

    return noStoreJson({
      success: true,
      fuel_provider: sanitizeProvider(provider),
    });
  } catch (err: any) {
    console.error("Fuel provider PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update fuel provider" },
      { status: badRequestStatus(err) }
    );
  }
}
