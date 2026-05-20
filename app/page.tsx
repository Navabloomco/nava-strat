import Link from "next/link";
import type { Metadata } from "next";

const productUrl = "https://navastrat.co";
const contactEmail = "contact@navabloomco.com";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.navabloomco.com"),
  title: "Nava Bloom Co. | Practical intelligence infrastructure",
  description:
    "Nava Bloom Co. builds software products for asset-heavy operators, starting with Nava Strat.",
  applicationName: "Nava Bloom Co.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Nava Bloom Co.",
    description:
      "Building practical intelligence infrastructure for African operators.",
    url: "/",
    siteName: "Nava Bloom Co.",
    type: "website",
  },
};

const buildAreas = [
  {
    title: "Fleet intelligence platforms",
    body: "Secure workspaces that help operators understand vehicle activity, journeys, costs, and operational patterns.",
  },
  {
    title: "Operational data systems",
    body: "Practical tools that bring fragmented information into clearer, more usable business workflows.",
  },
  {
    title: "AI-assisted decision support",
    body: "Decision support that helps teams ask better questions and act with more confidence from the data they already have.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#08111f] text-white">
      <section className="border-b border-white/10 bg-[linear-gradient(135deg,#08111f_0%,#0d1b2e_58%,#101827_100%)]">
        <div className="mx-auto flex min-h-[700px] max-w-7xl flex-col px-4 py-6 sm:px-8 sm:py-8">
          <nav className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-wide">
                Nava Bloom Co.
              </div>
              <div className="truncate text-xs uppercase tracking-[0.18em] text-cyan-200/70 sm:tracking-[0.24em]">
                Builder of Nava Strat
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
              >
                Nava Strat
              </a>
              <a
                href={`mailto:${contactEmail}`}
                className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              >
                Contact
              </a>
            </div>
          </nav>

          <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-5 inline-flex max-w-full whitespace-normal break-words rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium leading-6 text-cyan-100">
                Technology company building operational intelligence products
              </p>
              <h1 className="max-w-5xl break-words text-4xl font-semibold leading-[1.05] tracking-normal text-white sm:text-5xl md:text-7xl">
                Building practical intelligence infrastructure for African operators.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
                Nava Bloom Co. builds software products that help asset-heavy
                teams see operations clearly, reduce blind spots, and make better
                decisions.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-cyan-300 px-5 py-3 text-center text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/30 hover:bg-cyan-200"
                >
                  Explore Nava Strat
                </a>
                <a
                  href={`mailto:${contactEmail}`}
                  className="rounded-md border border-white/20 px-5 py-3 text-center text-sm font-semibold text-white hover:bg-white/10"
                >
                  Contact
                </a>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="rounded-md border border-white/10 bg-slate-950/70 p-5">
                <div className="border-b border-white/10 pb-4">
                  <div className="text-sm font-semibold text-white">
                    Practical operating clarity
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    High-level signals Nava Bloom Co. builds for
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    ["Fleet visibility", "See what is happening across assets."],
                    ["Cost awareness", "Understand fuel, journey, and operating cost movement."],
                    ["Decision support", "Give teams clearer questions and better next steps."],
                    ["Secure workspace", "Keep business operations inside controlled access."],
                  ].map(([title, body]) => (
                    <div
                      key={title}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-slate-100">
                        {title}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        {body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-16 text-slate-950 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-700">
                Our first platform
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
                Nava Strat
              </h2>
              <p className="mt-5 text-base leading-8 text-slate-600">
                Nava Strat helps fleet operators bring vehicle activity,
                journeys, fuel, operating costs, maintenance signals, and
                management visibility into one secure workspace.
              </p>
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-7 inline-flex rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Visit Nava Strat
              </a>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="text-xl font-semibold">Why it matters</h3>
              <p className="mt-4 text-base leading-8 text-slate-600">
                Many operators still rely on disconnected tools, manual updates,
                and fragmented dashboards. Nava Bloom Co. builds systems that
                make operational data easier to trust and act on.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-16 text-slate-950 sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-700">
              What we build
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              Focused products for asset-heavy businesses.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {buildAreas.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-slate-200 bg-slate-50 p-6"
              >
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#08111f] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Company
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              Kenya-registered and founder-led.
            </h2>
            <p className="mt-5 text-base leading-8 text-slate-300">
              Nava Bloom Co. is a Kenya-registered technology company building
              operational intelligence products for asset-heavy businesses.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#08111f] px-8 py-8 text-sm text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-slate-200">Nava Bloom Co.</div>
            <div>Builder of Nava Strat.</div>
            <a href={`mailto:${contactEmail}`} className="hover:text-white">
              {contactEmail}
            </a>
          </div>
          <div className="flex flex-wrap gap-5">
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              Nava Strat
            </a>
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <a href={`mailto:${contactEmail}`} className="hover:text-white">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
