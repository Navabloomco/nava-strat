import Link from "next/link";

const sections = [
  {
    title: "1. Account Data",
    body: "We may collect account details such as name, work email, authentication information, role, company membership, and support communications so users can access and manage Nava Strat.",
  },
  {
    title: "2. Company Data",
    body: "We may process company profile information, workspace settings, users, operational records, journeys, expenses, revenue information, and other business content submitted to the platform.",
  },
  {
    title: "3. Fleet and Location Data",
    body: "When a company connects vehicle or telemetry providers, Nava Strat may process fleet identifiers, current and historical location data, timestamps, speed, fuel readings, movement history, events, and related operational signals.",
  },
  {
    title: "4. Provider Connection Data",
    body: "Provider access details are used to connect approved data sources and are handled with care. We do not display saved provider secrets back to users after saving.",
  },
  {
    title: "5. Usage and Security Logs",
    body: "We may collect usage, device, browser, network, audit, and security logs to operate the service, investigate issues, protect accounts, and improve product reliability.",
  },
  {
    title: "6. How Data Is Used",
    body: "Data is used to provide the Nava Strat workspace, power Nava Eye, generate operational insights, support customer workflows, improve reliability, secure the platform, and communicate with users.",
  },
  {
    title: "7. Sharing",
    body: "We may share data with service providers that help operate Nava Strat, with connected providers as needed to provide the service, when required by law, or with customer authorization. We do not sell customer fleet data.",
  },
  {
    title: "8. Retention",
    body: "Data is retained for as long as needed to provide the service, meet contractual or legal obligations, resolve disputes, maintain security, and support legitimate business operations.",
  },
  {
    title: "9. Security",
    body: "Nava Strat uses administrative, technical, and organizational safeguards intended to protect customer workspaces. No online service can guarantee absolute security.",
  },
  {
    title: "10. User Choices",
    body: "Users may request help accessing, correcting, exporting, or deleting information where available and legally appropriate. Some records may be retained where required for security, compliance, or operational integrity.",
  },
  {
    title: "11. Contact",
    body: "For privacy questions, contact Nava Strat through your account representative or support channel.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="border-b border-white/10 px-8 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="text-lg font-semibold">
            Nava Strat
          </Link>
          <div className="flex gap-4 text-sm text-slate-300">
            <Link href="/terms" className="hover:text-white">
              Terms
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
            Privacy
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-normal">
            Privacy Notice
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
            This notice is practical privacy information for Nava Strat. It
            should be reviewed by qualified counsel before broad commercial
            rollout or use as a final customer privacy notice.
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
