import { noStoreJson, requirePlatformOwner } from "../tenants/tenantBilling";
import { buildPilotReadinessList } from "./readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const access = await requirePlatformOwner(req);
    if (access.error) return access.error;

    const result = await buildPilotReadinessList();

    return noStoreJson({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error("Admin readiness GET error:", err);
    return noStoreJson(
      { success: false, error: err.message || "Failed to load readiness" },
      { status: 500 }
    );
  }
}
