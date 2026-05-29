import Link from "next/link";

const contactEmail = "contact@navabloomco.com";

export default function ClientVisibilityLandingPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-8 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold">
            Nava Strat
          </Link>
          <Link
            href="/privacy"
            className="text-sm font-medium text-slate-300 hover:text-white"
          >
            Privacy
          </Link>
        </header>

        <section className="flex flex-1 items-center py-16">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Client visibility
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-normal sm:text-5xl">
              Secure delivery visibility links are shared by your transport partner.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">
              Nava Strat client links open a privacy-limited delivery view for a
              specific customer relationship. The page does not list companies,
              trips, trucks, or tracking data without a valid secure link.
            </p>
            <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.06] p-5">
              <h2 className="text-lg font-semibold">Need a current link?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Please contact your transport partner for the latest delivery
                visibility link. If you believe a link has expired or was revoked,
                request a newly generated link from the same team.
              </p>
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${contactEmail}`}
                className="inline-flex justify-center rounded-md bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200"
              >
                Contact Nava Bloom
              </a>
              <Link
                href="/"
                className="inline-flex justify-center rounded-md border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                Back to Nava Strat
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
