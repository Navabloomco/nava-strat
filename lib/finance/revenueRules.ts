export type RevenueRuleUnitType =
  | "tonne"
  | "truck"
  | "bag"
  | "container"
  | "trip"
  | "custom";

export type BillingQuantitySource =
  | "loaded_quantity"
  | "offloaded_quantity"
  | "billing_quantity"
  | "manual_quantity";

export type FxPolicy = "manual" | "company_standard" | "fixed_rate";
export type RevenueRuleStatus = "active" | "inactive";
export type RevenueSource =
  | "configured_rate"
  | "manual_finance_entry"
  | "overridden"
  | "missing";

export type RevenueRuleMatchStatus =
  | "no_rule"
  | "unique_match"
  | "multiple_matches"
  | "missing_quantity"
  | "missing_fx";

export type ClientRateRuleLike = {
  id?: string | null;
  company_id?: string | null;
  client_name?: string | null;
  route_from?: string | null;
  route_to?: string | null;
  unit_type?: string | null;
  billing_quantity_source?: string | null;
  rate_amount?: any;
  currency?: string | null;
  fx_policy?: string | null;
  fx_rate_to_kes?: any;
  effective_from?: string | null;
  effective_to?: string | null;
  status?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type JourneyRevenueLike = {
  id?: string | null;
  company_id?: string | null;
  client_name?: string | null;
  from_location?: string | null;
  to_location?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  created_at?: string | null;
  loaded_quantity?: any;
  offloaded_quantity?: any;
  billing_quantity?: any;
};

export type RevenueCalculation = {
  revenue_source: RevenueSource;
  billing_quantity: number;
  billing_unit: RevenueRuleUnitType;
  rate_amount: number;
  currency: string;
  fx_rate_to_kes: number;
  revenue_original: number;
  revenue_kes: number;
};

const UNIT_TYPES = new Set<RevenueRuleUnitType>([
  "tonne",
  "truck",
  "bag",
  "container",
  "trip",
  "custom",
]);

const BILLING_QUANTITY_SOURCES = new Set<BillingQuantitySource>([
  "loaded_quantity",
  "offloaded_quantity",
  "billing_quantity",
  "manual_quantity",
]);

const FX_POLICIES = new Set<FxPolicy>(["manual", "company_standard", "fixed_rate"]);
const RATE_STATUSES = new Set<RevenueRuleStatus>(["active", "inactive"]);
const REVENUE_SOURCES = new Set<RevenueSource>([
  "configured_rate",
  "manual_finance_entry",
  "overridden",
  "missing",
]);

const EPSILON = 0.000001;

export function normalizeRevenueText(value: any): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text ? text.toUpperCase() : null;
}

export function normalizeRevenueMatchKey(value: any): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/→|->|–|—/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeRevenueRuleUnitType(value: any): RevenueRuleUnitType {
  const text = String(value || "").trim().toLowerCase().replace(/^per_/, "");
  return UNIT_TYPES.has(text as RevenueRuleUnitType)
    ? (text as RevenueRuleUnitType)
    : "tonne";
}

export function normalizeBillingQuantitySource(value: any): BillingQuantitySource {
  const text = String(value || "").trim().toLowerCase();
  return BILLING_QUANTITY_SOURCES.has(text as BillingQuantitySource)
    ? (text as BillingQuantitySource)
    : "offloaded_quantity";
}

export function normalizeFxPolicy(value: any): FxPolicy {
  const text = String(value || "").trim().toLowerCase();
  return FX_POLICIES.has(text as FxPolicy) ? (text as FxPolicy) : "manual";
}

export function normalizeRevenueRuleStatus(value: any): RevenueRuleStatus {
  const text = String(value || "").trim().toLowerCase();
  return RATE_STATUSES.has(text as RevenueRuleStatus)
    ? (text as RevenueRuleStatus)
    : "active";
}

export function normalizeRevenueSource(value: any): RevenueSource {
  const text = String(value || "").trim().toLowerCase();
  return REVENUE_SOURCES.has(text as RevenueSource)
    ? (text as RevenueSource)
    : "manual_finance_entry";
}

export function normalizeCurrency(value: any): string {
  const text = String(value || "KES").trim().toUpperCase();
  return text || "KES";
}

export function toRevenueNumber(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function roundRevenueMoney(value: any): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function normalizeClientRateRuleInput(input: Record<string, any>) {
  const clientName = normalizeRevenueText(input.client_name ?? input.clientName);
  const routeFrom = normalizeRevenueText(input.route_from ?? input.routeFrom);
  const routeTo = normalizeRevenueText(input.route_to ?? input.routeTo);
  const unitType = normalizeRevenueRuleUnitType(input.unit_type ?? input.unitType);
  const billingQuantitySource = normalizeBillingQuantitySource(
    input.billing_quantity_source ?? input.billingQuantitySource
  );
  const rateAmount = toRevenueNumber(input.rate_amount ?? input.rateAmount);
  const currency = normalizeCurrency(input.currency);
  const fxPolicy = normalizeFxPolicy(input.fx_policy ?? input.fxPolicy);
  const fxRateToKes = toRevenueNumber(input.fx_rate_to_kes ?? input.fxRateToKes);
  const status = normalizeRevenueRuleStatus(input.status);
  const effectiveFrom = normalizeDateOnly(input.effective_from ?? input.effectiveFrom);
  const effectiveTo = normalizeDateOnly(input.effective_to ?? input.effectiveTo);

  return {
    client_name: clientName,
    route_from: routeFrom,
    route_to: routeTo,
    unit_type: unitType,
    billing_quantity_source: billingQuantitySource,
    rate_amount: rateAmount,
    currency,
    fx_policy: fxPolicy,
    fx_rate_to_kes: fxRateToKes,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    status,
    notes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : null,
  };
}

export function validateClientRateRuleInput(rule: ReturnType<typeof normalizeClientRateRuleInput>) {
  const errors: string[] = [];
  if (!rule.client_name) errors.push("Client name is required.");
  if (!rule.effective_from) errors.push("Effective from date is required.");
  if (!rule.rate_amount || rule.rate_amount <= 0) errors.push("Rate amount must be greater than zero.");
  if (!rule.currency) errors.push("Currency is required.");
  if (rule.fx_rate_to_kes !== null && rule.fx_rate_to_kes <= 0) {
    errors.push("FX rate must be greater than zero when provided.");
  }
  if (
    rule.effective_from &&
    rule.effective_to &&
    Date.parse(rule.effective_to) < Date.parse(rule.effective_from)
  ) {
    errors.push("Effective to date must be after effective from date.");
  }
  return errors;
}

export function findMatchingActiveRateRules(
  rules: ClientRateRuleLike[],
  journey: JourneyRevenueLike,
  date = journeyRevenueDate(journey)
) {
  const clientKey = normalizeRevenueMatchKey(journey.client_name);
  const fromKey = normalizeRevenueMatchKey(journey.from_location);
  const toKey = normalizeRevenueMatchKey(journey.to_location);

  return rules.filter((rule) => {
    if (normalizeRevenueRuleStatus(rule.status) !== "active") return false;
    if (normalizeRevenueMatchKey(rule.client_name) !== clientKey) return false;
    if (!dateWithinRule(date, rule)) return false;

    const ruleFrom = normalizeRevenueMatchKey(rule.route_from);
    const ruleTo = normalizeRevenueMatchKey(rule.route_to);
    if (ruleFrom && ruleFrom !== fromKey) return false;
    if (ruleTo && ruleTo !== toKey) return false;
    return true;
  });
}

export function evaluateRevenueRuleMatch(input: {
  journey: JourneyRevenueLike;
  rules: ClientRateRuleLike[];
  manualQuantity?: number | null;
  fxRateToKes?: number | null;
  date?: string | null;
}) {
  const matches = findMatchingActiveRateRules(
    input.rules,
    input.journey,
    input.date || journeyRevenueDate(input.journey)
  );

  if (matches.length === 0) {
    return {
      status: "no_rule" as RevenueRuleMatchStatus,
      matches,
      calculation: null,
      missing: ["matching active client/route rate rule"],
    };
  }

  if (matches.length > 1) {
    return {
      status: "multiple_matches" as RevenueRuleMatchStatus,
      matches,
      calculation: null,
      missing: ["one unambiguous client/route rate rule"],
    };
  }

  const rule = matches[0];
  const quantity = resolveBillingQuantity(input.journey, rule, input.manualQuantity);
  if (quantity === null || quantity <= EPSILON) {
    return {
      status: "missing_quantity" as RevenueRuleMatchStatus,
      matches,
      calculation: null,
      missing: [normalizeBillingQuantitySource(rule.billing_quantity_source)],
    };
  }

  const fxRate = resolveFxRateToKes(rule, input.fxRateToKes);
  if (fxRate === null) {
    return {
      status: "missing_fx" as RevenueRuleMatchStatus,
      matches,
      calculation: null,
      missing: ["FX rate to KES"],
    };
  }

  return {
    status: "unique_match" as RevenueRuleMatchStatus,
    matches,
    calculation: calculateRevenueFromRule(rule, quantity, fxRate),
    missing: [],
  };
}

export function calculateRevenueFromRule(
  rule: ClientRateRuleLike,
  billingQuantity: number,
  fxRateToKes = 1
): RevenueCalculation {
  const unitType = normalizeRevenueRuleUnitType(rule.unit_type);
  const rateAmount = toRevenueNumber(rule.rate_amount) || 0;
  const currency = normalizeCurrency(rule.currency);
  const effectiveFxRate = currency === "KES" ? 1 : fxRateToKes;
  const revenueOriginal = roundRevenueMoney(billingQuantity * rateAmount);
  return {
    revenue_source: "configured_rate",
    billing_quantity: roundRevenueMoney(billingQuantity),
    billing_unit: unitType,
    rate_amount: roundRevenueMoney(rateAmount),
    currency,
    fx_rate_to_kes: roundRevenueMoney(effectiveFxRate),
    revenue_original: revenueOriginal,
    revenue_kes: roundRevenueMoney(revenueOriginal * effectiveFxRate),
  };
}

export function resolveBillingQuantity(
  journey: JourneyRevenueLike,
  rule: ClientRateRuleLike,
  manualQuantity?: number | null
): number | null {
  const source = normalizeBillingQuantitySource(rule.billing_quantity_source);
  const unitType = normalizeRevenueRuleUnitType(rule.unit_type);
  const sourceValue =
    source === "loaded_quantity"
      ? toRevenueNumber(journey.loaded_quantity)
      : source === "offloaded_quantity"
        ? toRevenueNumber(journey.offloaded_quantity)
        : source === "billing_quantity"
          ? toRevenueNumber(journey.billing_quantity)
          : toRevenueNumber(manualQuantity ?? journey.billing_quantity);

  if (sourceValue !== null && sourceValue > EPSILON) return sourceValue;
  if (unitType === "truck" || unitType === "trip") return 1;
  return null;
}

export function resolveFxRateToKes(
  rule: ClientRateRuleLike,
  suppliedFxRate?: number | null
): number | null {
  const currency = normalizeCurrency(rule.currency);
  if (currency === "KES") return 1;

  const ruleFxRate = toRevenueNumber(rule.fx_rate_to_kes);
  if (ruleFxRate && ruleFxRate > 0) return ruleFxRate;

  const supplied = toRevenueNumber(suppliedFxRate);
  if (supplied && supplied > 0) return supplied;

  return null;
}

export function journeyRevenueDate(journey: JourneyRevenueLike): string | null {
  const value = journey.start_time || journey.end_time || journey.created_at;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function isRevenueRuleSchemaMissing(error: any) {
  const message = String(
    error?.message || error?.hint || error?.details || error || ""
  ).toLowerCase();
  return (
    message.includes("client_rate_rules") ||
    message.includes("journey_revenue_entries") ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    (message.includes("column") && message.includes("not found"))
  );
}

function dateWithinRule(date: string | null, rule: ClientRateRuleLike) {
  if (!date) return false;
  const effectiveFrom = normalizeDateOnly(rule.effective_from);
  const effectiveTo = normalizeDateOnly(rule.effective_to);
  if (effectiveFrom && date < effectiveFrom) return false;
  if (effectiveTo && date > effectiveTo) return false;
  return true;
}

function normalizeDateOnly(value: any): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}
