alter table public.expenses
  add column if not exists transaction_cost numeric not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_transaction_cost_non_negative'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_transaction_cost_non_negative
      check (transaction_cost >= 0)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_amount_non_negative'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_amount_non_negative
      check (amount is null or amount >= 0)
      not valid;
  end if;
end $$;
