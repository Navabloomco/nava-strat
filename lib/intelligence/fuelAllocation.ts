export type FuelAllocationStatus = "allocated" | "carried_forward" | "reversed";
export type FuelAllocationBasis =
  | "manual"
  | "expected_trip_standard"
  | "finance_review"
  | "legacy_journey_link";

export type FuelIssueLike = {
  id?: string | null;
  liters?: any;
  total_cost?: any;
};

export type FuelAllocationLike = {
  id?: string | null;
  fuel_log_id?: string | null;
  journey_id?: string | null;
  asset_id?: string | null;
  truck_text?: string | null;
  allocated_liters?: any;
  allocated_cost?: any;
  allocation_status?: any;
  allocation_basis?: any;
};

export type FuelIssueAllocationSummary = {
  fuel_log_id: string | null;
  issue_liters: number;
  issue_cost: number;
  allocated_liters: number;
  allocated_cost: number;
  carried_forward_liters: number;
  carried_forward_cost: number;
  reversed_liters: number;
  reversed_cost: number;
  consumed_liters: number;
  consumed_cost: number;
  remaining_liters: number;
  remaining_cost: number;
  allocation_count: number;
  carried_forward_count: number;
  reversed_count: number;
  over_allocated: boolean;
  status:
    | "unallocated"
    | "partially_allocated"
    | "fully_allocated"
    | "over_allocated";
};

const EPSILON = 0.0001;

const ALLOCATION_STATUSES = new Set<FuelAllocationStatus>([
  "allocated",
  "carried_forward",
  "reversed",
]);

const ALLOCATION_BASES = new Set<FuelAllocationBasis>([
  "manual",
  "expected_trip_standard",
  "finance_review",
  "legacy_journey_link",
]);

export function normalizeFuelAllocationStatus(value: any): FuelAllocationStatus {
  const text = String(value || "").trim().toLowerCase();
  return ALLOCATION_STATUSES.has(text as FuelAllocationStatus)
    ? (text as FuelAllocationStatus)
    : "allocated";
}

export function normalizeFuelAllocationBasis(value: any): FuelAllocationBasis {
  const text = String(value || "").trim().toLowerCase();
  return ALLOCATION_BASES.has(text as FuelAllocationBasis)
    ? (text as FuelAllocationBasis)
    : "manual";
}

export function toFuelNumber(value: any): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundFuelValue(value: any): number {
  const number = toFuelNumber(value);
  return Math.round(number * 100) / 100;
}

export function isReversedFuelAllocation(allocation: FuelAllocationLike): boolean {
  return normalizeFuelAllocationStatus(allocation.allocation_status) === "reversed";
}

export function isTripFuelAllocation(allocation: FuelAllocationLike): boolean {
  return (
    normalizeFuelAllocationStatus(allocation.allocation_status) === "allocated" &&
    Boolean(allocation.journey_id)
  );
}

export function summarizeFuelIssue(
  fuelIssue: FuelIssueLike,
  allocations: FuelAllocationLike[]
): FuelIssueAllocationSummary {
  const issueLiters = roundFuelValue(fuelIssue.liters);
  const issueCost = roundFuelValue(fuelIssue.total_cost);
  let allocatedLiters = 0;
  let allocatedCost = 0;
  let carriedForwardLiters = 0;
  let carriedForwardCost = 0;
  let reversedLiters = 0;
  let reversedCost = 0;
  let allocationCount = 0;
  let carriedForwardCount = 0;
  let reversedCount = 0;

  for (const allocation of allocations) {
    const liters = toFuelNumber(allocation.allocated_liters);
    const cost = toFuelNumber(allocation.allocated_cost);
    const status = normalizeFuelAllocationStatus(allocation.allocation_status);

    if (status === "reversed") {
      reversedLiters += liters;
      reversedCost += cost;
      reversedCount += 1;
      continue;
    }

    if (status === "carried_forward") {
      carriedForwardLiters += liters;
      carriedForwardCost += cost;
      carriedForwardCount += 1;
      continue;
    }

    allocatedLiters += liters;
    allocatedCost += cost;
    allocationCount += 1;
  }

  const consumedLiters = allocatedLiters + carriedForwardLiters;
  const consumedCost = allocatedCost + carriedForwardCost;
  const overAllocated =
    consumedLiters > issueLiters + EPSILON ||
    (issueCost > 0 && consumedCost > issueCost + EPSILON);
  const remainingLiters = Math.max(issueLiters - consumedLiters, 0);
  const remainingCost = Math.max(issueCost - consumedCost, 0);

  return {
    fuel_log_id: fuelIssue.id || null,
    issue_liters: issueLiters,
    issue_cost: issueCost,
    allocated_liters: roundFuelValue(allocatedLiters),
    allocated_cost: roundFuelValue(allocatedCost),
    carried_forward_liters: roundFuelValue(carriedForwardLiters),
    carried_forward_cost: roundFuelValue(carriedForwardCost),
    reversed_liters: roundFuelValue(reversedLiters),
    reversed_cost: roundFuelValue(reversedCost),
    consumed_liters: roundFuelValue(consumedLiters),
    consumed_cost: roundFuelValue(consumedCost),
    remaining_liters: roundFuelValue(remainingLiters),
    remaining_cost: roundFuelValue(remainingCost),
    allocation_count: allocationCount,
    carried_forward_count: carriedForwardCount,
    reversed_count: reversedCount,
    over_allocated: overAllocated,
    status: overAllocated
      ? "over_allocated"
      : consumedLiters <= EPSILON && consumedCost <= EPSILON
        ? "unallocated"
        : remainingLiters > EPSILON || remainingCost > EPSILON
          ? "partially_allocated"
          : "fully_allocated",
  };
}

export function summarizeAllocationsForJourney(allocations: FuelAllocationLike[]) {
  const activeTripAllocations = allocations.filter(isTripFuelAllocation);
  return {
    allocated_liters: roundFuelValue(
      activeTripAllocations.reduce(
        (sum, allocation) => sum + toFuelNumber(allocation.allocated_liters),
        0
      )
    ),
    allocated_cost: roundFuelValue(
      activeTripAllocations.reduce(
        (sum, allocation) => sum + toFuelNumber(allocation.allocated_cost),
        0
      )
    ),
    allocation_count: activeTripAllocations.length,
  };
}

export function estimateAllocatedCost(
  fuelIssue: FuelIssueLike,
  allocatedLiters: number,
  providedCost?: number | null
): number {
  if (providedCost !== null && providedCost !== undefined && Number.isFinite(providedCost)) {
    return roundFuelValue(providedCost);
  }

  const issueLiters = toFuelNumber(fuelIssue.liters);
  const issueCost = toFuelNumber(fuelIssue.total_cost);
  if (issueLiters <= EPSILON || issueCost <= EPSILON || allocatedLiters <= EPSILON) {
    return 0;
  }

  return roundFuelValue((allocatedLiters / issueLiters) * issueCost);
}

export function validateFuelAllocationRequest(input: {
  fuelIssue: FuelIssueLike;
  existingAllocations: FuelAllocationLike[];
  nextAllocation: FuelAllocationLike;
}) {
  const errors: string[] = [];
  const status = normalizeFuelAllocationStatus(input.nextAllocation.allocation_status);
  const liters = toFuelNumber(input.nextAllocation.allocated_liters);
  const cost = toFuelNumber(input.nextAllocation.allocated_cost);
  const issueLiters = toFuelNumber(input.fuelIssue.liters);
  const issueCost = toFuelNumber(input.fuelIssue.total_cost);

  if (liters < 0) errors.push("Allocated litres must be zero or greater.");
  if (cost < 0) errors.push("Allocated cost must be zero or greater.");
  if (liters <= EPSILON && cost <= EPSILON) {
    errors.push("Allocated litres or allocated cost is required.");
  }
  if (status === "allocated" && !input.nextAllocation.journey_id) {
    errors.push("A trip is required for an allocated fuel amount.");
  }

  const activeExisting = input.existingAllocations.filter(
    (allocation) => !isReversedFuelAllocation(allocation)
  );
  const existingLiters = activeExisting.reduce(
    (sum, allocation) => sum + toFuelNumber(allocation.allocated_liters),
    0
  );
  const existingCost = activeExisting.reduce(
    (sum, allocation) => sum + toFuelNumber(allocation.allocated_cost),
    0
  );
  const nextLiters = status === "reversed" ? 0 : liters;
  const nextCost = status === "reversed" ? 0 : cost;

  if (existingLiters + nextLiters > issueLiters + EPSILON) {
    errors.push("Allocated litres exceed the fuel issue total.");
  }
  if (issueCost > EPSILON && existingCost + nextCost > issueCost + EPSILON) {
    errors.push("Allocated cost exceeds the fuel issue total cost.");
  }
  if (issueCost <= EPSILON && nextCost > EPSILON) {
    errors.push("Fuel issue cost is unavailable, so allocated cost must be zero.");
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized_status: status,
    normalized_basis: normalizeFuelAllocationBasis(input.nextAllocation.allocation_basis),
  };
}

export function isFuelAllocationSchemaMissing(error: any): boolean {
  const message = String(
    error?.message || error?.hint || error?.details || error || ""
  ).toLowerCase();
  return (
    message.includes("fuel_allocations") &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}
