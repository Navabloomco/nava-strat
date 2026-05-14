import "./globals.css";
import Sidebar from "./components/Sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nava Strat",
  description: "Fleet Intelligence Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main className="min-h-screen bg-slate-50 pl-[240px]">
          {children}
        </main>
      </body>
    </html>
  );
}
