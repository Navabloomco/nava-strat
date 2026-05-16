import Link from "next/link";

const sections = [
  {
    title: "1. Account Use",
    body: "You are responsible for the accuracy of information submitted during signup, for keeping account access secure, and for activity performed through your workspace. Nava Strat may restrict access where use appears unauthorized, harmful, or inconsistent with these terms.",
  },
  {
    title: "2. Acceptable Use",
    body: "Do not use Nava Strat to disrupt services, access data you are not authorized to view, reverse engineer protected parts of the platform, upload malicious content, or use the service in a way that violates applicable law or another party's rights.",
  },
  {
    title: "3. Customer Data",
    body: "Your company remains responsible for the business data it enters or connects to Nava Strat. Nava Strat uses that data to provide fleet visibility, operating workflows, reporting, and Nava Eye assistance for your workspace.",
  },
  {
    title: "4. Provider Connections",
    body: "When you connect a GPS, telemetry, fuel, finance, or other operational provider, you confirm that you are authorized to share that provider access with Nava Strat. Provider availability and data quality may depend on the third-party provider.",
  },
  {
    title: "5. Subscriptions and Billing",
    body: "Plan details, trial access, usage limits, billing cycles, taxes, and cancellation terms may be set out in an order form, subscription agreement, or other written commercial arrangement with Nava Strat.",
  },
  {
    title: "6. Availability",
    body: "Nava Strat aims to provide reliable access, but the service may be unavailable during maintenance, provider outages, internet failures, security events, or other operational interruptions.",
  },
  {
    title: "7. Limitation Language",
    body: "To the extent permitted by law, Nava Strat is provided without guarantees that it will be error-free or uninterrupted. Nava Strat is not a substitute for professional operational, legal, tax, insurance, safety, or financial advice.",
  },
  {
    title: "8. Contact",
    body: "For questions about these terms, contact Nava Strat through your account representative or support channel.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="border-b border-white/10 px-8 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-lg font-semibold">
            Nava Strat
          </Link>
          <div className="flex gap-4 text-sm text-slate-300">
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/login" className="hover:text-white">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="px-8 py-16">
        <div className="mx-auto max-w-5xl">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
            Legal
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-normal">
            Terms of Service
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
            These terms are practical product and legal information for Nava
            Strat. They should be reviewed by qualified counsel before broad
            commercial rollout or use as final customer terms.
          </p>

          <div className="mt-10 grid gap-4">
            {sections.map((section) => (
              <article
                key={section.title}
                className="rounded-lg border border-white/10 bg-white/[0.06] p-6"
              >
                <h2 className="text-lg font-semibold text-white">
                  {section.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {section.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
