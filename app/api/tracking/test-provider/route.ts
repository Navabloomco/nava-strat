import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.fleet_url && !body.base_url) {
      return NextResponse.json(
        { ok: false, message: "Fleet URL or base URL is required." },
        { status: 400 }
      );
    }

    const testUrl = body.fleet_url || body.base_url;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (body.auth_type === "bearer_token" && body.bearer_token) {
      headers.Authorization = `Bearer ${body.bearer_token}`;
    }

    if (body.auth_type === "api_key" && body.api_key) {
      headers["x-api-key"] = body.api_key;
    }

    const response = await fetch(testUrl, {
      method: "GET",
      headers,
    });

    const text = await response.text();

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      message: response.ok
        ? "Connection reached provider successfully."
        : `Provider responded with status ${response.status}.`,
      sample: text.slice(0, 500),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error.message || "Connection test failed.",
      },
      { status: 500 }
    );
  }
}
