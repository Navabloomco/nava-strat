"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

const publicRoutes = new Set(["/", "/login", "/pricing", "/terms", "/privacy"]);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute =
    publicRoutes.has(pathname || "/") ||
    Boolean(pathname?.startsWith("/client/track"));

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main className="min-h-screen bg-slate-50 pl-[240px]">{children}</main>
    </>
  );
}
