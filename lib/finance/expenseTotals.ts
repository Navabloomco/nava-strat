export function moneyNumber(value: any) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function expenseBaseAmount(expense: any) {
  return moneyNumber(expense?.amount);
}

export function expenseTransactionCost(expense: any) {
  return moneyNumber(expense?.transaction_cost);
}

export function expenseTotalPaid(expense: any) {
  return moneyNumber(expenseBaseAmount(expense) + expenseTransactionCost(expense));
}

export function sumExpenseTotalPaid(expenses: any[] = []) {
  return moneyNumber(
    expenses.reduce((sum, expense) => sum + expenseTotalPaid(expense), 0)
  );
}

export function withExpenseTotalPaid<T extends Record<string, any>>(expense: T) {
  return {
    ...expense,
    transaction_cost: expenseTransactionCost(expense),
    total_paid: expenseTotalPaid(expense),
  };
}

export function withExpenseTotals<T extends Record<string, any>>(expenses: T[] = []) {
  return expenses.map((expense) => withExpenseTotalPaid(expense));
}
