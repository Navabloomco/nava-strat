export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("tracking_providers")
      .select(`
        id,
        provider_name,
        auth_type,
        login_url,
        username,
        api_key,
        fleet_url,
        field_mapping
      `);

    return Response.json({
      success: true,
      error,
      data,
      count: data?.length || 0,
      timestamp: new Date().toISOString(),
      cache: "DISABLED"
    });

  } catch (err: any) {
    return Response.json({
      success: false,
      error: err.message
    });
  }
}
