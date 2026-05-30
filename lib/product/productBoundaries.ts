export type ProductSurface =
  | "operations"
  | "finance"
  | "management"
  | "nava_eye";

export type ProductSurfaceId =
  | ProductSurface
  | "dashboard"
  | "live_tracking"
  | "ops_intelligence"
  | "trips"
  | "trip_detail"
  | "expenses"
  | "fuel"
  | "finance_dashboard"
  | "revenue_review"
  | "client_rates"
  | "management_dashboard"
  | "provider_admin"
  | "team_access"
  | "client_visibility_admin"
  | "client_portal"
  | "public_site"
  | "onboarding"
  | "pricing";

export type ProductDomain =
  | "operations"
  | "trips"
  | "tracking"
  | "finance"
  | "management"
  | "providers"
  | "team"
  | "client_visibility"
  | "client_delivery"
  | "evidence"
  | "fuel"
  | "public_marketing"
  | "nava_eye";

export type ProductRole =
  | "owner"
  | "admin"
  | "ops"
  | "finance"
  | "management"
  | "platform_owner";

export type DefaultDetailLevel = "concise" | "evidence" | "admin_diagnostic";

export type ProductBoundaryCapabilities = {
  canViewFinance?: boolean;
  canViewManagement?: boolean;
  canViewFuelCost?: boolean;
  canViewRawCoordinates?: boolean;
  canViewProviderDiagnostics?: boolean;
  canViewEvidence?: boolean;
  canManageProviders?: boolean;
  canManageTeam?: boolean;
  isElevated?: boolean;
  isPlatformOwner?: boolean;
};

export type ProductBoundaryContract = {
  surface: ProductSurface;
  canShowFinanceAmounts: boolean;
  canShowFinanceReviewStatus: boolean;
  canShowFuelCostAmounts: boolean;
  moneyFieldsHidden: boolean;
  userFacingSummary: string;
};

export type SurfaceContract = {
  id: ProductSurfaceId;
  purpose: string;
  primaryUser: string;
  allowedDomains: ProductDomain[];
  restrictedDomains: ProductDomain[];
  forbiddenDefaultFields: string[];
  forbiddenDefaultTerms: string[];
  preferredTerms: string[];
  defaultDetailLevel: DefaultDetailLevel;
  advancedDetailAllowed: boolean;
  navaEyeBehavior?: string;
};

export type RoleContract = {
  role: ProductRole;
  allowedWorkflows: string[];
  restrictedWorkflows: string[];
  canSeeFinanceAmounts: boolean;
  canManageProviders: boolean;
  canManageTeam: boolean;
  canSeeRawCoordinates: boolean;
  canSeeProviderDiagnostics: boolean;
  canSeeEvidenceLinks: boolean;
  tenantVisibilityNotes: string;
};

export type EvidenceContract = {
  id: string;
  userFacingLabel: string;
  safeClaim: string;
  forbiddenClaims: string[];
};

export type UxContract = {
  id: string;
  rule: string;
};

export const OPS_RESTRICTED_FINANCE_LABELS = [
  "Revenue",
  "Linked cost",
  "Contribution",
  "Margin",
  "Per-km contribution",
  "Fuel cost",
] as const;

export const FINANCE_AMOUNT_FIELDS = [
  "revenue_amount",
  "revenue_kes",
  "rate_amount",
  "linked_cost",
  "linked_variable_cost",
  "linked_fuel_cost",
  "linked_expense_cost",
  "fuel_cost",
  "contribution_amount",
  "contribution_kes",
  "contribution_margin",
  "margin",
  "per_km_contribution",
  "cost_per_km",
];

export const RAW_LOCATION_FIELDS = [
  "latitude",
  "longitude",
  "raw_coordinates",
  "map_pin_coordinates",
];

export const PROVIDER_SECRET_FIELDS = [
  "api_key",
  "password",
  "bearer_token",
  "token_hash",
  "secret",
  "raw_payload",
  "provider_response_sample",
];

export const INTERNAL_IMPLEMENTATION_TERMS = [
  "canonical",
  "legacy",
  "event_type",
  "provider_signal_flags",
  "raw payload",
  "row path",
  "service role",
  "Supabase Auth",
];

export const UNSAFE_CLAIM_TERMS = [
  "final profit",
  "profit review",
  "fuel burn",
  "fuel theft",
  "driver blame",
  "client blame",
  "confirmed engine idle",
];

const OPS_ALLOWED_DOMAINS: ProductDomain[] = [
  "operations",
  "trips",
  "tracking",
  "evidence",
];

const FINANCE_ALLOWED_DOMAINS: ProductDomain[] = [
  "finance",
  "fuel",
  "evidence",
  "trips",
];

const MANAGEMENT_ALLOWED_DOMAINS: ProductDomain[] = [
  "management",
  "operations",
  "finance",
  "trips",
];

const COMMON_CUSTOMER_FORBIDDEN_TERMS = [
  ...INTERNAL_IMPLEMENTATION_TERMS,
  "pilot view",
  "pilot readiness",
  "Start trial",
];

const COMMON_PRIVATE_FIELDS = [
  ...RAW_LOCATION_FIELDS,
  ...PROVIDER_SECRET_FIELDS,
  "evidence_signed_url",
  "storage_path",
  "platform_owner",
];

export const SURFACE_CONTRACTS: Record<ProductSurfaceId, SurfaceContract> = {
  operations: {
    id: "operations",
    purpose: "Generic operations surface boundary.",
    primaryUser: "Ops/admin users",
    allowedDomains: OPS_ALLOWED_DOMAINS,
    restrictedDomains: ["finance", "management", "providers"],
    forbiddenDefaultFields: [...FINANCE_AMOUNT_FIELDS, ...COMMON_PRIVATE_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, ...UNSAFE_CLAIM_TERMS],
    preferredTerms: ["Ops Intelligence", "Trip readiness", "Missing links", "Review status"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
  finance: {
    id: "finance",
    purpose: "Generic finance surface boundary.",
    primaryUser: "Finance/admin/management users",
    allowedDomains: FINANCE_ALLOWED_DOMAINS,
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "final profit"],
    preferredTerms: ["Revenue Review", "Client rates", "Contribution review", "Linked cost evidence"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
  },
  management: {
    id: "management",
    purpose: "Generic management intelligence boundary.",
    primaryUser: "Management/admin users",
    allowedDomains: MANAGEMENT_ALLOWED_DOMAINS,
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "final profit"],
    preferredTerms: ["Command brief", "Contribution velocity", "Decision summary"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
  },
  nava_eye: {
    id: "nava_eye",
    purpose: "Private company-data intelligence assistant.",
    primaryUser: "All authenticated roles, scoped by permission",
    allowedDomains: [
      "operations",
      "tracking",
      "trips",
      "finance",
      "management",
      "providers",
      "evidence",
      "fuel",
      "nava_eye",
    ],
    restrictedDomains: ["team", "client_visibility"],
    forbiddenDefaultFields: [...COMMON_PRIVATE_FIELDS],
    forbiddenDefaultTerms: ["raw payload", "service role", "Supabase Auth"],
    preferredTerms: ["Source", "Caveat", "Review", "What to do next"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
    navaEyeBehavior:
      "Answer directly, enforce role/company scope first, and move audit/source detail behind explicit how/why/show evidence prompts.",
  },
  dashboard: {
    id: "dashboard",
    purpose: "Enterprise command brief that routes users to action.",
    primaryUser: "Ops, finance, management, admin",
    allowedDomains: ["operations", "tracking", "trips", "management", "nava_eye"],
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...COMMON_PRIVATE_FIELDS, ...FINANCE_AMOUNT_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "raw KPI dump"],
    preferredTerms: ["Command brief", "Needs attention", "Review queue", "Ask Nava Eye"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
    navaEyeBehavior: "Embedded brief prompts answer directly under the prompt area.",
  },
  live_tracking: {
    id: "live_tracking",
    purpose: "Searchable live/stale operational fleet list.",
    primaryUser: "Ops/admin/management",
    allowedDomains: ["tracking", "operations", "trips"],
    restrictedDomains: ["finance", "providers"],
    forbiddenDefaultFields: [...FINANCE_AMOUNT_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "raw coordinates"],
    preferredTerms: ["Live fleet intelligence", "Readable location", "Stale assets"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
    navaEyeBehavior: "Truck prompts open Nava Eye focused on the selected asset.",
  },
  ops_intelligence: {
    id: "ops_intelligence",
    purpose: "Operational evidence, movement, stopped-time, and Trip review readiness.",
    primaryUser: "Ops/admin/management",
    allowedDomains: OPS_ALLOWED_DOMAINS,
    restrictedDomains: ["finance", "providers"],
    forbiddenDefaultFields: [...FINANCE_AMOUNT_FIELDS, ...COMMON_PRIVATE_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, ...UNSAFE_CLAIM_TERMS],
    preferredTerms: [
      "Low Movement Review",
      "Stopped-time evidence",
      "Tracker idle-marker evidence",
      "Contribution review ready",
    ],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: false,
    navaEyeBehavior: "Detailed stopped/distance explanations belong in Nava Eye audit/detail.",
  },
  trips: {
    id: "trips",
    purpose: "Operational Trip list and creation surface.",
    primaryUser: "Ops/admin",
    allowedDomains: ["trips", "operations", "evidence"],
    restrictedDomains: ["finance", "management", "providers"],
    forbiddenDefaultFields: [...FINANCE_AMOUNT_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "profit"],
    preferredTerms: ["Trip", "Route", "Driver", "Proof", "Operational status"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
  trip_detail: {
    id: "trip_detail",
    purpose: "Trip completion surface with role-separated ops, finance, and evidence context.",
    primaryUser: "Ops, finance, management, admin",
    allowedDomains: ["trips", "operations", "finance", "evidence", "fuel"],
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...PROVIDER_SECRET_FIELDS, "raw_coordinates"],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "final profit"],
    preferredTerms: ["Asset availability", "Expense proof", "Contribution review"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
    navaEyeBehavior: "Trip prompts open Nava Eye with the current Trip context.",
  },
  expenses: {
    id: "expenses",
    purpose: "Expense and proof capture/review.",
    primaryUser: "Ops capture, finance review",
    allowedDomains: ["finance", "evidence", "trips"],
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "final profit"],
    preferredTerms: ["Expense proof", "Linked Trip cost", "Review"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
  },
  fuel: {
    id: "fuel",
    purpose: "Fuel issue/allocation ledger and cost review.",
    primaryUser: "Ops capture, finance review",
    allowedDomains: ["fuel", "finance", "trips"],
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "fuel theft", "fuel burn"],
    preferredTerms: ["Fuel allocation", "Fuel cost review", "Allocation evidence"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
  },
  finance_dashboard: {
    id: "finance_dashboard",
    purpose: "Finance hub for revenue, rates, costs, and contribution review.",
    primaryUser: "Finance/admin/management",
    allowedDomains: FINANCE_ALLOWED_DOMAINS,
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "Create Trip"],
    preferredTerms: ["Revenue Review", "Client Rates", "Fuel Cost Review", "Contribution Review"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
  },
  revenue_review: {
    id: "revenue_review",
    purpose: "Finance-owned revenue/rate review queue.",
    primaryUser: "Finance/admin/management",
    allowedDomains: ["finance", "trips"],
    restrictedDomains: ["operations", "providers"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "profit"],
    preferredTerms: ["Revenue Review", "Rate match", "Finance review"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
    navaEyeBehavior: "Finance prompts require finance/management/elevated visibility.",
  },
  client_rates: {
    id: "client_rates",
    purpose: "Finance-owned client rate setup.",
    primaryUser: "Finance/admin",
    allowedDomains: ["finance"],
    restrictedDomains: ["operations", "providers"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "profit"],
    preferredTerms: ["Client Rates", "Revenue Rules", "Effective date"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: true,
  },
  management_dashboard: {
    id: "management_dashboard",
    purpose: "Decision summary and contribution intelligence.",
    primaryUser: "Management/admin/owner",
    allowedDomains: MANAGEMENT_ALLOWED_DOMAINS,
    restrictedDomains: ["providers", "team"],
    forbiddenDefaultFields: [...RAW_LOCATION_FIELDS, ...PROVIDER_SECRET_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "final profit"],
    preferredTerms: ["Contribution velocity", "Blocked reviews", "Operational drag"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
  },
  provider_admin: {
    id: "provider_admin",
    purpose: "Provider readiness, signal capability, and sanitized setup diagnostics.",
    primaryUser: "Owner/admin/platform owner",
    allowedDomains: ["providers", "tracking"],
    restrictedDomains: ["finance", "team"],
    forbiddenDefaultFields: PROVIDER_SECRET_FIELDS,
    forbiddenDefaultTerms: ["raw payload", "service role", "secret", "token"],
    preferredTerms: ["Provider readiness", "Connection readiness", "Signal capability", "Advanced diagnostics"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
    navaEyeBehavior: "Provider prompts use sanitized capability summaries only.",
  },
  team_access: {
    id: "team_access",
    purpose: "Tenant-manageable team membership and invitations.",
    primaryUser: "Owner/admin/platform owner",
    allowedDomains: ["team"],
    restrictedDomains: ["finance", "providers", "client_visibility"],
    forbiddenDefaultFields: ["platform_owner", "service_role", "auth_provider_payload"],
    forbiddenDefaultTerms: ["platform_owner", "service role", "Supabase Auth", "support superuser"],
    preferredTerms: ["Team Access", "Active users", "Pending invites", "Invite by email"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
  client_visibility_admin: {
    id: "client_visibility_admin",
    purpose: "Company-admin client visibility link management.",
    primaryUser: "Owner/admin",
    allowedDomains: ["client_visibility"],
    restrictedDomains: ["finance", "providers", "team"],
    forbiddenDefaultFields: ["token_hash", "raw_token_after_creation", ...COMMON_PRIVATE_FIELDS],
    forbiddenDefaultTerms: ["token_hash", "service role", "public URL stored"],
    preferredTerms: ["Client Visibility", "Generate link", "Regenerate link", "Revoke"],
    defaultDetailLevel: "evidence",
    advancedDetailAllowed: false,
  },
  client_portal: {
    id: "client_portal",
    purpose: "Token-scoped delivery visibility for external clients.",
    primaryUser: "External client recipients",
    allowedDomains: ["client_delivery"],
    restrictedDomains: ["finance", "providers", "team", "management", "nava_eye"],
    forbiddenDefaultFields: [...COMMON_PRIVATE_FIELDS, ...FINANCE_AMOUNT_FIELDS],
    forbiddenDefaultTerms: [...COMMON_CUSTOMER_FORBIDDEN_TERMS, "internal", "raw coordinates"],
    preferredTerms: ["Delivery visibility", "Current location", "Quantity", "Location update available"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
  public_site: {
    id: "public_site",
    purpose: "Public Nava Strat/Nava Bloom entry surface.",
    primaryUser: "Prospects and invited users",
    allowedDomains: ["public_marketing"],
    restrictedDomains: ["finance", "providers", "team", "client_visibility"],
    forbiddenDefaultFields: COMMON_PRIVATE_FIELDS,
    forbiddenDefaultTerms: ["pilot trial", "Start trial", "generic AI-assisted", "fuel theft", "final profit"],
    preferredTerms: ["Fleet intelligence workspace", "Implementation review", "Source-grounded Nava Eye"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
  onboarding: {
    id: "onboarding",
    purpose: "Guided workspace and provider setup.",
    primaryUser: "Owner/admin",
    allowedDomains: ["public_marketing", "providers", "tracking"],
    restrictedDomains: ["finance", "management"],
    forbiddenDefaultFields: COMMON_PRIVATE_FIELDS,
    forbiddenDefaultTerms: ["pilot trial", "Start trial", "raw payload"],
    preferredTerms: ["Start setup", "Workspace setup", "Provider setup", "Go-live readiness"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: true,
  },
  pricing: {
    id: "pricing",
    purpose: "Public controlled-rollout pricing.",
    primaryUser: "Prospects and admins",
    allowedDomains: ["public_marketing"],
    restrictedDomains: ["finance", "providers", "team"],
    forbiddenDefaultFields: COMMON_PRIVATE_FIELDS,
    forbiddenDefaultTerms: ["pilot trial", "Start trial", "fuel theft", "final profit"],
    preferredTerms: ["Controlled rollout", "Start setup", "Talk to Nava Bloom"],
    defaultDetailLevel: "concise",
    advancedDetailAllowed: false,
  },
};

export const ROLE_CONTRACTS: Record<ProductRole, RoleContract> = {
  owner: {
    role: "owner",
    allowedWorkflows: ["company setup", "team access", "provider setup", "ops", "finance", "management"],
    restrictedWorkflows: ["internal platform support controls"],
    canSeeFinanceAmounts: true,
    canManageProviders: true,
    canManageTeam: true,
    canSeeRawCoordinates: false,
    canSeeProviderDiagnostics: true,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Tenant owner; internal platform access remains invisible.",
  },
  admin: {
    role: "admin",
    allowedWorkflows: ["company setup", "team access", "provider setup", "ops", "finance", "management"],
    restrictedWorkflows: ["internal platform support controls"],
    canSeeFinanceAmounts: true,
    canManageProviders: true,
    canManageTeam: true,
    canSeeRawCoordinates: false,
    canSeeProviderDiagnostics: true,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Tenant admin; internal platform access remains invisible.",
  },
  ops: {
    role: "ops",
    allowedWorkflows: ["live tracking", "Trips", "Ops Intelligence", "proof capture", "availability status"],
    restrictedWorkflows: ["rates", "revenue amounts", "fuel cost amounts", "contribution amounts", "provider secrets"],
    canSeeFinanceAmounts: false,
    canManageProviders: false,
    canManageTeam: false,
    canSeeRawCoordinates: false,
    canSeeProviderDiagnostics: false,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Ops captures operational reality without restricted finance values.",
  },
  finance: {
    role: "finance",
    allowedWorkflows: ["Client Rates", "Revenue Review", "Expenses", "Fuel Cost Review", "Contribution Review"],
    restrictedWorkflows: ["provider secret editing", "team management", "raw coordinates"],
    canSeeFinanceAmounts: true,
    canManageProviders: false,
    canManageTeam: false,
    canSeeRawCoordinates: false,
    canSeeProviderDiagnostics: false,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Finance owns money workflows but not provider/admin mechanics.",
  },
  management: {
    role: "management",
    allowedWorkflows: ["dashboard", "management intelligence", "decision summaries", "contribution visibility"],
    restrictedWorkflows: ["provider secret editing", "team management", "raw coordinates"],
    canSeeFinanceAmounts: true,
    canManageProviders: false,
    canManageTeam: false,
    canSeeRawCoordinates: false,
    canSeeProviderDiagnostics: false,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Management sees decision summaries where role policy allows.",
  },
  platform_owner: {
    role: "platform_owner",
    allowedWorkflows: ["explicit tenant support context", "platform readiness", "provider diagnostics", "tenant setup"],
    restrictedWorkflows: ["accidental tenant-facing exposure of internal access"],
    canSeeFinanceAmounts: true,
    canManageProviders: true,
    canManageTeam: true,
    canSeeRawCoordinates: true,
    canSeeProviderDiagnostics: true,
    canSeeEvidenceLinks: true,
    tenantVisibilityNotes: "Internal support role; invisible to tenant users and always scoped to explicit company context.",
  },
};

export const EVIDENCE_CONTRACTS: Record<string, EvidenceContract> = {
  distance: {
    id: "distance",
    userFacingLabel: "Distance evidence",
    safeClaim:
      "Provider trip/report distance is strongest; provider mileage deltas are evidence when sane; GPS-derived distance is provisional.",
    forbiddenClaims: ["final odometer truth", "fuel efficiency from distance alone"],
  },
  stopped_time: {
    id: "stopped_time",
    userFacingLabel: "Stopped-time evidence",
    safeClaim: "GPS-stopped evidence means stationary intervals in the selected period.",
    forbiddenClaims: ["engine-on idle", "driver blame", "client blame", "fuel burn"],
  },
  provider_current_stop: {
    id: "provider_current_stop",
    userFacingLabel: "Provider current stop",
    safeClaim: "Provider current stop is the current continuous stop episode, not the daily stopped total.",
    forbiddenClaims: ["daily total stopped time", "engine-on idle"],
  },
  idle_markers: {
    id: "idle_markers",
    userFacingLabel: "Tracker/provider idle-marker evidence",
    safeClaim: "Provider idle markers are tracker-supplied evidence and need stronger signals for engine/fuel conclusions.",
    forbiddenClaims: ["true engine-on idle", "fuel burn", "theft", "driver misconduct"],
  },
  contribution: {
    id: "contribution",
    userFacingLabel: "Contribution review",
    safeClaim: "Contribution is linked revenue minus linked cost evidence where finance role allows it.",
    forbiddenClaims: ["final audited profit", "unlinked costs as exact contribution"],
  },
  client_dwell: {
    id: "client_dwell",
    userFacingLabel: "Client/site dwell context",
    safeClaim: "Client or site dwell is context only unless trip/geofence/evidence links explain the cause.",
    forbiddenClaims: ["client blame", "driver blame"],
  },
};

export const UX_CONTRACTS: UxContract[] = [
  {
    id: "search_result_proximity",
    rule: "Search and filter results must appear near the control that produced them.",
  },
  {
    id: "contextual_nava_eye_placement",
    rule: "Contextual Nava Eye answers appear inline near the prompt or open focused Nava Eye.",
  },
  {
    id: "concise_default_detail",
    rule: "Default pages are concise; audit and method detail belongs in Nava Eye or advanced panels.",
  },
  {
    id: "client_privacy_first",
    rule: "Client-facing portals show only token-scoped delivery visibility and never raw coordinates or internal records.",
  },
  {
    id: "internal_access_invisible",
    rule: "Platform/internal access mechanics are invisible to tenant users.",
  },
  {
    id: "destructive_confirmation",
    rule: "Destructive or access-changing actions require clear confirmation or an equivalent deliberate action.",
  },
];

const PRODUCT_SURFACE_ALIASES: Record<ProductSurface, ProductSurfaceId> = {
  operations: "operations",
  finance: "finance",
  management: "management",
  nava_eye: "nava_eye",
};

export function getSurfaceContract(surfaceId: ProductSurfaceId): SurfaceContract {
  return SURFACE_CONTRACTS[PRODUCT_SURFACE_ALIASES[surfaceId as ProductSurface] || surfaceId];
}

export function surfaceAllowsDomain(surfaceId: ProductSurfaceId, domain: ProductDomain) {
  return getSurfaceContract(surfaceId).allowedDomains.includes(domain);
}

export function surfaceForbidsField(surfaceId: ProductSurfaceId, field: string) {
  const normalizedField = normalizeContractToken(field);
  return getSurfaceContract(surfaceId).forbiddenDefaultFields.some(
    (forbidden) => normalizeContractToken(forbidden) === normalizedField
  );
}

export function forbiddenTermsForSurface(surfaceId: ProductSurfaceId) {
  return getSurfaceContract(surfaceId).forbiddenDefaultTerms;
}

export function getRoleContract(role: ProductRole) {
  return ROLE_CONTRACTS[role];
}

export function shouldShowAdvancedDetail(
  surfaceId: ProductSurfaceId,
  capabilities: ProductBoundaryCapabilities = {}
) {
  const contract = getSurfaceContract(surfaceId);
  if (!contract.advancedDetailAllowed) return false;
  return Boolean(
    capabilities.isPlatformOwner ||
      capabilities.canViewProviderDiagnostics ||
      capabilities.canViewFinance ||
      capabilities.canViewManagement
  );
}

export function productBoundaryForSurface(
  surface: ProductSurface,
  capabilities: ProductBoundaryCapabilities = {}
): ProductBoundaryContract {
  const financeVisible = Boolean(capabilities.canViewFinance || capabilities.isElevated);
  const managementVisible = Boolean(
    capabilities.canViewManagement || capabilities.canViewFinance || capabilities.isElevated
  );
  const fuelCostVisible = Boolean(capabilities.canViewFuelCost || financeVisible);

  if (surface === "operations") {
    return {
      surface,
      canShowFinanceAmounts: false,
      canShowFinanceReviewStatus: true,
      canShowFuelCostAmounts: false,
      moneyFieldsHidden: true,
      userFacingSummary:
        "Operations shows readiness and missing links. Finance amounts stay in Finance and Management surfaces.",
    };
  }

  if (surface === "finance") {
    return {
      surface,
      canShowFinanceAmounts: financeVisible,
      canShowFinanceReviewStatus: financeVisible,
      canShowFuelCostAmounts: fuelCostVisible,
      moneyFieldsHidden: !financeVisible,
      userFacingSummary:
        "Finance owns rates, revenue, costs, fuel cost review, and contribution review.",
    };
  }

  if (surface === "management") {
    return {
      surface,
      canShowFinanceAmounts: managementVisible,
      canShowFinanceReviewStatus: managementVisible,
      canShowFuelCostAmounts: managementVisible,
      moneyFieldsHidden: !managementVisible,
      userFacingSummary:
        "Management sees decision-level contribution intelligence when the role allows it.",
    };
  }

  return {
    surface,
    canShowFinanceAmounts: financeVisible || managementVisible,
    canShowFinanceReviewStatus: true,
    canShowFuelCostAmounts: fuelCostVisible,
    moneyFieldsHidden: !(financeVisible || managementVisible),
    userFacingSummary:
      "Nava Eye answers are role-scoped before finance, evidence, provider, or location details are returned.",
  };
}

export function shouldShowFinanceAmounts(
  surface: ProductSurface,
  capabilities: ProductBoundaryCapabilities = {}
) {
  return productBoundaryForSurface(surface, capabilities).canShowFinanceAmounts;
}

export function canSurfaceShowFinance(
  surfaceId: ProductSurfaceId,
  capabilities: ProductBoundaryCapabilities = {}
) {
  if (surfaceId === "ops_intelligence" || surfaceId === "operations") return false;
  if (surfaceId === "client_portal" || surfaceId === "public_site" || surfaceId === "onboarding") {
    return false;
  }
  if (surfaceId === "finance" || surfaceId === "finance_dashboard" || surfaceId === "revenue_review" || surfaceId === "client_rates") {
    return productBoundaryForSurface("finance", capabilities).canShowFinanceAmounts;
  }
  if (surfaceId === "management" || surfaceId === "management_dashboard") {
    return productBoundaryForSurface("management", capabilities).canShowFinanceAmounts;
  }
  if (surfaceId === "nava_eye") {
    return productBoundaryForSurface("nava_eye", capabilities).canShowFinanceAmounts;
  }
  return false;
}

function normalizeContractToken(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}
