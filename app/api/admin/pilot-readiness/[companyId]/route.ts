import { noStoreJson, requirePlatformOwner } from "../../tenants/tenantBilling";
import { buildPilotReadinessDetail } from "../readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: { companyId: string } }
) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const readiness = await buildPilotReadinessDetail(params.companyId);
    if (!readiness) {
      return noStoreJson(
        { success: false, error: "Company not found" },
        { status: 404 }
      );
    }

    return noStoreJson({
      success: true,
      readiness,
    });
  } catch (err: any) {
    console.error("Admin pilot readiness detail GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load pilot readiness" },
      { status: 500 }
    );
  }
}
