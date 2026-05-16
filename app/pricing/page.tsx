import Link from "next/link";

const tiers = [
  {
    name: "Starter",
    price: "For small fleets",
    description: "A clean operating base for companies getting their fleet data under control.",
    features: [
      "Company workspace",
      "Core fleet and journey visibility",
      "Provider connection checklist",
      "Basic Nava Eye questions",
    ],
    cta: "Start trial",
  },
  {
    name: "Growth",
    price: "For scaling operators",
    description: "More intelligence for teams managing more trucks, clients, and operational exceptions.",
    features: [
      "Everything in Starter",
      "Fuel, expense, and revenue workflows",
      "Profitability and leakage analytics",
      "Advanced Nava Eye context",
    ],
    cta: "Start trial",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "For complex fleets",
    description: "Controls and visibility for multi-region operations with stricter governance needs.",
    features: [
      "Multi-company operations",
      "Role-based access",
      "Provider connection monitoring",
      "Executive intelligence dashboards",
    ],
    cta: "Talk to us",
  },
  {
    name: "Platform / Custom",
    price: "For networks",
    description: "Custom deployment, integrations, and operating models for logistics platforms.",
    features: [
      "Custom provider integrations",
      "Dedicated onboarding support",
      "Custom reporting surfaces",
      "Administrative oversight controls",
    ],
    cta: "Talk to us",
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="border-b border-white/10 px-8 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="text-lg font-semibold">
            Nava Strat
          </Link>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
            >
              Sign in
            </Link>
            <Link
              href="/login?signup"
              className="rounded-md bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-200"
            >
              Start trial
            </Link>
          </div>
        </div>
      </section>

      <section className="px-8 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              SaaS pricing
            </p>
            <h1 className="mt-4 text-5xl font-semibold tracking-normal">
              Choose the Nava Strat plan that matches your operating model.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Start with secure fleet intelligence for your team, then expand into deeper
              journey, fuel, finance, provider, and Nava Eye workflows as your team grows.
            </p>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-4">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-lg border p-6 ${
                  tier.featured
                    ? "border-cyan-300 bg-cyan-300 text-slate-950"
                    : "border-white/10 bg-white/[0.06] text-white"
                }`}
              >
                <div className="text-xl font-semibold">{tier.name}</div>
                <div
                  className={`mt-2 text-sm ${
                    tier.featured ? "text-slate-800" : "text-slate-300"
                  }`}
                >
                  {tier.price}
                </div>
                <p
                  className={`mt-5 text-sm leading-6 ${
                    tier.featured ? "text-slate-800" : "text-slate-300"
                  }`}
                >
                  {tier.description}
                </p>
                <ul className="mt-6 space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="text-sm">
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.cta === "Start trial" ? "/login?signup" : "/login"}
                  className={`mt-7 inline-flex w-full justify-center rounded-md px-4 py-3 text-sm font-bold ${
                    tier.featured
                      ? "bg-slate-950 text-white hover:bg-slate-800"
                      : "border border-white/20 text-white hover:bg-white/10"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-8 py-8 text-sm text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>© {new Date().getFullYear()} Nava Strat</div>
          <div className="flex gap-5">
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
