import { NextResponse } from "next/server";

/**
 * Deprecated: provider tests must use authenticated, company-scoped routes.
 */
export async function POST(req: Request) {
  return NextResponse.json(
    {
      success: false,
      error: "Deprecated endpoint. Use POST /api/providers/[id]/test.",
    },
    { status: 410 }
  );
}
