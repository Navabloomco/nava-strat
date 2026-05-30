"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import {
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  PrimaryButton,
  SecondaryButton,
  StatusPill,
} from "../../components/ui/Primitives";

type CompanyOption = {
  id: string;
  name: string;
  slug: string;
};

type TeamUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  protected_role?: boolean;
  account_created_at?: string | null;
  last_sign_in_at?: string | null;
};

type TeamInvitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_at?: string | null;
  invite_error?: string | null;
  invite_error_category?: string | null;
};

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "ops", label: "Ops" },
  { value: "finance", label: "Finance" },
  { value: "management", label: "Management" },
];

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-60";

export default function TeamAccessPage() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [inviteMode, setInviteMode] = useState("");
  const [warning, setWarning] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("ops");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    initialize();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadTeamAccess(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  const activeCount = useMemo(
    () => users.filter((user) => user.is_active).length,
    [users]
  );

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return null;
    }

    return session.access_token;
  }

  async function initialize() {
    setLoading(true);
    setError("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/companies", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to load companies.");
      }

      const nextCompanies = json.companies || [];
      const requestedCompanyId = companyIdFromLocation();
      setCompanies(nextCompanies);
      setIsPlatformOwner(Boolean(json.is_platform_owner));
      setSelectedCompanyId(
        nextCompanies.some((item: CompanyOption) => item.id === requestedCompanyId)
          ? requestedCompanyId
          : nextCompanies[0]?.id || ""
      );
    } catch (err: any) {
      setError(err.message || "Unable to load Team Access.");
      setLoading(false);
    }
  }

  async function loadTeamAccess(companyId = selectedCompanyId) {
    if (!companyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch(
        `/api/admin/team-access?companyId=${encodeURIComponent(companyId)}`,
        {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to load Team Access.");
      }

      setCompany(json.company || null);
      setUsers(json.users || []);
      setInvitations(json.invitations || []);
      setInviteMode(json.invite_flow?.message || "");
      setWarning(json.warning || "");
    } catch (err: any) {
      setError(err.message || "Unable to load Team Access.");
    } finally {
      setLoading(false);
    }
  }

  async function inviteUser(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/team-access", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          email: newEmail,
          role: newRole,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to add user.");
      }

      setNewEmail("");
      setNewRole("ops");
      setMessage(json.message || "Team access updated.");
      await loadTeamAccess(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Unable to add user.");
    } finally {
      setSaving(false);
    }
  }

  async function updateInvitation(invitation: TeamInvitation, action: "resend_invite" | "revoke_invite") {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/team-access", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          invitationId: invitation.id,
          action,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to update invitation.");
      }

      setMessage(json.message || "Invitation updated.");
      await loadTeamAccess(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Unable to update invitation.");
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(user: TeamUser, updates: { role?: string; isActive?: boolean }) {
    setSaving(true);
    setError("");
    setMessage("");

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/admin/team-access", {
        method: "PATCH",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          userId: user.user_id,
          ...updates,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to update user.");
      }

      setMessage(json.message || "Team access updated.");
      await loadTeamAccess(selectedCompanyId);
    } catch (err: any) {
      setError(err.message || "Unable to update user.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !company) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <Panel dark className="p-6">
          <div className="text-sm text-slate-300">Loading Team Access...</div>
        </Panel>
      </main>
    );
  }

  if (!loading && companies.length === 0) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
        <div className="mx-auto max-w-4xl">
          <EmptyState
            dark
            title="No company workspace available"
            body="Team Access needs an active company membership before users can be managed."
            action={
              <Link href="/dashboard">
                <PrimaryButton type="button">Open Dashboard</PrimaryButton>
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Company admin"
          title="Team Access"
          body="Manage who can enter this workspace and which operating role they use. Email invitations are intentionally controlled in this release."
          actions={
            <SecondaryButton type="button" onClick={() => loadTeamAccess()}>
              Refresh
            </SecondaryButton>
          }
        />

        {isPlatformOwner && company && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-100">
                  Platform tenant context
                </div>
                <div className="mt-1 text-sm text-cyan-50">
                  Managing team access for <span className="font-semibold">{company.name}</span>
                </div>
              </div>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className={`${inputClass} max-w-sm`}
              >
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </Panel>
        )}

        {error && (
          <Panel dark className="mt-6 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm leading-6 text-rose-100">{error}</div>
          </Panel>
        )}

        {message && (
          <Panel dark className="mt-6 border-cyan-200/20 bg-cyan-300/10 p-4">
            <div className="text-sm text-cyan-50">{message}</div>
          </Panel>
        )}

        {warning && (
          <Panel dark className="mt-6 border-amber-300/30 bg-amber-500/10 p-4">
            <div className="text-sm leading-6 text-amber-100">{warning}</div>
          </Panel>
        )}

        <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <Panel dark className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Current users
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  {company?.name || "Company workspace"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info">{users.length} total</StatusPill>
                <StatusPill tone="success">{activeCount} active</StatusPill>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead className="border-b border-white/10 bg-white/[0.03]">
                  <tr>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      User
                    </th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      Role
                    </th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      Status
                    </th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      Account
                    </th>
                    <th className="px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {users.map((user) => {
                    const protectedRole = Boolean(user.protected_role);
                    return (
                      <tr key={user.user_id} className="align-top">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-white">
                            {user.full_name || user.email || "User"}
                          </div>
                          <div className="mt-1 text-sm text-slate-400">
                            {user.email || user.user_id}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          {protectedRole ? (
                            <>
                              <StatusPill tone="warning">Protected role</StatusPill>
                              <p className="mt-2 text-xs leading-5 text-slate-500">
                                This access level cannot be edited here.
                              </p>
                            </>
                          ) : (
                            <select
                              value={ROLE_OPTIONS.some((role) => role.value === user.role) ? user.role : "ops"}
                              onChange={(event) =>
                                updateUser(user, { role: event.target.value })
                              }
                              disabled={saving}
                              className={inputClass}
                            >
                              {ROLE_OPTIONS.map((role) => (
                                <option key={role.value} value={role.value}>
                                  {role.label}
                                </option>
                              ))}
                            </select>
                          )}
                          {!protectedRole && !ROLE_OPTIONS.some((role) => role.value === user.role) && (
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              This role is not part of the controlled workspace role set.
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <StatusPill tone={user.is_active ? "success" : "neutral"}>
                            {user.is_active ? "Active" : "Inactive"}
                          </StatusPill>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-400">
                          {user.last_sign_in_at
                            ? `Last sign-in ${formatDate(user.last_sign_in_at)}`
                            : user.account_created_at
                              ? `Created ${formatDate(user.account_created_at)}`
                              : "Account date unavailable"}
                        </td>
                        <td className="px-5 py-4">
                          <SecondaryButton
                            type="button"
                            onClick={() =>
                              updateUser(user, { isActive: !user.is_active })
                            }
                            disabled={saving || protectedRole}
                          >
                            {user.is_active ? "Deactivate" : "Reactivate"}
                          </SecondaryButton>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td className="px-5 py-8 text-sm text-slate-400" colSpan={5}>
                        No users are linked to this company yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            </Panel>

            <Panel dark className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    Pending invitations
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Invited users are added after accepting the email invitation and signing in.
                  </p>
                </div>
                <StatusPill tone={invitations.length > 0 ? "info" : "neutral"}>
                  {invitations.length} open
                </StatusPill>
              </div>

              <div className="divide-y divide-white/10">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="break-words font-semibold text-white">
                        {invitation.email}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill tone={invitation.status === "failed" ? "danger" : "warning"}>
                          {invitation.status === "failed" ? "Needs attention" : "Pending"}
                        </StatusPill>
                        <StatusPill tone="neutral">{labelForRole(invitation.role)}</StatusPill>
                      </div>
                      <div className="mt-2 text-sm text-slate-400">
                        {invitation.invited_at
                          ? `Invited ${formatDate(invitation.invited_at)}`
                          : "Invite date unavailable"}
                      </div>
                      {invitation.invite_error && (
                        <div className="mt-2 max-w-2xl text-sm leading-6 text-rose-200">
                          {invitation.invite_error}
                          {invitation.invite_error_category === "existing_auth_user" && (
                            <span className="block text-rose-100/80">
                              Resend will use the verification email path for this existing account.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton
                        type="button"
                        onClick={() => updateInvitation(invitation, "resend_invite")}
                        disabled={saving}
                      >
                        Resend
                      </SecondaryButton>
                      <SecondaryButton
                        type="button"
                        onClick={() => updateInvitation(invitation, "revoke_invite")}
                        disabled={saving}
                      >
                        Revoke
                      </SecondaryButton>
                    </div>
                  </div>
                ))}
                {invitations.length === 0 && (
                  <div className="p-5 text-sm text-slate-400">
                    No pending invitations.
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <div className="grid gap-5">
            <Panel dark className="p-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-200">
                Invite by email
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Send a secure invitation. If the user already has an account,
                Nava will add or reactivate workspace access.
              </p>

              <form onSubmit={inviteUser} className="mt-5 grid gap-4">
                <FormField label="Work email" dark>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder="name@company.com"
                    className={inputClass}
                    required
                  />
                </FormField>
                <FormField label="Role" dark>
                  <select
                    value={newRole}
                    onChange={(event) => setNewRole(event.target.value)}
                    className={inputClass}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <PrimaryButton type="submit" disabled={saving || !newEmail.trim()}>
                  {saving ? "Sending..." : "Send invitation"}
                </PrimaryButton>
              </form>
            </Panel>

            <Panel dark className="p-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Controlled access
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {inviteMode ||
                  "Invite users by email. They are added after accepting the invitation and signing in."}
              </p>
              <div className="mt-4 grid gap-2 text-sm leading-6 text-slate-400">
                <p>Ops captures Trips, proof, tracking, and availability context.</p>
                <p>Finance controls rates, revenue review, fuel costs, and contribution review.</p>
                <p>Management reviews contribution and intelligence without provider setup controls.</p>
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function companyIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("companyId") || "";
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-KE", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function labelForRole(role: string) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label || "Role";
}
