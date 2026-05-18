"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { PageHeader, Panel } from "../../components/ui/Primitives";

export default function TrackingProvidersPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    checkAccess();
  }, []);

  async function checkAccess() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json();

      if (!res.ok || !json.success || !json.is_platform_owner) {
        window.location.href = "/tracking/live";
        return;
      }

      setLoading(false);
    } catch {
      setMessage("Unable to verify access. Please refresh or contact support.");
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Checking access...</div>
        </Panel>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          dark
          eyebrow="Internal tooling"
          title="Legacy tracking providers retired"
          body="This workflow has moved into secured provider setup, asset review, and live tracking."
        />

        {message && (
          <Panel dark className="mt-8 border-amber-300/30 bg-amber-300/10 p-4">
            <div className="text-sm text-amber-50">{message}</div>
          </Panel>
        )}

        <Panel dark className="mt-8 p-6">
          <RetiredLinks />
        </Panel>
      </div>
    </main>
  );
}

function RetiredLinks() {
  const links = [
    { href: "/admin/providers", label: "Provider Vault" },
    { href: "/admin/providers/new", label: "Add Provider" },
    { href: "/admin/assets", label: "Asset Review" },
    { href: "/tracking/live", label: "Live Tracking" },
    { href: "/admin/client-visibility", label: "Client Visibility" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm font-semibold text-slate-100 hover:border-cyan-200/40 hover:bg-cyan-300/10 hover:text-cyan-100"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
