import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

function normalizeKey(value: any, fallback: string) {
  return String(value || fallback).trim().toUpperCase();
}

function sumByJourney(rows: any[], journeyId: string, field: string) {
  return rows
    .filter((row) => row.journey_id === journeyId)
    .reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function addGroupedMetric(groups: Record<string, any>, key: string, values: any) {
  if (!groups[key]) {
    groups[key] = {
      name: key,
      revenue: 0,
      fuelCost: 0,
      expenseCost: 0,
      totalCost: 0,
      profit: 0,
      margin: 0,
      count: 0,
    };
  }

  groups[key].revenue += values.revenue;
  groups[key].fuelCost += values.fuelCost;
  groups[key].expenseCost += values.expenseCost;
  groups[key].totalCost += values.totalCost;
  groups[key].profit += values.profit;
  groups[key].margin += values.profit;
  groups[key].count += 1;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const resolved = await resolveCompany(req, searchParams.get("companyId"));
    if (resolved.error) return resolved.error;

    const [journeysResult, fuelResult, expensesResult] = await Promise.all([
      supabaseAdmin
        .from("journeys")
        .select("*")
        .eq("company_id", resolved.company.id)
        .eq("is_demo", false)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("fuel_logs")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("expenses")
        .select("*")
        .eq("company_id", resolved.company.id)
        .order("created_at", { ascending: false }),
    ]);

    if (journeysResult.error) throw journeysResult.error;
    if (fuelResult.error) throw fuelResult.error;
    if (expensesResult.error) throw expensesResult.error;

    const journeys = journeysResult.data || [];
    const nonDemoJourneyIds = new Set(journeys.map((journey) => journey.id));
    const fuelLogs = (fuelResult.data || []).filter(
      (fuel) => !fuel.journey_id || nonDemoJourneyIds.has(fuel.journey_id)
    );
    const expenses = (expensesResult.data || []).filter(
      (expense) => !expense.journey_id || nonDemoJourneyIds.has(expense.journey_id)
    );

    const journeyPerformance = journeys.map((journey) => {
      const revenue = Number(journey.revenue_kes || 0);
      const fuelCost = sumByJourney(fuelLogs, journey.id, "total_cost");
      const expenseCost = sumByJourney(expenses, journey.id, "amount");
      const totalCost = fuelCost + expenseCost;
      const profit = revenue - totalCost;

      return {
        id: journey.id,
        truck: journey.truck || null,
        driver: journey.driver || null,
        client_name: journey.client_name || null,
        from_location: journey.from_location || null,
        to_location: journey.to_location || null,
        status: journey.status || null,
        revenue,
        fuelCost,
        expenseCost,
        totalCost,
        margin: profit,
        profit,
      };
    });

    const clientGroups: Record<string, any> = {};
    const truckGroups: Record<string, any> = {};

    for (const journey of journeyPerformance) {
      addGroupedMetric(
        clientGroups,
        normalizeKey(journey.client_name, "NO CLIENT"),
        journey
      );
      addGroupedMetric(
        truckGroups,
        normalizeKey(journey.truck, "NO TRUCK"),
        journey
      );
    }

    const totalRevenue = journeyPerformance.reduce(
      (sum, journey) => sum + journey.revenue,
      0
    );
    const totalFuelCost = fuelLogs.reduce(
      (sum, fuel) => sum + Number(fuel.total_cost || 0),
      0
    );
    const totalExpenses = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );
    const estimatedProfit = totalRevenue - totalFuelCost - totalExpenses;
    const activeJourneys = journeys.filter(
      (journey) => String(journey.status || "").toLowerCase() === "active"
    );
    const completedJourneys = journeys.filter((journey) => {
      const status = String(journey.status || "").toLowerCase();
      return status === "completed" || status === "delivered" || status === "offloaded";
    });

    const revenueByClient = Object.values(clientGroups).sort(
      (a: any, b: any) => b.revenue - a.revenue
    );
    const profitByClient = Object.values(clientGroups).sort(
      (a: any, b: any) => b.profit - a.profit
    );
    const costByClient = Object.values(clientGroups).sort(
      (a: any, b: any) => b.totalCost - a.totalCost
    );
    const truckProfitability = Object.values(truckGroups).sort(
      (a: any, b: any) => b.profit - a.profit
    );

    return NextResponse.json({
      success: true,
      company: resolved.company,
      is_platform_owner: resolved.isPlatformOwner,
      journeys,
      fuel_logs: fuelLogs,
      expenses,
      summary: {
        total_revenue: totalRevenue,
        total_fuel_cost: totalFuelCost,
        total_expenses: totalExpenses,
        estimated_profit: estimatedProfit,
        active_journeys: activeJourneys.length,
        completed_journeys: completedJourneys.length,
        loss_making_journeys: journeyPerformance.filter(
          (journey) => journey.profit < 0
        ).length,
      },
      journey_ranking: [...journeyPerformance].sort(
        (a, b) => a.profit - b.profit
      ),
      revenue_by_client: revenueByClient,
      cost_by_client: costByClient,
      profit_by_client: profitByClient,
      truck_profitability: truckProfitability,
      least_profitable_trucks: [...truckProfitability]
        .sort((a: any, b: any) => a.profit - b.profit)
        .slice(0, 10),
      least_profitable_clients: [...profitByClient]
        .sort((a: any, b: any) => a.profit - b.profit)
        .slice(0, 10),
    });
  } catch (err: any) {
    console.error("Management dashboard error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load management dashboard" },
      { status: 500 }
    );
  }
}
