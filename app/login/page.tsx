"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type AuthMode = "signin" | "signup";

const PASSWORD_REQUIREMENT_MESSAGE =
  "Use at least 10 characters with uppercase, lowercase, a number, and a symbol.";

function validateSignupPassword(email: string, password: string) {
  const localPart = email.split("@")[0]?.trim().toLowerCase() || "";
  const passwordLower = password.toLowerCase();
  const hasMinimumLength = password.length >= 10;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const includesEmailLocalPart =
    localPart.length >= 3 && passwordLower.includes(localPart);

  if (
    !hasMinimumLength ||
    !hasUppercase ||
    !hasLowercase ||
    !hasNumber ||
    !hasSymbol ||
    includesEmailLocalPart
  ) {
    return PASSWORD_REQUIREMENT_MESSAGE;
  }

  return "";
}

export default function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (window.location.search.includes("signup")) {
      setMode("signup");
    }

    async function routeExistingSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) return;

      setLoading(true);
      setMessage("Checking your workspace...");

      try {
        await routeAfterAuth(session.access_token);
      } catch (err) {
        console.error("Existing session routing failed:", err);
        setMessage("We could not finish routing your session. Please refresh or contact support if this continues.");
        setLoading(false);
      }
    }

    routeExistingSession();
  }, []);

  async function routeAfterAuth(accessToken: string) {
    try {
      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const json = await res.json();

      if (res.ok && json.success && (json.companies || []).length > 0) {
        window.location.href = "/dashboard";
        return;
      }

      window.location.href = "/onboarding";
    } catch (err) {
      console.error("Auth routing failed:", err);
      throw err;
    }
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    setLoading(true);
    setMessage(mode === "signin" ? "Signing in..." : "Creating account...");

    if (mode === "signup") {
      const passwordError = validateSignupPassword(email, password);
      if (passwordError) {
        setMessage(passwordError);
        setLoading(false);
        return;
      }
    }

    const authResult =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (authResult.error) {
      setMessage(authResult.error.message);
      setLoading(false);
      return;
    }

    const session = authResult.data.session;

    if (!session?.access_token) {
      setMessage(
        mode === "signup"
          ? "Account created. Check your email to confirm your account, then sign in."
          : "Signed in, but no session was returned. Please try again."
      );
      setLoading(false);
      return;
    }

    try {
      await routeAfterAuth(session.access_token);
    } catch {
      setMessage("We could not finish signing you in. Please refresh or contact support if this continues.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="grid min-h-screen lg:grid-cols-[0.95fr_1.05fr]">
        <div className="flex flex-col justify-between border-r border-white/10 px-8 py-8">
          <Link href="/" className="text-lg font-semibold">
            Nava Strat
          </Link>
          <div className="max-w-xl py-16">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-200">
              Nava Eye ready
            </p>
            <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-normal">
              Sign in to your fleet intelligence workspace.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Access your fleet operations, live provider data, fuel risk,
              profitability context, and the Nava Eye copilot from one secure SaaS entry.
            </p>
          </div>
          <Link href="/pricing" className="text-sm font-medium text-slate-300 hover:text-white">
            View pricing
          </Link>
        </div>

        <div className="flex items-center justify-center px-8 py-16">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
            <div className="mb-6 grid grid-cols-2 rounded-md border border-white/10 bg-slate-950/70 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setMessage("");
                }}
                className={`rounded px-4 py-2 text-sm font-semibold ${
                  mode === "signin"
                    ? "bg-cyan-300 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                }}
                className={`rounded px-4 py-2 text-sm font-semibold ${
                  mode === "signup"
                    ? "bg-cyan-300 text-slate-950"
                    : "text-slate-300 hover:bg-white/10"
                }`}
              >
                Create account
              </button>
            </div>

            <h2 className="text-2xl font-semibold">
              {mode === "signin" ? "Welcome back" : "Start your Nava Strat trial"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {mode === "signin"
                ? "Use your work email to continue into your company workspace."
                : "Create your user account first. Company setup continues in onboarding."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Work email</span>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-4 py-3 text-white outline-none focus:border-cyan-300"
                  required
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-200">Password</span>
                <div className="mt-2 flex rounded-md border border-white/10 bg-slate-950 focus-within:border-cyan-300">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-w-0 flex-1 rounded-l-md bg-transparent px-4 py-3 text-white outline-none"
                    required
                    minLength={mode === "signup" ? 10 : 6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="rounded-r-md border-l border-white/10 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100 hover:bg-white/10"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {mode === "signup" && (
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Use at least 10 characters with uppercase, lowercase, a number,
                    and a symbol.
                  </p>
                )}
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? "Please wait..."
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>

              {mode === "signup" && (
                <p className="text-xs leading-5 text-slate-400">
                  By creating an account, you agree to the Nava Strat{" "}
                  <Link href="/terms" className="text-cyan-200 hover:text-cyan-100">
                    Terms
                  </Link>{" "}
                  and acknowledge the{" "}
                  <Link href="/privacy" className="text-cyan-200 hover:text-cyan-100">
                    Privacy Notice
                  </Link>
                  .
                </p>
              )}
            </form>

            {message && (
              <div className="mt-5 rounded-md border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-200">
                {message}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
