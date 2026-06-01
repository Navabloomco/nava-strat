import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import {
  canEditExpenses,
  canEditJourneys,
  canViewExpenses,
  normalizeRole,
  rolesForCompany,
} from "../../../lib/api/roleAccess";
import { withExpenseTotalPaid, withExpenseTotals } from "../../../lib/finance/expenseTotals";

export const dynamic = "force-dynamic";

const SAFE_EXPENSE_JOURNEY_FIELDS =
  "id, internal_trip_id, client_name, truck, driver, from_location, to_location, status, created_at";
const SAFE_EXPENSE_FIELDS =
  "id, journey_id, truck, expense_type, amount, transaction_cost, vendor, payment_method, reference_number, trip_reference, notes, created_at";
const LEGACY_SAFE_EXPENSE_FIELDS =
  "id, journey_id, truck, expense_type, amount, vendor, payment_method, reference_number, trip_reference, notes, created_at";

type ResolvedCompany = {
  id: string;
  name: string;
  slug: string;
};

type ResolveCompanyResult =
  | {
      company: ResolvedCompany;
      isPlatformOwner: boolean;
      roles: string[];
      error?: never;
    }
  | {
      error: NextResponse;
      company?: never;
      isPlatformOwner?: never;
      roles?: never;
    };

function isMissingTransactionCostError(error: any) {
  const message = String(error?.message || error?.details || error?.hint || error || "").toLowerCase();
  return message.includes("transaction_cost") || message.includes("schema cache");
}

function parseNonNegativeMoney(value: any, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

async function loadExpenseRows(companyId: string) {
  const result = await supabaseAdmin
    .from("expenses")
    .select(SAFE_EXPENSE_FIELDS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!result.error) return withExpenseTotals(result.data || []);

  if (!isMissingTransactionCostError(result.error)) throw result.error;

  const legacyResult = await supabaseAdmin
    .from("expenses")
    .select(LEGACY_SAFE_EXPENSE_FIELDS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (legacyResult.error) throw legacyResult.error;
  return withExpenseTotals(legacyResult.data || []);
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
  const isPlatformOwner = activeMemberships.some(
    (membership) => normalizeRole(membership.role) === "platform_owner"
  );
  const normalizedRequestedCompanyId = requestedCompanyId?.trim() || null;

  if (isPlatformOwner) {
    const companyQuery = supabaseAdmin
      .from("companies")
      .select("id, name, slug");

    const { data: company, error: companyError } = normalizedRequestedCompanyId
      ? await companyQuery.eq("id", normalizedRequestedCompanyId).maybeSingle()
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
      isPlatformOwner,
      roles: rolesForCompany(activeMemberships, company.id, true),
    };
  }

  const companyId =
    normalizedRequestedCompanyId ||
    activeMemberships.map((membership) => membership.company_id).filter(Boolean)[0];

  if (
    !companyId ||
    !activeMemberships.some((membership) => membership.company_id === companyId)
  ) {
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
    isPlatformOwner,
    roles: rolesForCompany(activeMemberships, company.id),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;
    if (!canViewExpenses(resolved.roles)) {
      return NextResponse.json(
        { success: false, error: "Expense access required" },
        { status: 403 }
      );
    }

    const [journeysResult, expenseRows] = await Promise.all([
      supabaseAdmin
        .from("journeys")
        .select(SAFE_EXPENSE_JOURNEY_FIELDS)
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .order("created_at", { ascending: false }),
      loadExpenseRows(resolved.company.id),
    ]);

    if (journeysResult.error) throw journeysResult.error;

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      journeys: journeysResult.data || [],
      expenses: expenseRows,
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
    const canCreateTripExpense =
      Boolean(journeyId) && (canEditExpenses(resolved.roles) || canEditJourneys(resolved.roles));
    if (!canEditExpenses(resolved.roles) && !canCreateTripExpense) {
      return NextResponse.json(
        { success: false, error: "Expense edit access required" },
        { status: 403 }
      );
    }

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

    const amount = parseNonNegativeMoney(body.amount);
    const transactionCost = parseNonNegativeMoney(body.transaction_cost, 0);
    const truck =
      typeof body.truck === "string" ? body.truck.trim().toUpperCase() : "";
    const reference =
      typeof body.reference_number === "string"
        ? body.reference_number.trim()
        : "";

    if (
      !truck ||
      amount === null ||
      amount <= 0 ||
      transactionCost === null ||
      !body.expense_type ||
      !body.payment_method ||
      !reference
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Truck, positive amount, non-negative transaction fee, expense type, payment method, and reference are required",
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
        transaction_cost: transactionCost,
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
      .select(SAFE_EXPENSE_FIELDS)
      .single();

    if (error) {
      if (isMissingTransactionCostError(error)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Expense transaction fee setup is not applied yet. Apply the latest database migration before saving expenses with transaction fees.",
          },
          { status: 500 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      company: resolved.company,
      expense: withExpenseTotalPaid(expense || {}),
    });
  } catch (err: any) {
    console.error("Expenses POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save expense" },
      { status: 500 }
    );
  }
}
