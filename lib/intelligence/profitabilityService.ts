import { supabaseAdmin } from "../supabaseAdmin";

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

export async function getCompanyProfitability(companyId: string) {
  const [journeysResult, fuelResult, expensesResult] = await Promise.all([
    supabaseAdmin
      .from("journeys")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_demo", false)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("fuel_logs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("expenses")
      .select("*")
      .eq("company_id", companyId)
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

  const linkedFuelLogs = fuelLogs.filter((fuel) => fuel.journey_id);
  const linkedExpenses = expenses.filter((expense) => expense.journey_id);
  const unlinkedFuelCost = fuelLogs
    .filter((fuel) => !fuel.journey_id)
    .reduce((sum, fuel) => sum + Number(fuel.total_cost || 0), 0);
  const unlinkedExpenseCost = expenses
    .filter((expense) => !expense.journey_id)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  const journeyPerformance = journeys.map((journey) => {
    const revenue = Number(journey.revenue_kes || 0);
    const fuelCost = sumByJourney(linkedFuelLogs, journey.id, "total_cost");
    const expenseCost = sumByJourney(linkedExpenses, journey.id, "amount");
    const totalCost = fuelCost + expenseCost;
    const profit = revenue - totalCost;

    return {
      id: journey.id,
      truck: journey.truck || null,
      driver: journey.driver || null,
      client_name: journey.client_name || null,
      from_location: journey.from_location || null,
      to_location: journey.to_location || null,
      route:
        journey.from_location || journey.to_location
          ? `${journey.from_location || "UNKNOWN"} -> ${journey.to_location || "UNKNOWN"}`
          : "UNKNOWN ROUTE",
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
  const routeGroups: Record<string, any> = {};

  for (const journey of journeyPerformance) {
    addGroupedMetric(
      clientGroups,
      normalizeKey(journey.client_name, "NO CLIENT"),
      journey
    );
    addGroupedMetric(truckGroups, normalizeKey(journey.truck, "NO TRUCK"), journey);
    addGroupedMetric(routeGroups, normalizeKey(journey.route, "UNKNOWN ROUTE"), journey);
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
  const routeProfitability = Object.values(routeGroups).sort(
    (a: any, b: any) => b.profit - a.profit
  );

  return {
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
      unlinked_fuel_cost: unlinkedFuelCost,
      unlinked_expense_cost: unlinkedExpenseCost,
    },
    journey_ranking: [...journeyPerformance].sort((a, b) => a.profit - b.profit),
    revenue_by_client: revenueByClient,
    cost_by_client: costByClient,
    profit_by_client: profitByClient,
    truck_profitability: truckProfitability,
    route_profitability: routeProfitability,
    least_profitable_trucks: [...truckProfitability]
      .sort((a: any, b: any) => a.profit - b.profit)
      .slice(0, 10),
    most_profitable_trucks: [...truckProfitability]
      .sort((a: any, b: any) => b.profit - a.profit)
      .slice(0, 10),
    least_profitable_clients: [...profitByClient]
      .sort((a: any, b: any) => a.profit - b.profit)
      .slice(0, 10),
    most_profitable_clients: [...profitByClient]
      .sort((a: any, b: any) => b.profit - a.profit)
      .slice(0, 10),
    least_profitable_routes: [...routeProfitability]
      .sort((a: any, b: any) => a.profit - b.profit)
      .slice(0, 10),
    most_profitable_routes: [...routeProfitability]
      .sort((a: any, b: any) => b.profit - a.profit)
      .slice(0, 10),
  };
}
