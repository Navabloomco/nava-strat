import type { ButtonHTMLAttributes, ReactNode } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  body?: string;
  actions?: ReactNode;
  dark?: boolean;
};

export function PageHeader({
  eyebrow,
  title,
  body,
  actions,
  dark = false,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between dark:border-white/10">
      <div>
        {eyebrow && (
          <p
            className={
              dark
                ? "text-xs font-bold uppercase tracking-[0.18em] text-cyan-200"
                : "text-xs font-bold uppercase tracking-[0.18em] text-cyan-700"
            }
          >
            {eyebrow}
          </p>
        )}
        <h1
          className={
            dark
              ? "mt-3 text-4xl font-semibold tracking-normal text-white"
              : "mt-3 text-4xl font-semibold tracking-normal text-slate-950"
          }
        >
          {title}
        </h1>
        {body && (
          <p
            className={
              dark
                ? "mt-3 max-w-2xl text-sm leading-6 text-slate-300"
                : "mt-3 max-w-2xl text-sm leading-6 text-slate-600"
            }
          >
            {body}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  dark = false,
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <section
      className={
        dark
          ? `rounded-lg border border-white/10 bg-white/[0.06] ${className}`
          : `rounded-lg border border-slate-200 bg-white ${className}`
      }
    >
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  action,
  dark = false,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <Panel dark={dark} className="p-6">
      <h2 className={dark ? "text-xl font-semibold text-white" : "text-xl font-semibold text-slate-950"}>
        {title}
      </h2>
      <p className={dark ? "mt-2 text-sm leading-6 text-slate-300" : "mt-2 text-sm leading-6 text-slate-600"}>
        {body}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </Panel>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const classes: Record<string, string> = {
    neutral: "border-slate-300/30 bg-slate-300/10 text-slate-200",
    success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
    warning: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    danger: "border-rose-300/30 bg-rose-300/10 text-rose-100",
    info: "border-cyan-200/30 bg-cyan-300/10 text-cyan-100",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}
    >
      {children}
    </span>
  );
}

export function PrimaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    />
  );
}

export function SecondaryButton({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md border border-white/15 px-4 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    />
  );
}

export function FormField({
  label,
  children,
  dark = false,
}: {
  label: string;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={
          dark
            ? "text-xs font-bold uppercase tracking-[0.12em] text-slate-300"
            : "text-xs font-bold uppercase tracking-[0.12em] text-slate-600"
        }
      >
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
