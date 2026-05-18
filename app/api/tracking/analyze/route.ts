import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "Legacy tracking route retired",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
