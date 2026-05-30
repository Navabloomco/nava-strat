export type ProductSurface =
  | "operations"
  | "finance"
  | "management"
  | "nava_eye";

export type ProductBoundaryCapabilities = {
  canViewFinance?: boolean;
  canViewManagement?: boolean;
  canViewFuelCost?: boolean;
  isElevated?: boolean;
};

export type ProductBoundaryContract = {
  surface: ProductSurface;
  canShowFinanceAmounts: boolean;
  canShowFinanceReviewStatus: boolean;
  canShowFuelCostAmounts: boolean;
  moneyFieldsHidden: boolean;
  userFacingSummary: string;
};

export const OPS_RESTRICTED_FINANCE_LABELS = [
  "Revenue",
  "Linked cost",
  "Contribution",
  "Margin",
  "Per-km contribution",
  "Fuel cost",
] as const;

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
