"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";

interface OverviewData {
  success: boolean;
  error?: string;
  company?: any;
  fleet_health?: any;
  active_memories?: any[];
  trucks_in_uganda?: any[];
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [copilotQuery, setCopilotQuery] = useState("");
  const [copilotAnswer, setCopilotAnswer] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          router.push("/login");
          return;
        }
        const token = sessionData.session.access_token;
        const res = await fetch("/api/dashboard/overview", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const json = await res.json();
        console.log("Dashboard overview response:", json);
        if (json.success) {
          setData(json);
        } else {
          setErrorDetail(json.error || "Unknown error");
        }
      } catch (err: any) {
        console.error("Fetch error:", err);
        setErrorDetail(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  const askCopilot = async () => {
    if (!copilotQuery.trim()) return;
    setCopilotLoading(true);
    setCopilotAnswer("");
    try {
      const res = await fetch("/api/nava-eye/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: copilotQuery }),
      });
      const json = await res.json();
      setCopilotAnswer(json.answer || "No answer");
    } catch {
      setCopilotAnswer("Error contacting Nava Eye.");
    } finally {
      setCopilotLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Loading Nava Eye...</div>;
  if (errorDetail) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8">
        <h1 className="text-xl text-red-500">Dashboard Error</h1>
        <pre className="mt-4 text-sm">{errorDetail}</pre>
        <p className="mt-4">Check browser console for more details.</p>
      </div>
    );
  }
  if (!data || !data.success) return <div className="min-h-screen bg-slate-950 text-white p-8">Unable to load dashboard.</div>;

  const fh = data.fleet_health!;
  const company = data.company!;
  const memories = data.active_memories || [];
  const ugandaTrucks = data.trucks_in_uganda || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-8 py-5 flex justify-between items-center sticky top-0 bg-slate-950/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-full animate-pulse" />
          <h1 className="text-2xl font-bold tracking-tight">Nava Eye</h1>
          <span className="text-slate-500 text-sm ml-2">{company.name}</span>
        </div>
        <button
          onClick={() => supabase.auth.signOut().then(() => router.push("/login"))}
          className="text-slate-400 hover:text-white transition text-sm"
        >
          Sign Out
        </button>
      </header>

      <div className="flex">
        <aside className="w-64 border-r border-slate-800 p-6 space-y-6">
          <nav className="space-y-2">
            <div className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Main</div>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Fleet</a>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Live Map</a>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Journeys</a>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Fuel Intelligence</a>
            <div className="pt-4 text-slate-400 text-sm font-semibold uppercase tracking-wider">Operations</div>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Drivers</a>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Copilot</a>
            <div className="pt-4 text-slate-400 text-sm font-semibold uppercase tracking-wider">System</div>
            <a href="#" className="block text-slate-300 hover:text-white py-1">Settings</a>
          </nav>
        </aside>

        <main className="flex-1 p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-10">
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold">{fh.total_trucks}</div>
              <div className="text-slate-500 text-sm">Active Trucks</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-green-500">{fh.online_trucks}</div>
              <div className="text-slate-500 text-sm">Online</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-yellow-500">{fh.critical_events_24h}</div>
              <div className="text-slate-500 text-sm">Critical Events (24h)</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
              <div className="text-4xl font-bold text-purple-500">{ugandaTrucks.length}</div>
              <div className="text-slate-500 text-sm">Trucks in Uganda</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">⚠️ Highest Risk Trucks</h2>
                {fh.highest_risk_trucks.map((t: any) => (
                  <div key={t.truck_id} className="flex justify-between border-b border-slate-800 py-2">
                    <span className="font-mono">{t.truck_id}</span>
                    <span className="text-red-400">{t.event_count} events</span>
                  </div>
                ))}
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🛑 Highest Idle Trucks</h2>
                {fh.highest_idle_trucks.map((t: any) => (
                  <div key={t.truck_id} className="flex justify-between border-b border-slate-800 py-2">
                    <span className="font-mono">{t.truck_id}</span>
                    <span className="text-yellow-400">{t.idle_hours} hours idle</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🔥 Recent Critical Events</h2>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {fh.recent_critical_events.map((e: any, idx: number) => (
                    <div key={idx} className="border-l-2 border-red-500 pl-3">
                      <div className="flex justify-between text-sm">
                        <span className="font-mono">{e.truck_id}</span>
                        <span className="text-slate-500 text-xs">{new Date(e.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-sm my-1">{e.event_type.replace(/_/g, " ").toUpperCase()}</div>
                      <div className="text-xs text-slate-500">{e.location_name || "Unknown"}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">🧠 Nava Eye Copilot</h2>
                <textarea
                  value={copilotQuery}
                  onChange={(e) => setCopilotQuery(e.target.value)}
                  placeholder="Ask about fleet health, fuel risk, specific trucks..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  rows={3}
                />
                <button
                  onClick={askCopilot}
                  disabled={copilotLoading || !copilotQuery.trim()}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-medium py-2 rounded-xl transition"
                >
                  {copilotLoading ? "Thinking..." : "Ask Nava Eye"}
                </button>
                {copilotAnswer && (
                  <div className="mt-4 bg-slate-800/50 rounded-xl p-4 border border-slate-700">
                    <div className="text-sm text-slate-300 whitespace-pre-wrap">{copilotAnswer}</div>
                  </div>
                )}
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5">
                <h2 className="text-lg font-semibold mb-4">💡 Active Operational Memories</h2>
                <div className="space-y-3">
                  {memories.map((m) => (
                    <div key={m.id} className="border border-slate-700 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                          m.severity === "critical" ? "bg-red-900/50 text-red-300" :
                          m.severity === "warning" ? "bg-yellow-900/50 text-yellow-300" :
                          "bg-blue-900/50 text-blue-300"
                        }`}>
                          {m.severity}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{m.memory_type}</span>
                      </div>
                      <div className="font-medium text-sm">{m.title}</div>
                      <div className="text-xs text-slate-400 mt-1">{m.summary}</div>
                      {m.recommendation && <div className="text-xs text-blue-400 mt-2">🔧 {m.recommendation}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
