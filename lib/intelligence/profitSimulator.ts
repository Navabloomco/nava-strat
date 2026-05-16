type SimulationInputs = {
  rate_per_tonne?: number;
  tonnes?: number;
  fuel_cost?: number;
  per_diem?: number;
  tolls?: number;
  parking?: number;
  loading?: number;
  offloading?: number;
  transaction_cost?: number;
  other_costs?: number;
};

type SimulationResult = {
  is_simulation: boolean;
  route?: { from?: string; to?: string };
  inputs: SimulationInputs;
  missing_inputs: string[];
  result?: {
    revenue: number;
    total_costs: number;
    profit: number;
    margin_percent: number | null;
    break_even_rate_per_tonne: number | null;
  };
  assumptions: string[];
};

const SIMULATION_PHRASES = [
  "what if",
  "if i get paid",
  "if we get paid",
  "if we charge",
  "if i charge",
  "would i make",
  "would we make",
  "how much profit",
  "simulate",
  "per tonne",
  "per ton",
  "/tonne",
  "/ton",
];

const COST_PATTERNS: Array<{
  key: keyof SimulationInputs;
  labels: string[];
}> = [
  { key: "fuel_cost", labels: ["fuel cost", "fuel"] },
  { key: "per_diem", labels: ["per diem", "per-diem", "allowance"] },
  { key: "tolls", labels: ["tolls", "toll"] },
  { key: "parking", labels: ["parking"] },
  { key: "loading", labels: ["loading"] },
  { key: "offloading", labels: ["offloading", "off loading"] },
  {
    key: "transaction_cost",
    labels: [
      "transaction cost",
      "transaction costs",
      "bank charge",
      "bank charges",
      "mobile money fee",
      "mpesa fee",
      "m-pesa fee",
    ],
  },
  { key: "other_costs", labels: ["other expenses", "other costs", "misc costs"] },
];

export function detectProfitSimulation(question: string): boolean {
  const lower = question.toLowerCase();
  return SIMULATION_PHRASES.some((phrase) => lower.includes(phrase));
}

export function simulateProfit(question: string): SimulationResult {
  const inputs: SimulationInputs = {};
  const route = detectRoute(question);
  const assumptions = [detectCurrency(question)];

  inputs.rate_per_tonne = detectRatePerTonne(question);
  inputs.tonnes = detectTonnes(question);

  for (const pattern of COST_PATTERNS) {
    const value = detectCost(question, pattern.labels);
    if (value !== undefined) {
      inputs[pattern.key] = value;
    }
  }

  const missing_inputs = getMissingInputs(inputs);
  const response: SimulationResult = {
    is_simulation: true,
    ...(route ? { route } : {}),
    inputs,
    missing_inputs,
    assumptions,
  };

  if (missing_inputs.length > 0) {
    return response;
  }

  const revenue = Number(inputs.rate_per_tonne || 0) * Number(inputs.tonnes || 0);
  const total_costs = sumCosts(inputs);
  const profit = revenue - total_costs;
  const margin_percent = revenue > 0 ? (profit / revenue) * 100 : null;
  const break_even_rate_per_tonne =
    Number(inputs.tonnes || 0) > 0 ? total_costs / Number(inputs.tonnes) : null;

  return {
    ...response,
    result: {
      revenue,
      total_costs,
      profit,
      margin_percent,
      break_even_rate_per_tonne,
    },
  };
}

function detectCurrency(question: string) {
  const upper = question.toUpperCase();
  const currency =
    upper.match(/\b(USD|KES|UGX|TZS|RWF|EUR|GBP|ZAR)\b/)?.[1] || "KES";
  return `Currency treated as ${currency}.`;
}

function detectRoute(question: string) {
  const routeMatch = question.match(
    /\bfrom\s+([a-zA-Z .'-]+?)\s+to\s+([a-zA-Z .'-]+?)(?=,|\?|\.|\s+(?:with|if|and|for|at|fuel|per|toll|parking|loading|offloading)|$)/i
  );

  if (!routeMatch) return null;

  return {
    from: normalizePlace(routeMatch[1]),
    to: normalizePlace(routeMatch[2]),
  };
}

function normalizePlace(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.toLowerCase() === "msa") return "Mombasa";
  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function detectRatePerTonne(question: string) {
  const patterns = [
    /(?:paid|charge|rate|at|for)\s+(?:kes|usd|ugx|tzs|rwf|eur|gbp|zar)?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(?:\/\s*)?(?:per\s*)?(?:tonne|ton|t)\b/i,
    /\b([0-9][0-9,]*(?:\.\d+)?)\s*(?:\/\s*)?(?:per\s*)?(?:tonne|ton)\b/i,
  ];

  return firstNumberMatch(question, patterns);
}

function detectTonnes(question: string) {
  const patterns = [
    /\bwith\s+([0-9][0-9,]*(?:\.\d+)?)\s*(?:tonnes|tons|tonne|ton|t)\b/i,
    /\b([0-9][0-9,]*(?:\.\d+)?)\s*(?:tonnes|tons|tonne|ton|t)\b/i,
  ];

  return firstNumberMatch(question, patterns);
}

function detectCost(question: string, labels: string[]) {
  for (const label of labels) {
    const escapedLabel = escapeRegExp(label);
    const labelThenNumber = new RegExp(
      `\\b${escapedLabel}\\b\\s*(?:is|are|=|:|of|at|costs?|cost)?\\s*(?:kes|usd|ugx|tzs|rwf|eur|gbp|zar)?\\s*([0-9][0-9,]*(?:\\.\\d+)?)`,
      "i"
    );
    const numberThenLabel = new RegExp(
      `(?:kes|usd|ugx|tzs|rwf|eur|gbp|zar)?\\s*([0-9][0-9,]*(?:\\.\\d+)?)\\s*(?:for|in|as)?\\s*\\b${escapedLabel}\\b`,
      "i"
    );

    const value =
      parseNumber(labelThenNumber.exec(question)?.[1]) ??
      parseNumber(numberThenLabel.exec(question)?.[1]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function firstNumberMatch(question: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = parseNumber(pattern.exec(question)?.[1]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseNumber(value?: string) {
  if (!value) return undefined;
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getMissingInputs(inputs: SimulationInputs) {
  const missing = [];

  if (inputs.rate_per_tonne !== undefined && inputs.tonnes === undefined) {
    missing.push("tonnes");
  }
  if (inputs.tonnes !== undefined && inputs.rate_per_tonne === undefined) {
    missing.push("rate per tonne");
  }
  if (inputs.rate_per_tonne === undefined && inputs.tonnes === undefined) {
    missing.push("rate per tonne");
    missing.push("tonnes");
  }
  if (sumCosts(inputs) === 0) {
    missing.push("at least one cost such as fuel, per diem, tolls, or other expenses");
  }

  return missing;
}

function sumCosts(inputs: SimulationInputs) {
  return (
    Number(inputs.fuel_cost || 0) +
    Number(inputs.per_diem || 0) +
    Number(inputs.tolls || 0) +
    Number(inputs.parking || 0) +
    Number(inputs.loading || 0) +
    Number(inputs.offloading || 0) +
    Number(inputs.transaction_cost || 0) +
    Number(inputs.other_costs || 0)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
