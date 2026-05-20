export const PLATFORM_OPERATOR_COMPANY_TYPE = "platform_operator";
export const CUSTOMER_COMPANY_TYPE = "customer";
export const DEMO_COMPANY_TYPE = "demo";

const PLATFORM_OPERATOR_FALLBACK_KEYS = new Set(["navabloomco"]);

export function normalizeCompanyType(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeCompanyKey(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function isPlatformOperatorCompany(company: any) {
  const companyType = normalizeCompanyType(company?.company_type);

  if (companyType) {
    return companyType === PLATFORM_OPERATOR_COMPANY_TYPE;
  }

  const slugKey = normalizeCompanyKey(company?.slug);
  const nameKey = normalizeCompanyKey(company?.name);

  return (
    PLATFORM_OPERATOR_FALLBACK_KEYS.has(slugKey) ||
    PLATFORM_OPERATOR_FALLBACK_KEYS.has(nameKey)
  );
}

export function getPlatformOperatorDetection(company: any) {
  const companyType = normalizeCompanyType(company?.company_type);

  if (companyType === PLATFORM_OPERATOR_COMPANY_TYPE) {
    return {
      method: "company_type",
      matched_key: "company_type:platform_operator",
    };
  }

  if (!companyType && isPlatformOperatorCompany(company)) {
    return {
      method: "fallback_slug_or_name_heuristic",
      matched_key: "navabloomco",
    };
  }

  return {
    method: "not_platform_operator",
    matched_key: null,
  };
}

export function isMissingCompanyTypeColumn(error: any) {
  const message = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    error?.code === "42703" ||
    (message.includes("company_type") &&
      (message.includes("does not exist") ||
        message.includes("could not find") ||
        message.includes("schema cache")))
  );
}
