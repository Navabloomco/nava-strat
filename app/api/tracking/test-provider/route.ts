import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST() {
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
