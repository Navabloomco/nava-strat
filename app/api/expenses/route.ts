import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | { company: ResolvedCompany; isPlatformOwner: boolean; error?: never }
  | { error: NextResponse; company?: never; isPlatformOwner?: never };

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
  const isPlatformOwner = activeMemberships.some(
    (membership) => membership.role === "platform_owner"
  );

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

    return { company: company as ResolvedCompany, isPlatformOwner };
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

  return { company: company as ResolvedCompany, isPlatformOwner };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const { data: journeys, error } = await supabaseAdmin
      .from("journeys")
      .select("*")
      .eq("company_id", resolved.company.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      journeys: journeys || [],
    });
  } catch (err: any) {
    console.error("Expenses GET error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load expense data" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const resolved = await resolveCompany(req, body.companyId || null);
    if (resolved.error) return resolved.error;

    const journeyId = body.journey_id || null;
    if (journeyId) {
      const { data: journey, error: journeyError } = await supabaseAdmin
        .from("journeys")
        .select("id")
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .eq("id", journeyId)
        .maybeSingle();

      if (journeyError) throw journeyError;
      if (!journey) {
        return NextResponse.json(
          { success: false, error: "Journey not found" },
          { status: 404 }
        );
      }
    }

    const amount = Number(body.amount || 0);
    const truck =
      typeof body.truck === "string" ? body.truck.trim().toUpperCase() : "";
    const reference =
      typeof body.reference_number === "string"
        ? body.reference_number.trim()
        : "";

    if (!truck || !amount || !body.expense_type || !body.payment_method || !reference) {
      return NextResponse.json(
        {
          success: false,
          error: "Truck, amount, expense type, payment method, and reference are required",
        },
        { status: 400 }
      );
    }

    const { data: expense, error } = await supabaseAdmin
      .from("expenses")
      .insert({
        company_id: resolved.company.id,
        journey_id: journeyId,
        truck,
        expense_type: body.expense_type,
        amount,
        vendor:
          typeof body.vendor === "string"
            ? body.vendor.trim().toUpperCase()
            : body.vendor || null,
        payment_method: body.payment_method,
        reference_number: reference,
        trip_reference:
          typeof body.trip_reference === "string"
            ? body.trip_reference.trim().toUpperCase()
            : body.trip_reference || null,
        notes: body.notes || null,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      expense,
    });
  } catch (err: any) {
    console.error("Expenses POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save expense" },
      { status: 500 }
    );
  }
}
