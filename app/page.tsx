import Link from "next/link";

const capabilities = [
  "Multi-company fleet intelligence",
  "Provider onboarding and telemetry health",
  "Journey, fuel, expense, and revenue visibility",
  "Nava Eye operational copilot",
];

const outcomes = [
  {
    title: "Know what is happening",
    body: "Bring fleet activity, journeys, fuel, expenses, and alerts into one clear operating picture.",
  },
  {
    title: "Ask sharper questions",
    body: "Nava Eye answers with live operational context, from truck location and fuel risk to margin leaks and client profitability.",
  },
  {
    title: "Scale safely",
    body: "Built for secure access, team roles, and clean separation between customer workspaces.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#08111f] text-white">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(45,212,191,0.18),transparent_34%),radial-gradient(circle_at_75%_10%,rgba(59,130,246,0.16),transparent_30%)]" />
        <div className="relative mx-auto flex min-h-[720px] max-w-7xl flex-col px-8 py-8">
          <nav className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold tracking-wide">Nava Strat</div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                Fleet Intelligence SaaS
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/pricing"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
              >
                Pricing
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
          </nav>

          <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-5 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100">
                Enterprise intelligence for transport and logistics operators
              </p>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-normal text-white md:text-7xl">
                The operating brain for modern fleet companies.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
                Nava Strat helps logistics teams connect fleet telemetry, journeys,
                provider feeds, fuel activity, expenses, and revenue into one
                accountable SaaS workspace. Nava Eye turns that operational context
                into answers leaders can act on.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/login?signup"
                  className="rounded-md bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/30 hover:bg-cyan-200"
                >
                  Start trial
                </Link>
                <Link
                  href="/login"
                  className="rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Sign in
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="rounded-md border border-white/10 bg-slate-950/70 p-5">
                <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <div className="text-sm font-semibold text-white">Nava Eye</div>
                    <div className="text-xs text-slate-400">Private fleet copilot</div>
                  </div>
                  <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                    Live context
                  </div>
                </div>
                <div className="space-y-3">
                  {capabilities.map((item) => (
                    <div
                      key={item}
                      className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                    >
                      <span className="text-sm text-slate-200">{item}</span>
                      <span className="text-xs text-cyan-200">Ready</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-8 py-20 text-slate-950">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-700">
              Built for real operators
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              One system for operational truth, financial discipline, and AI-assisted decisions.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {outcomes.map((item) => (
              <div key={item.title} className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
