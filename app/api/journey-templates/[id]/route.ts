import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { supabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MANAGE_ROLES = new Set(["platform_owner", "owner", "admin"]);

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

function sanitizeTemplate(template: any) {
  return {
    id: template.id,
    name: template.name || null,
    client_name: template.client_name || null,
    from_location: template.from_location || null,
    to_location: template.to_location || null,
    expected_fuel_liters:
      template.expected_fuel_liters === null ||
      template.expected_fuel_liters === undefined
        ? null
        : Number(template.expected_fuel_liters),
    is_active: template.is_active !== false,
    created_at: template.created_at || null,
    updated_at: template.updated_at || null,
  };
}

function badRequestStatus(err: any) {
  const message = String(err?.message || "");
  return message.includes("required") ||
    message.includes("must") ||
    message.includes("Invalid") ||
    message.includes("No valid")
    ? 400
    : 500;
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeTemplateUpdate(body: any) {
  const updates: Record<string, any> = {};

  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (name) updates.name = name;
  }

  if (body.client_name !== undefined) {
    const clientName = normalizeText(body.client_name);
    if (!clientName) throw new Error("Client name is required");
    updates.client_name = clientName;
  }

  if (body.from_location !== undefined) {
    const fromLocation = normalizeText(body.from_location);
    if (!fromLocation) throw new Error("From location is required");
    updates.from_location = fromLocation;
  }

  if (body.to_location !== undefined) {
    const toLocation = normalizeText(body.to_location);
    if (!toLocation) throw new Error("To location is required");
    updates.to_location = toLocation;
  }

  if (body.expected_fuel_liters !== undefined) {
    const rawFuel = body.expected_fuel_liters;
    if (rawFuel === null || rawFuel === "") {
      updates.expected_fuel_liters = null;
    } else {
      const fuel = Number(rawFuel);
      if (!Number.isFinite(fuel) || fuel <= 0) {
        throw new Error("Expected fuel must be a positive number");
      }
      updates.expected_fuel_liters = fuel;
    }
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No valid updates provided");
  }

  updates.updated_at = new Date().toISOString();

  return updates;
}

async function resolveTemplateAccess(
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
        { success: false, error: "Saved route management access required" },
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
        { success: false, error: "Saved route management access required" },
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

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const resolved = await resolveTemplateAccess(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("journey_templates")
      .select("id, company_id")
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return noStoreJson(
        { success: false, error: "Saved route not found" },
        { status: 404 }
      );
    }

    const updates = normalizeTemplateUpdate(body);

    const { data: template, error: updateError } = await supabaseAdmin
      .from("journey_templates")
      .update(updates)
      .eq("company_id", resolved.company.id)
      .eq("id", params.id)
      .select(
        "id, name, client_name, from_location, to_location, expected_fuel_liters, is_active, created_at, updated_at"
      )
      .single();

    if (updateError) throw updateError;

    return noStoreJson({
      success: true,
      template: sanitizeTemplate(template),
    });
  } catch (err: any) {
    console.error("Journey template PATCH error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to update saved route" },
      { status: badRequestStatus(err) }
    );
  }
}
