import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("tracking_providers")
    .select("*");

  return Response.json({
    error,
    data,
    count: data?.length || 0,
  });
}
