import { buildTripIntelligenceSummary } from "./tripIntelligence";

type ProfitabilityOptions = {
  range?: string | null;
  company?: any;
  roles?: string[];
};

const ACTIVE_STATUSES = new Set([
  "active",
  "open",
  "in_progress",
  "in progress",
  "en_route",
  "en route",
  "loading",
  "in_transit",
  "in transit",
]);

const CLOSED_STATUSES = new Set([
  "completed",
  "delivered",
  "offloaded",
  "closed",
  "done",
]);

export async function getCompanyProfitability(
  companyId: string,
  options: ProfitabilityOptions = {}
) {
  const tripIntelligence = await buildTripIntelligenceSummary({
    companyId,
    company: options.company,
    range: options.range || "7d",
    roles: options.roles || [],
    includeFinance: true,
  });

  const trips = tripIntelligence.trips || [];
  const velocityTrips = trips.map((trip: any) =>
    buildTripVelocityRecord(trip, tripIntelligence.generated_at)
  );
  const contributionReadyTrips = velocityTrips.filter((trip) => trip.contribution_review_ready);
  const tripsWithDuration = contributionReadyTrips.filter(
    (trip) => trip.duration_days !== null && trip.duration_days > 0
  );
  const clientVelocity = buildClientVelocity(contributionReadyTrips);
  const delaySummary = buildDelaySummary(velocityTrips);

  const totalRevenue = sum(contributionReadyTrips, "revenue_amount");
  const linkedFuelCost = sum(contributionReadyTrips, "linked_fuel_cost");
  const linkedExpenseCost = sum(contributionReadyTrips, "linked_expense_cost");
  const linkedVariableCost = sum(contributionReadyTrips, "linked_variable_cost");
  const totalContribution = sum(contributionReadyTrips, "contribution_amount");
  const totalDurationDays = tripsWithDuration.reduce(
    (total, trip) => total + Number(trip.duration_days || 0),
    0
  );

  return {
    timeframe: tripIntelligence.timeframe,
    generated_at: tripIntelligence.generated_at,
    data_sources: tripIntelligence.data_sources,
    evidence_caveats: [
      "Contribution is linked revenue minus allocated fuel cost and linked trip expenses; it is not final audited financial close.",
      "Contribution per day is cycle-time intelligence and is provisional for active/open Trips.",
      "Client-caused delay is shown only when delay evidence explicitly links waiting/delay to client or customer context.",
    ],
    summary: {
      selected_period: tripIntelligence.timeframe?.display_label || null,
      trip_count: velocityTrips.length,
      trips_reviewed: contributionReadyTrips.length,
      trips_needing_review: velocityTrips.length - contributionReadyTrips.length,
      review_ready_contribution: roundMoney(totalContribution),
      total_revenue: roundMoney(totalRevenue),
      linked_fuel_cost: roundMoney(linkedFuelCost),
      linked_expense_cost: roundMoney(linkedExpenseCost),
      linked_variable_cost: roundMoney(linkedVariableCost),
      average_contribution_per_day:
        totalDurationDays > 0 ? roundMoney(totalContribution / totalDurationDays) : null,
      duration_available_trips: tripsWithDuration.length,
      provisional_active_trips: contributionReadyTrips.filter((trip) => trip.provisional).length,
      trips_with_delay_evidence: velocityTrips.filter((trip) => trip.delay_evidence_present).length,
    },
    trip_velocity_ranking: [...contributionReadyTrips].sort(compareTripVelocity).slice(0, 25),
    trips_needing_review: velocityTrips
      .filter((trip) => !trip.contribution_review_ready)
      .slice(0, 25),
    client_contribution_velocity: clientVelocity,
    delay_summary: delaySummary,
    trip_intelligence_summary: tripIntelligence.summary,
    missing_data_summary: tripIntelligence.missing_data_summary,
  };
}

function buildTripVelocityRecord(trip: any, generatedAt: string) {
  const identity = trip.trip_identity || {};
  const finance = trip.finance_evidence || {};
  const readiness = trip.profitability_readiness || {};
  const contribution = readiness.contribution_summary || {};
  const delay = trip.delay_evidence || {};
  const duration = calculateTripDuration(identity, generatedAt);
  const contributionAmount = numericOrNull(contribution.contribution_amount);
  const contributionReviewReady =
    Boolean(contribution.ready_for_contribution_review) && contributionAmount !== null;
  const contributionPerDay =
    contributionReviewReady && duration?.duration_days
      ? roundMoney(Number(contributionAmount) / duration.duration_days)
      : null;
  const estimatedTripsPerWeek =
    duration?.duration_days && duration.duration_days > 0
      ? roundMetric(7 / duration.duration_days)
      : null;

  return {
    id: identity.journey_id,
    trip_id: identity.journey_id,
    reference: identity.reference || identity.internal_trip_id || identity.journey_id,
    internal_trip_id: identity.internal_trip_id || null,
    truck: identity.truck || null,
    client_name: identity.client_name || null,
    route: identity.route?.route_label || null,
    from_location: identity.route?.from_location || null,
    to_location: identity.route?.to_location || null,
    status: identity.status || null,
    start_time: identity.start_time || null,
    end_time: identity.end_time || null,
    revenue_amount: numericOrZero(contribution.revenue_amount ?? finance.revenue_kes),
    linked_fuel_cost: numericOrZero(contribution.linked_fuel_cost ?? finance.linked_fuel_cost_kes),
    linked_expense_cost: numericOrZero(
      contribution.linked_expense_cost ?? finance.linked_expense_cost_kes
    ),
    linked_variable_cost: numericOrZero(
      contribution.linked_variable_cost ?? finance.linked_variable_costs_kes
    ),
    contribution_amount: contributionReviewReady ? roundMoney(contributionAmount) : null,
    contribution_margin_percent: numericOrNull(contribution.contribution_margin_percent),
    contribution_review_ready: contributionReviewReady,
    readiness_label: readiness.customer_label || readiness.label || "Not enough linked data",
    duration_days: duration?.duration_days ?? null,
    duration_label: duration?.label || "Duration pending",
    duration_basis: duration?.basis || "missing_start_time",
    provisional: Boolean(duration?.provisional),
    contribution_per_day: contributionPerDay,
    estimated_trips_per_week: estimatedTripsPerWeek,
    delay_evidence_present: Boolean(delay.delay_evidence_present),
    delay_minutes: numericOrNull(delay.total_delay_minutes ?? delay.stopped_minutes),
    delay_categories: Array.isArray(delay.delay_categories) ? delay.delay_categories : [],
    delay_attribution_note: delay.delay_evidence_present
      ? "Delay evidence is separated by cause and source; GPS-stopped time is not engine-on idle proof."
      : "No delay evidence linked in this period.",
    caveats: contribution.caveats || readiness.supporting_notes || [],
    management_flags: trip.management_flags || [],
    missing_data: trip.missing_data || [],
  };
}

function calculateTripDuration(identity: any, generatedAt: string) {
  const startMs = timestampMs(identity.start_time);
  if (!startMs) return null;

  const status = String(identity.status || "").toLowerCase();
  const endMs = timestampMs(identity.end_time);
  let effectiveEndMs: number | null = null;
  let provisional = false;
  let basis = "start_time_to_end_time";

  if (endMs && endMs >= startMs) {
    effectiveEndMs = endMs;
  } else if (ACTIVE_STATUSES.has(status) || !CLOSED_STATUSES.has(status)) {
    effectiveEndMs = timestampMs(generatedAt) || Date.now();
    provisional = true;
    basis = "active_trip_start_time_to_now";
  }

  if (!effectiveEndMs || effectiveEndMs <= startMs) return null;

  const durationDays = roundMetric((effectiveEndMs - startMs) / (24 * 60 * 60 * 1000));
  if (durationDays <= 0) return null;

  return {
    duration_days: durationDays,
    label: `${durationDays.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })} day${durationDays === 1 ? "" : "s"}${provisional ? " so far" : ""}`,
    basis,
    provisional,
  };
}

function buildClientVelocity(trips: any[]) {
  const groups = new Map<string, any>();

  for (const trip of trips) {
    const key = String(trip.client_name || "Client missing").trim() || "Client missing";
    const group =
      groups.get(key) || {
        name: key,
        trip_count: 0,
        trips_with_duration: 0,
        total_contribution: 0,
        total_duration_days: 0,
        provisional_trip_count: 0,
      };

    group.trip_count += 1;
    group.total_contribution += Number(trip.contribution_amount || 0);
    if (trip.duration_days) {
      group.trips_with_duration += 1;
      group.total_duration_days += Number(trip.duration_days || 0);
    }
    if (trip.provisional) group.provisional_trip_count += 1;
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const averageDuration =
        group.trips_with_duration > 0
          ? group.total_duration_days / group.trips_with_duration
          : null;
      return {
        ...group,
        total_contribution: roundMoney(group.total_contribution),
        average_contribution_per_trip:
          group.trip_count > 0 ? roundMoney(group.total_contribution / group.trip_count) : null,
        average_duration_days: averageDuration ? roundMetric(averageDuration) : null,
        average_contribution_per_day:
          group.total_duration_days > 0
            ? roundMoney(group.total_contribution / group.total_duration_days)
            : null,
        estimated_trips_per_week: averageDuration ? roundMetric(7 / averageDuration) : null,
      };
    })
    .sort(
      (a, b) =>
        sortableNumber(b.average_contribution_per_day) -
          sortableNumber(a.average_contribution_per_day) ||
        Number(b.total_contribution || 0) - Number(a.total_contribution || 0)
    )
    .slice(0, 25);
}

function buildDelaySummary(trips: any[]) {
  const categories = new Map<string, any>();

  for (const trip of trips) {
    const tripCategories = Array.isArray(trip.delay_categories) ? trip.delay_categories : [];
    if (trip.delay_evidence_present && tripCategories.length === 0) {
      tripCategories.push({
        category: "unknown",
        label: "Unknown",
        duration_minutes: trip.delay_minutes,
        event_count: 0,
        attribution: "unknown",
      });
    }

    for (const category of tripCategories) {
      const key = category.category || "unknown";
      const existing =
        categories.get(key) || {
          category: key,
          label: category.label || "Unknown",
          attribution: category.attribution || "unknown",
          evidence_label: category.evidence_label || null,
          trip_count: 0,
          event_count: 0,
          duration_minutes: 0,
        };
      existing.trip_count += 1;
      existing.event_count += Number(category.event_count || 0);
      existing.duration_minutes += Number(category.duration_minutes || 0);
      categories.set(key, existing);
    }
  }

  return {
    categories: Array.from(categories.values())
      .map((category) => ({
        ...category,
        duration_minutes:
          category.duration_minutes > 0 ? Math.round(category.duration_minutes) : null,
        duration_hours:
          category.duration_minutes > 0 ? roundMetric(category.duration_minutes / 60) : null,
        client_blame_allowed: category.category === "client_waiting",
      }))
      .sort(
        (a, b) =>
          Number(b.duration_minutes || 0) - Number(a.duration_minutes || 0) ||
          Number(b.trip_count || 0) - Number(a.trip_count || 0)
      ),
    caveat:
      "GPS-stopped time and provider idle markers are operational drag evidence, not true engine-on idle or fuel-burn proof. Client attribution requires explicit client/customer waiting evidence.",
  };
}

function compareTripVelocity(a: any, b: any) {
  const aVelocity = a.contribution_per_day;
  const bVelocity = b.contribution_per_day;
  if (aVelocity !== null && bVelocity !== null) return Number(bVelocity) - Number(aVelocity);
  if (aVelocity !== null) return -1;
  if (bVelocity !== null) return 1;
  return Number(b.contribution_amount || 0) - Number(a.contribution_amount || 0);
}

function sum(rows: any[], field: string) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function timestampMs(value: any) {
  if (!value) return null;
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numericOrNull(value: any) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericOrZero(value: any) {
  const number = numericOrNull(value);
  return number === null ? 0 : roundMoney(number);
}

function roundMetric(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function roundMoney(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function sortableNumber(value: any) {
  if (value === null || value === undefined || value === "") return -Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : -Infinity;
}
