import { supabase } from "@/lib/supabase";

export default async function OpsDashboard() {
  const { data: fuel } = await supabase
    .from("fuel_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  const unallocated = fuel?.filter(
    (f) => f.allocation_status === "unallocated"
  );

  return (
    <main style={{ padding: 40 }}>
      <h1>Ops Dashboard</h1>

      <h2>⚠️ Needs Attention</h2>

      {!unallocated || unallocated.length === 0 ? (
        <p>All fuel allocated ✅</p>
      ) : (
        unallocated.map((f) => (
          <div
            key={f.id}
            style={{
              border: "1px solid #ddd",
              padding: 12,
              marginBottom: 10,
              borderRadius: 8
            }}
          >
            <strong>Unallocated Fuel</strong>
            <br />
            Truck: {f.asset_id}
            <br />
            Litres: {f.litres}L
            <br />
            Vendor: {f.vendor || "Not entered"}
          </div>
        ))
      )}

      <h2>Recent Fuel Entries</h2>

      {fuel?.map((f) => (
        <div key={f.id} style={{ marginBottom: 10 }}>
          🚛 {f.asset_id} — {f.litres}L — {f.vendor || "No vendor"}
        </div>
      ))}
    </main>
  );
}
