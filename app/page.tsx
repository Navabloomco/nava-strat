import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";

const productUrl = "https://navastrat.co";
const companyUrl = "https://www.navabloomco.com";
const contactEmail = "contact@navabloomco.com";
const primaryControlClass =
  "inline-flex items-center justify-center rounded-full bg-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 shadow-[0_14px_40px_rgba(34,211,238,0.18)] ring-1 ring-cyan-100/50 transition hover:bg-cyan-200 hover:shadow-[0_18px_48px_rgba(34,211,238,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";
const secondaryControlClass =
  "inline-flex items-center justify-center rounded-full border border-white/20 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition hover:border-white/35 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";
const navControlClass =
  "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

type LandingMode = "company" | "product";

function normalizeHost(host: string | null) {
  return String(host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function resolveLandingMode(host: string | null): LandingMode {
  const normalizedHost = normalizeHost(host);

  if (
    normalizedHost === "navastrat.co" ||
    normalizedHost === "www.navastrat.co" ||
    normalizedHost === "nava-strat.vercel.app"
  ) {
    return "product";
  }

  return "company";
}

function getLandingModeFromHeaders(): LandingMode {
  const headerList = headers();
  const forwardedHost = headerList.get("x-forwarded-host");
  const host = forwardedHost || headerList.get("host");
  return resolveLandingMode(host);
}

export function generateMetadata(): Metadata {
  const landingMode = getLandingModeFromHeaders();

  if (landingMode === "product") {
    return {
      metadataBase: new URL(productUrl),
      title: "Nava Strat | Fleet Intelligence SaaS",
      description:
        "Nava Strat helps fleet operators connect vehicle activity, journeys, fuel, costs, maintenance signals, and management visibility into one secure workspace.",
      applicationName: "Nava Strat",
      alternates: {
        canonical: "/",
      },
      openGraph: {
        title: "Nava Strat",
        description: "The operating brain for modern fleet companies.",
        url: "/",
        siteName: "Nava Strat",
        type: "website",
      },
    };
  }

  return {
    metadataBase: new URL(companyUrl),
    title: "Nava Bloom Co. | Practical intelligence infrastructure",
    description:
      "Nava Bloom Co. builds software products that help asset-heavy operators see clearly, reduce blind spots, and protect operating margins.",
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
}

const buildAreas = [
  {
    title: "Fleet intelligence platforms",
    body: "Secure workspaces that help operators understand vehicle activity, journeys, fuel movement, operating costs, and fleet patterns.",
  },
  {
    title: "Operational data systems",
    body: "Tools that consolidate fragmented information from the field, the corridor, and the back office into usable management workflows.",
  },
  {
    title: "AI-assisted decision support",
    body: "Context-aware decision support that helps teams spot risk, ask sharper questions, and act with more confidence.",
  },
];

const productCapabilities = [
  {
    title: "Live Fleet Visibility",
    body: "Continuous awareness of operational assets moving across transit networks.",
  },
  {
    title: "Journey & Route Context",
    body: "Consolidating transit timelines, terminal checkpoints, and corridor movements into a single view.",
  },
  {
    title: "Fuel & Cost Awareness",
    body: "Practical visibility into fuel movement, consumption patterns, and operating cost trends.",
  },
  {
    title: "Maintenance & Spares Signals",
    body: "Tracking vehicle readiness signals and replacement cycles without scattering records across tools.",
  },
  {
    title: "Management Visibility",
    body: "Turning fragmented field reports into clear executive summaries for operational decisions.",
  },
];

export default function Home() {
  const landingMode = getLandingModeFromHeaders();

  if (landingMode === "product") {
    return <ProductLandingPage />;
  }

  return <CompanyLandingPage />;
}

function CompanyLandingPage() {
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
                Operational Intelligence Infrastructure
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <a
                href={productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={navControlClass}
              >
                Nava Strat
              </a>
              <a
                href={`mailto:${contactEmail}`}
                className={secondaryControlClass}
              >
                Contact
              </a>
            </div>
          </nav>

          <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-5 inline-flex max-w-full whitespace-normal break-words rounded-md border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium leading-6 text-cyan-100">
                Technology company building operational intelligence products
              </p>
              <h1 className="max-w-5xl break-words text-4xl font-semibold leading-[1.05] tracking-normal text-white sm:text-5xl md:text-7xl">
                Building practical intelligence infrastructure for African operators.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
                Nava Bloom Co. builds software products that help asset-heavy
                teams see operations clearly, reduce blind spots, and protect
                operating margins.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${primaryControlClass} text-center`}
                >
                  Explore Nava Strat
                </a>
                <a
                  href={`mailto:${contactEmail}`}
                  className={`${secondaryControlClass} text-center`}
                >
                  Contact
                </a>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="rounded-md border border-white/10 bg-slate-950/70 p-5">
                <div className="border-b border-white/10 pb-4">
                  <div className="text-sm font-semibold text-white">
                    Company focus
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Practical software for asset-heavy operators
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    ["Built for operators", "Software for teams moving physical assets across trade corridors."],
                    ["Built for clarity", "Consolidating fragmented data into a trusted operations layer."],
                    ["Built for decisions", "Turn chaotic telemetry into clearer operational decisions."],
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

      <section className="border-b border-white/10 bg-[#08111f] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Problem
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              The reality of modern operations
            </h2>
            <p className="mt-5 text-base leading-8 text-slate-300">
              Many operators still rely on disconnected tools, manual updates,
              and fragmented dashboards. Nava Bloom Co. builds systems that make
              operational data easier to trust, harder to lose, and faster to
              act on.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#0b1424] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
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
                className="rounded-lg border border-white/10 bg-white/[0.04] p-6"
              >
                <h3 className="text-lg font-semibold text-slate-100">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#08111f] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Product spotlight
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              Our first platform: Nava Strat
            </h2>
            <p className="mt-5 text-base leading-8 text-slate-300">
              Nava Strat helps fleet operators bring vehicle activity, journeys,
              fuel awareness, operating costs, maintenance signals, and
              management visibility into one secure workspace.
            </p>
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-7 ${primaryControlClass}`}
            >
              Visit Nava Strat
            </a>
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

function ProductLandingPage() {
  return (
    <main className="min-h-screen bg-[#08111f] text-white">
      <section className="border-b border-white/10 bg-[linear-gradient(135deg,#08111f_0%,#0d1b2e_58%,#101827_100%)]">
        <div className="mx-auto flex min-h-[680px] max-w-7xl flex-col px-4 py-6 sm:px-8 sm:py-8">
          <nav className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-wide">
                Nava Strat
              </div>
              <div className="truncate text-xs uppercase tracking-[0.18em] text-cyan-200/70 sm:tracking-[0.24em]">
                Fleet Intelligence SaaS
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <a
                href={companyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={navControlClass}
              >
                Company
              </a>
              <Link href="/login" className={secondaryControlClass}>
                Sign In
              </Link>
            </div>
          </nav>

          <div className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-5 inline-flex max-w-full whitespace-normal break-words rounded-md border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium leading-6 text-cyan-100">
                Fleet intelligence for asset-heavy operators
              </p>
              <h1 className="max-w-5xl break-words text-4xl font-semibold leading-[1.05] tracking-normal text-white sm:text-5xl md:text-7xl">
                The operating brain for modern fleet companies.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
                Nava Strat helps fleet operators connect vehicle activity,
                journeys, fuel, costs, maintenance signals, and management
                visibility into one secure workspace.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/login" className={`${primaryControlClass} text-center`}>
                  Sign In to Dashboard
                </Link>
                <a
                  href={`mailto:${contactEmail}`}
                  className={`${secondaryControlClass} text-center`}
                >
                  Request Fleet Access
                </a>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="rounded-md border border-white/10 bg-slate-950/70 p-5">
                <div className="border-b border-white/10 pb-4">
                  <div className="text-sm font-semibold text-white">
                    Operational workspace
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Built for teams managing moving assets
                  </div>
                </div>
                <div className="mt-5 grid gap-3">
                  {[
                    "Vehicle activity and field movement",
                    "Journey, fuel, cost, and maintenance awareness",
                    "Management summaries for sharper decisions",
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#08111f] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Core capabilities
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              One workspace for fleet operating context.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {productCapabilities.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-6"
              >
                <h3 className="text-lg font-semibold text-slate-100">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#0b1424] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Advanced Fleet Answers
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              Ask sharper operational questions.
            </h2>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
            <p className="text-base leading-8 text-slate-300">
              Nava Eye helps operations teams ask better questions about fleet
              activity, stale vehicles, idle patterns, fuel visibility, and
              operational risk.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#08111f] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Trust
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal md:text-4xl">
              Secure company workspaces with controlled access.
            </h2>
            <p className="mt-5 text-base leading-8 text-slate-300">
              Nava Strat is built for operators who need practical visibility
              across field activity and management workflows without scattering
              decisions across disconnected tools.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#08111f] px-8 py-8 text-sm text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-slate-200">Nava Strat</div>
            <div>A Nava Bloom Co. product.</div>
            <div>Secure company workspaces with controlled access.</div>
          </div>
          <div className="flex flex-wrap gap-5">
            <a
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white"
            >
              Parent Company
            </a>
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
            <a href={`mailto:${contactEmail}`} className="hover:text-white">
              Operator Contact
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
