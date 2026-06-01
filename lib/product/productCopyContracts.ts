import type { ProductSurfaceId } from "./productBoundaries";

export type CopyLevel =
  | "public_marketing"
  | "customer_default_ui"
  | "operational_evidence"
  | "finance_review"
  | "management_summary"
  | "admin_setup"
  | "admin_diagnostics"
  | "nava_eye_default"
  | "nava_eye_audit"
  | "client_portal"
  | "docs_internal";

export type CopyContract = {
  level: CopyLevel;
  tone: string;
  allowedDetailLevel: "short" | "evidence" | "technical";
  allowedTechnicalTerms: string[];
  forbiddenTerms: string[];
  preferredCtas: string[];
  examples: string[];
};

export const PRODUCT_VOICE = {
  shouldSound: [
    "enterprise-grade",
    "calm",
    "precise",
    "operational",
    "source-grounded",
    "confident without overclaiming",
    "concise by default",
    "helpful and action-oriented",
  ],
  shouldNotSound: [
    "toy dashboard",
    "developer debug tool",
    "academic report",
    "generic AI marketing",
    "tracker clone",
    "uncertain by default",
    "exposing internal implementation",
  ],
} as const;

const INTERNAL_FORBIDDEN_TERMS = [
  "canonical",
  "legacy",
  "event_type",
  "provider_signal_flags",
  "raw payload",
  "row path",
  "service role",
  "Supabase Auth",
];

const MONEY_FORBIDDEN_TERMS = [
  "profit",
  "profitability",
  "final profit",
  "profit review",
];

const STOPPED_IDLE_FORBIDDEN_TERMS = [
  "fuel burn",
  "fuel theft",
  "driver blame",
  "client blame",
  "confirmed engine idle",
];

export const COPY_CONTRACTS: Record<CopyLevel, CopyContract> = {
  public_marketing: {
    level: "public_marketing",
    tone: "Clear, credible, controlled-rollout enterprise language.",
    allowedDetailLevel: "short",
    allowedTechnicalTerms: ["Nava Eye", "fleet intelligence workspace", "implementation review"],
    forbiddenTerms: ["pilot trial", "Start trial", "generic AI-assisted", ...STOPPED_IDLE_FORBIDDEN_TERMS],
    preferredCtas: ["Request implementation review", "Start setup", "Open workspace", "Talk to Nava Bloom"],
    examples: ["Source-grounded fleet intelligence for operations, finance, and management teams."],
  },
  customer_default_ui: {
    level: "customer_default_ui",
    tone: "Operational, concise, and action-oriented.",
    allowedDetailLevel: "short",
    allowedTechnicalTerms: ["GPS-derived", "provider distance", "tracker idle markers"],
    forbiddenTerms: [...INTERNAL_FORBIDDEN_TERMS, ...MONEY_FORBIDDEN_TERMS, ...STOPPED_IDLE_FORBIDDEN_TERMS],
    preferredCtas: ["Open review", "Ask Nava Eye", "Review queue"],
    examples: ["Review trucks with limited movement in the selected period."],
  },
  operational_evidence: {
    level: "operational_evidence",
    tone: "Evidence-safe and practical.",
    allowedDetailLevel: "evidence",
    allowedTechnicalTerms: [
      "GPS-derived distance estimate",
      "stopped-time evidence",
      "provider current stop",
      "transaction fee",
      "expense proof",
    ],
    forbiddenTerms: [...INTERNAL_FORBIDDEN_TERMS, "final profit", ...STOPPED_IDLE_FORBIDDEN_TERMS],
    preferredCtas: ["Ask why stopped", "Ask about distance", "Open Trip"],
    examples: ["GPS-stopped evidence is stationary evidence, not confirmed engine-on idle."],
  },
  finance_review: {
    level: "finance_review",
    tone: "Controlled finance review language with clear evidence boundaries.",
    allowedDetailLevel: "evidence",
    allowedTechnicalTerms: [
      "linked cost evidence",
      "configured rate",
      "manual override",
      "transaction fee",
      "total paid",
    ],
    forbiddenTerms: ["final profit", "fuel burn", "fuel theft"],
    preferredCtas: ["Open Revenue Review", "Manage Client Rates", "Review contribution"],
    examples: [
      "Contribution review uses linked revenue and linked cost evidence, including transaction fees where recorded.",
    ],
  },
  management_summary: {
    level: "management_summary",
    tone: "Decision-level, calm, and concise.",
    allowedDetailLevel: "short",
    allowedTechnicalTerms: ["contribution velocity", "operational drag", "review-ready contribution"],
    forbiddenTerms: ["final profit", "driver blame", "client blame"],
    preferredCtas: ["Open Management", "Ask what to act on first"],
    examples: ["Contribution velocity is provisional until required evidence is reviewed."],
  },
  admin_setup: {
    level: "admin_setup",
    tone: "Setup-focused and plain-language.",
    allowedDetailLevel: "evidence",
    allowedTechnicalTerms: ["connection readiness", "signal capability", "provider setup"],
    forbiddenTerms: ["raw payload", "service role", "secret"],
    preferredCtas: ["Test connection", "Review vehicles", "Activate sync"],
    examples: ["Provider setup needs a successful connection test before activation."],
  },
  admin_diagnostics: {
    level: "admin_diagnostics",
    tone: "Technical, sanitized, and collapsed by default.",
    allowedDetailLevel: "technical",
    allowedTechnicalTerms: ["row path", "response shape", "field mapping", "event_type"],
    forbiddenTerms: ["secret value", "full raw payload", "service role key"],
    preferredCtas: ["Open advanced diagnostics", "Apply suggested mapping"],
    examples: ["Advanced diagnostics can show field names and response shape, never secrets."],
  },
  nava_eye_default: {
    level: "nava_eye_default",
    tone: "Direct answer first, source and caveat second, action when useful.",
    allowedDetailLevel: "short",
    allowedTechnicalTerms: ["source", "GPS-derived", "provider-reported", "provisional"],
    forbiddenTerms: ["looking at the thread", "active intent", "raw coordinates", "raw payload"],
    preferredCtas: ["Ask how", "Show timeline", "What should I do next?"],
    examples: ["Source: GPS-derived movement evidence; provider distance is still needed for final per-km review."],
  },
  nava_eye_audit: {
    level: "nava_eye_audit",
    tone: "Detailed, source-grounded, and still privacy-safe.",
    allowedDetailLevel: "technical",
    allowedTechnicalTerms: ["source hierarchy", "telemetry points", "filtered gaps", "provider current stop"],
    forbiddenTerms: ["raw coordinates", "raw payload", "secret", "signed URL"],
    preferredCtas: ["Show evidence", "Explain difference"],
    examples: ["Provider current stop is the current episode; GPS-stopped total covers the selected period."],
  },
  client_portal: {
    level: "client_portal",
    tone: "Minimal, calm, delivery-focused, and privacy-first.",
    allowedDetailLevel: "short",
    allowedTechnicalTerms: ["delivery visibility", "location update", "quantity"],
    forbiddenTerms: [...INTERNAL_FORBIDDEN_TERMS, "raw coordinates", "finance", "Nava Eye"],
    preferredCtas: ["Refresh"],
    examples: ["Location update available; readable place pending."],
  },
  docs_internal: {
    level: "docs_internal",
    tone: "Precise internal product law and implementation guidance.",
    allowedDetailLevel: "technical",
    allowedTechnicalTerms: [...INTERNAL_FORBIDDEN_TERMS, "roleAccess", "product boundary"],
    forbiddenTerms: [],
    preferredCtas: ["Run smoke test", "Check product boundaries"],
    examples: ["Docs may name forbidden customer-facing terms so guardrails can test against them."],
  },
};

export const COPY_TERM_REPLACEMENTS: Record<string, string> = {
  profit: "contribution",
  profitability: "contribution review",
  "profit review": "contribution review",
  "pilot trial": "controlled rollout",
  "Start trial": "Start setup",
  "idle time": "stopped-time evidence",
  "driver idle": "tracker/provider idle-marker evidence",
  "raw payload": "advanced diagnostics",
  "hidden charges": "transaction fee",
  "total cost": "total paid",
};

export const SURFACE_COPY_LEVELS: Record<ProductSurfaceId, CopyLevel> = {
  operations: "operational_evidence",
  finance: "finance_review",
  management: "management_summary",
  nava_eye: "nava_eye_default",
  dashboard: "customer_default_ui",
  live_tracking: "customer_default_ui",
  ops_intelligence: "operational_evidence",
  trips: "customer_default_ui",
  trip_detail: "operational_evidence",
  expenses: "finance_review",
  fuel: "finance_review",
  finance_dashboard: "finance_review",
  revenue_review: "finance_review",
  client_rates: "finance_review",
  management_dashboard: "management_summary",
  provider_admin: "admin_setup",
  team_access: "customer_default_ui",
  client_visibility_admin: "admin_setup",
  client_portal: "client_portal",
  public_site: "public_marketing",
  onboarding: "public_marketing",
  pricing: "public_marketing",
};

export function getCopyContract(level: CopyLevel) {
  return COPY_CONTRACTS[level];
}

export function getCopyContractForSurface(surfaceId: ProductSurfaceId) {
  return getCopyContract(SURFACE_COPY_LEVELS[surfaceId]);
}

export function preferredCopyTerm(_surfaceId: ProductSurfaceId, term: string) {
  const normalized = String(term || "").trim();
  return COPY_TERM_REPLACEMENTS[normalized] || COPY_TERM_REPLACEMENTS[normalized.toLowerCase()] || term;
}

export function forbiddenCopyTermsForSurface(surfaceId: ProductSurfaceId) {
  return getCopyContractForSurface(surfaceId).forbiddenTerms;
}
