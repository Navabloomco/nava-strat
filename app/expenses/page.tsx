"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  expenseBaseAmount,
  expenseTotalPaid,
  expenseTransactionCost,
  sumExpenseTotalPaid,
} from "../../lib/finance/expenseTotals";
import {
  EmptyState,
  PageHeader,
  Panel,
  PrimaryButton,
  StatusPill,
} from "../components/ui/Primitives";

type Expense = {
  id: string;
  journey_id: string | null;
  truck: string | null;
  expense_type: string | null;
  amount: number | null;
  transaction_cost: number | null;
  total_paid?: number | null;
  vendor: string | null;
  payment_method: string | null;
  reference_number: string | null;
  trip_reference: string | null;
  notes: string | null;
  created_at: string | null;
};

const inputClass =
  "w-full rounded-md border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300";

function formatMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function labelize(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [journeys, setJourneys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorDetail, setErrorDetail] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setErrorDetail("");

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/expenses", {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const json = await res.json();

    if (!res.ok || !json.success) {
      setErrorDetail(json.error || "Failed to load expenses.");
      setLoading(false);
      return;
    }

    setExpenses(json.expenses || []);
    setJourneys(json.journeys || []);
    setLoading(false);
  }

  function findJourney(journeyId: string | null) {
    if (!journeyId) return null;
    return journeys.find((journey) => journey.id === journeyId) || null;
  }

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return expenses;

    return expenses.filter((expense) => {
      const haystack = [
        expense.truck,
        expense.vendor,
        expense.expense_type,
        expense.payment_method,
        expense.reference_number,
        expense.trip_reference,
        expense.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [expenses, search]);

  const totalAmount = expenses.reduce((sum, expense) => sum + expenseBaseAmount(expense), 0);
  const totalTransactionFees = expenses.reduce(
    (sum, expense) => sum + expenseTransactionCost(expense),
    0
  );
  const totalPaid = sumExpenseTotalPaid(expenses);
  const linkedCount = expenses.filter((expense) => expense.journey_id).length;
  const unallocatedCount = expenses.length - linkedCount;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          dark
          eyebrow="Finance control"
          title="Expense Ledger"
          body="Review operating expenses, transaction fees, payment references, and journey allocation."
          actions={
            <Link href="/expenses/new">
              <PrimaryButton type="button" className="w-full sm:w-auto">
                Add expense
              </PrimaryButton>
            </Link>
          }
        />

        {loading ? (
          <Panel dark className="mt-8 p-6">
            <div className="text-sm text-slate-300">Loading expenses...</div>
          </Panel>
        ) : errorDetail ? (
          <Panel dark className="mt-8 border-rose-300/30 bg-rose-500/10 p-4">
            <div className="text-sm text-rose-100">{errorDetail}</div>
          </Panel>
        ) : (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              <SummaryCard
                label="Expense records"
                value={expenses.length.toLocaleString()}
              />
              <SummaryCard label="Expense amount" value={formatMoney(totalAmount)} />
              <SummaryCard label="Transaction fees" value={formatMoney(totalTransactionFees)} />
              <SummaryCard label="Total paid" value={formatMoney(totalPaid)} />
              <SummaryCard label="Linked to trips" value={linkedCount.toLocaleString()} />
              <SummaryCard
                label="Unallocated"
                value={unallocatedCount.toLocaleString()}
                warning={unallocatedCount > 0}
              />
            </section>

            {expenses.length === 0 ? (
              <div className="mt-8">
                <EmptyState
                  dark
                  title="No expense records yet"
                  body="Add your first expense and link it to an open journey when available."
                  action={
                    <Link href="/expenses/new">
                      <PrimaryButton type="button">Add first expense</PrimaryButton>
                    </Link>
                  }
                />
              </div>
            ) : (
              <Panel dark className="mt-8 overflow-hidden">
                <div className="border-b border-white/10 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">Expense records</h2>
                      <p className="mt-1 text-sm text-slate-400">
                        Search by truck, vendor, type, payment method, reference, trip, or notes.
                      </p>
                    </div>
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search expenses"
                      className={`${inputClass} lg:max-w-sm`}
                    />
                  </div>
                </div>

                {filteredExpenses.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      dark
                      title="No matching expenses"
                      body="Try a different truck, vendor, type, payment reference, or trip reference."
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 p-4 md:hidden">
                      {filteredExpenses.map((expense) => {
                        const journey = findJourney(expense.journey_id);
                        return (
                          <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            journey={journey}
                          />
                        );
                      })}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                      <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                        <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-slate-400">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Date</th>
                            <th className="px-4 py-3 font-semibold">Truck</th>
                            <th className="px-4 py-3 font-semibold">Type</th>
                            <th className="px-4 py-3 font-semibold">Amount</th>
                            <th className="px-4 py-3 font-semibold">Transaction fee</th>
                            <th className="px-4 py-3 font-semibold">Total paid</th>
                            <th className="px-4 py-3 font-semibold">Vendor</th>
                            <th className="px-4 py-3 font-semibold">Payment</th>
                            <th className="px-4 py-3 font-semibold">Reference</th>
                            <th className="px-4 py-3 font-semibold">Trip</th>
                            <th className="px-4 py-3 font-semibold">Journey</th>
                            <th className="px-4 py-3 font-semibold">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 text-slate-200">
                          {filteredExpenses.map((expense) => {
                            const journey = findJourney(expense.journey_id);
                            return (
                              <tr key={expense.id} className="hover:bg-white/[0.03]">
                                <td className="px-4 py-4 text-slate-400">
                                  {formatDate(expense.created_at)}
                                </td>
                                <td className="px-4 py-4 font-semibold text-white">
                                  {expense.truck || "—"}
                                </td>
                                <td className="px-4 py-4">
                                  {labelize(expense.expense_type)}
                                </td>
                                <td className="px-4 py-4 font-semibold text-white">
                                  {formatMoney(expenseBaseAmount(expense))}
                                </td>
                                <td className="px-4 py-4">
                                  {expenseTransactionCost(expense) > 0
                                    ? formatMoney(expenseTransactionCost(expense))
                                    : "—"}
                                </td>
                                <td className="px-4 py-4 font-semibold text-cyan-50">
                                  {formatMoney(expenseTotalPaid(expense))}
                                </td>
                                <td className="px-4 py-4">{expense.vendor || "—"}</td>
                                <td className="px-4 py-4">
                                  {labelize(expense.payment_method)}
                                </td>
                                <td className="px-4 py-4">
                                  {expense.reference_number || "—"}
                                </td>
                                <td className="px-4 py-4">
                                  {expense.trip_reference || "—"}
                                </td>
                                <td className="px-4 py-4">
                                  {journey ? (
                                    <div>
                                      <div className="font-semibold text-white">
                                        {journey.client_name || "No client"}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-400">
                                        {journey.from_location || "—"} →{" "}
                                        {journey.to_location || "—"}
                                      </div>
                                    </div>
                                  ) : expense.journey_id ? (
                                    <StatusPill tone="warning">Missing journey</StatusPill>
                                  ) : (
                                    <StatusPill tone="neutral">Unallocated</StatusPill>
                                  )}
                                </td>
                                <td className="px-4 py-4">{expense.notes || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <Panel dark className="p-5">
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </div>
      <div
        className={
          warning
            ? "mt-3 text-3xl font-semibold text-amber-100"
            : "mt-3 text-3xl font-semibold text-white"
        }
      >
        {value}
      </div>
    </Panel>
  );
}

function ExpenseCard({
  expense,
  journey,
}: {
  expense: Expense;
  journey: any;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-white">
            {expense.truck || "No truck"}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">
            {formatDate(expense.created_at)}
          </div>
        </div>
        <StatusPill tone={expense.journey_id ? "success" : "neutral"}>
          {expense.journey_id ? "Linked" : "Unallocated"}
        </StatusPill>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <Detail label="Type" value={labelize(expense.expense_type)} />
        <Detail label="Expense amount" value={formatMoney(expenseBaseAmount(expense))} />
        <Detail
          label="Transaction fee"
          value={
            expenseTransactionCost(expense) > 0
              ? formatMoney(expenseTransactionCost(expense))
              : "—"
          }
        />
        <Detail label="Total paid" value={formatMoney(expenseTotalPaid(expense))} strong />
        <Detail label="Vendor" value={expense.vendor || "—"} />
        <Detail label="Payment" value={labelize(expense.payment_method)} />
        <Detail label="Reference" value={expense.reference_number || "—"} />
        <Detail label="Trip reference" value={expense.trip_reference || "—"} />
        <Detail
          label="Journey"
          value={
            journey
              ? `${journey.client_name || "No client"} · ${
                  journey.from_location || "—"
                } → ${journey.to_location || "—"}`
              : "—"
          }
        />
        <Detail label="Notes" value={expense.notes || "—"} />
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div
        className={
          strong
            ? "mt-1 font-semibold text-white"
            : "mt-1 break-words text-slate-200"
        }
      >
        {value}
      </div>
    </div>
  );
}
