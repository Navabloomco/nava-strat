"use client";

import Link from "next/link";

type NavaEyePromptLinkVariant = "primary" | "subtle" | "rowAction" | "chip";

type NavaEyePromptLinkProps = {
  label: string;
  prompt: string;
  companyId?: string | null;
  contextType?: string;
  contextId?: string | null;
  variant?: NavaEyePromptLinkVariant;
  className?: string;
  title?: string;
};

const variantClasses: Record<NavaEyePromptLinkVariant, string> = {
  primary:
    "inline-flex items-center justify-center rounded-md bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-200",
  subtle:
    "inline-flex items-center justify-center rounded-md border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200/45 hover:bg-cyan-300/15",
  rowAction:
    "inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-cyan-200/35 hover:bg-cyan-300/10 hover:text-cyan-100",
  chip:
    "inline-flex max-w-full items-center justify-center rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold leading-5 text-cyan-100 hover:border-cyan-200/50 hover:bg-cyan-300/15",
};

export default function NavaEyePromptLink({
  label,
  prompt,
  companyId,
  contextType,
  contextId,
  variant = "subtle",
  className = "",
  title,
}: NavaEyePromptLinkProps) {
  return (
    <Link
      href={buildNavaEyeHref({ prompt, companyId, contextType, contextId })}
      className={`${variantClasses[variant]} ${className}`.trim()}
      title={title || label}
    >
      {label}
    </Link>
  );
}

function buildNavaEyeHref({
  prompt,
  companyId,
  contextType,
  contextId,
}: {
  prompt: string;
  companyId?: string | null;
  contextType?: string;
  contextId?: string | null;
}) {
  const params = new URLSearchParams();
  const currentCompanyId =
    companyId || (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("companyId")
      : "");

  if (currentCompanyId) params.set("companyId", currentCompanyId);
  if (prompt.trim()) params.set("prompt", prompt.trim());
  if (contextType) params.set("contextType", contextType);
  if (contextId) params.set("contextId", contextId);

  const query = params.toString();
  return query ? `/nava-eye?${query}` : "/nava-eye";
}
