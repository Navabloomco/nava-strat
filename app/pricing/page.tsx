import Link from "next/link";

const tiers = [
  {
    name: "Starter",
    price: "From KES 20,000/month",
    included: "Includes 5 enabled intelligence vehicles",
    extra: "KES 2,000 per additional enabled vehicle",
    description: "A clean operating base for smaller teams starting with fleet intelligence.",
    features: [
      "Fuel & expense capture",
      "Live tracking list",
      "Nava Eye fleet answers",
      "5 client visibility links",
      "1 provider connection",
    ],
    cta: "Start trial",
  },
  {
    name: "Growth",
    price: "From KES 60,000/month",
    included: "Includes 25 enabled intelligence vehicles",
    extra: "KES 1,500 per additional enabled vehicle",
    description: "More operating intelligence for teams managing more vehicles, clients, and exceptions.",
    features: [
      "Everything in Starter",
      "Profitability dashboard",
      "Trip profit simulator",
      "Management dashboard",
      "25 client visibility links",
      "2 provider connections",
      "Priority onboarding support",
    ],
    cta: "Start trial",
    featured: true,
  },
  {
    name: "Scale",
    price: "From KES 150,000/month",
    included: "Includes 100 enabled intelligence vehicles",
    extra: "KES 1,200 per additional enabled vehicle",
    description: "Command-center capability for larger operations with multiple teams and providers.",
    features: [
      "Everything in Growth",
      "Advanced role access",
      "Multi-provider operations",
      "Provider request queue",
      "100 client visibility links",
      "Priority support",
    ],
    cta: "Talk to us",
  },
  {
    name: "Enterprise",
    price: "Custom pricing",
    included: "For 150+ vehicles",
    extra: "Terms confirmed with your team",
    description: "For fleets with multiple depots, custom integrations, dedicated onboarding, and support terms.",
    features: [
      "150+ enabled intelligence vehicles",
      "Multiple depot operations",
      "Custom integrations",
      "Dedicated onboarding",
      "Dedicated support terms",
    ],
    cta: "Talk to us",
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="border-b border-white/10 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="min-w-0 truncate text-lg font-semibold">
            Nava Strat
          </Link>
          <div className="flex shrink-0 gap-2 sm:gap-3">
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

      <section className="px-4 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="break-words text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 sm:tracking-[0.18em]">
              Enabled intelligence vehicle pricing
            </p>
            <h1 className="mt-4 break-words text-4xl font-semibold tracking-normal sm:text-5xl">
              Simple, transparent pricing for fleet intelligence.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Only pay for vehicles you enable for Nava intelligence. Imported provider
              vehicles remain unbilled until reviewed and enabled.
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
                <div
                  className={`mt-4 whitespace-normal break-words rounded-md border px-3 py-2 text-sm font-semibold leading-6 ${
                    tier.featured
                      ? "border-slate-950/10 bg-slate-950/10 text-slate-900"
                      : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100"
                  }`}
                >
                  {tier.included}
                </div>
                <div
                  className={`mt-2 text-xs ${
                    tier.featured ? "text-slate-800" : "text-slate-400"
                  }`}
                >
                  {tier.extra}
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

          <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-lg border border-white/10 bg-white/[0.06] p-6">
              <p className="break-words text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 sm:tracking-[0.18em]">
                Fair billing promise
              </p>
              <h2 className="mt-3 break-words text-2xl font-semibold tracking-normal sm:text-3xl">
                You stay in control of what becomes billable.
              </h2>
              <ul className="mt-6 grid gap-3 text-sm leading-6 text-slate-300 md:grid-cols-2">
                <li>Only enabled intelligence vehicles are billed.</li>
                <li>Imported provider vehicles are not billed automatically.</li>
                <li>New vehicles can be reviewed before they affect billing.</li>
                <li>Mid-cycle additions are prorated.</li>
                <li>Trial customers see estimates before any charge.</li>
              </ul>
            </section>

            <section className="rounded-lg border border-cyan-200/20 bg-cyan-300/10 p-6">
              <p className="break-words text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 sm:tracking-[0.18em]">
                Pilot trial
              </p>
              <h2 className="mt-3 break-words text-2xl font-semibold tracking-normal sm:text-3xl">
                30-day pilot with assisted onboarding.
              </h2>
              <p className="mt-5 text-sm leading-6 text-slate-300">
                Billing starts only after vehicles are enabled and terms are confirmed.
                Your team can review the fleet, provider connection, and estimated monthly
                pricing before moving beyond the pilot.
              </p>
            </section>
          </div>

          <section className="mt-4 rounded-lg border border-white/10 bg-white/[0.06] p-6">
            <p className="break-words text-sm font-bold uppercase tracking-[0.14em] text-cyan-200 sm:tracking-[0.18em]">
              Proration example
            </p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">
              If an extra vehicle is enabled halfway through the month, Nava estimates
              only the remaining days for that billing period and shows the next monthly
              estimate before confirmation.
            </p>
          </section>
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
