import "./globals.css";
import AppShell from "./components/AppShell";
import type { Metadata } from "next";

function resolveMetadataBase() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://navastrat.co";

  try {
    return new URL(configuredUrl);
  } catch {
    return new URL("https://navastrat.co");
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "Nava Strat",
  description: "Fleet Intelligence Platform",
  applicationName: "Nava Strat",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Nava Strat",
    description: "Fleet Intelligence Platform",
    url: "/",
    siteName: "Nava Strat",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
