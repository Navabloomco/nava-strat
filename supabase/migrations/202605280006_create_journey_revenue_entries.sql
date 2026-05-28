create extension if not exists pgcrypto;

create table if not exists public.journey_revenue_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  journey_id uuid not null references public.journeys(id) on delete cascade,
  rate_rule_id uuid null references public.client_rate_rules(id) on delete set null,
  revenue_source text not null,
  billing_quantity numeric null,
  billing_unit text null,
  rate_amount numeric null,
  currency text null,
  fx_rate_to_kes numeric null,
  revenue_original numeric null,
  revenue_kes numeric null,
  override_reason text null,
  applied_by uuid null,
  applied_at timestamptz not null default now(),
  notes text null,
  constraint journey_revenue_entries_source_check
    check (
      revenue_source in (
        'configured_rate',
        'manual_finance_entry',
        'overridden',
        'missing'
      )
    ),
  constraint journey_revenue_entries_billing_quantity_nonnegative
    check (billing_quantity is null or billing_quantity >= 0),
  constraint journey_revenue_entries_rate_amount_nonnegative
    check (rate_amount is null or rate_amount >= 0),
  constraint journey_revenue_entries_fx_rate_positive
    check (fx_rate_to_kes is null or fx_rate_to_kes > 0),
  constraint journey_revenue_entries_revenue_original_nonnegative
    check (revenue_original is null or revenue_original >= 0),
  constraint journey_revenue_entries_revenue_kes_nonnegative
    check (revenue_kes is null or revenue_kes >= 0)
);

create index if not exists journey_revenue_entries_company_id_idx
  on public.journey_revenue_entries(company_id);

create index if not exists journey_revenue_entries_journey_id_idx
  on public.journey_revenue_entries(journey_id);

create index if not exists journey_revenue_entries_rate_rule_id_idx
  on public.journey_revenue_entries(rate_rule_id);

create index if not exists journey_revenue_entries_revenue_source_idx
  on public.journey_revenue_entries(company_id, revenue_source);

create index if not exists journey_revenue_entries_applied_at_idx
  on public.journey_revenue_entries(company_id, applied_at desc);

alter table public.journey_revenue_entries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'journey_revenue_entries'
      and policyname = 'journey_revenue_entries_finance_select'
  ) then
    create policy journey_revenue_entries_finance_select
      on public.journey_revenue_entries
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = journey_revenue_entries.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance',
                  'management'
                )
              )
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'journey_revenue_entries'
      and policyname = 'journey_revenue_entries_finance_insert'
  ) then
    create policy journey_revenue_entries_finance_insert
      on public.journey_revenue_entries
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = journey_revenue_entries.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance'
                )
              )
            )
        )
        and exists (
          select 1
          from public.journeys j
          where j.id = journey_revenue_entries.journey_id
            and j.company_id = journey_revenue_entries.company_id
            and coalesce(j.is_demo, false) = false
        )
        and (
          journey_revenue_entries.rate_rule_id is null
          or exists (
            select 1
            from public.client_rate_rules r
            where r.id = journey_revenue_entries.rate_rule_id
              and r.company_id = journey_revenue_entries.company_id
          )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'journey_revenue_entries'
      and policyname = 'journey_revenue_entries_finance_update'
  ) then
    create policy journey_revenue_entries_finance_update
      on public.journey_revenue_entries
      for update
      to authenticated
      using (
        exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = journey_revenue_entries.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance'
                )
              )
            )
        )
      )
      with check (
        exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = journey_revenue_entries.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance'
                )
              )
            )
        )
        and exists (
          select 1
          from public.journeys j
          where j.id = journey_revenue_entries.journey_id
            and j.company_id = journey_revenue_entries.company_id
            and coalesce(j.is_demo, false) = false
        )
        and (
          journey_revenue_entries.rate_rule_id is null
          or exists (
            select 1
            from public.client_rate_rules r
            where r.id = journey_revenue_entries.rate_rule_id
              and r.company_id = journey_revenue_entries.company_id
          )
        )
      );
  end if;
end $$;

comment on table public.journey_revenue_entries is
  'Auditable revenue application records for Trips. Existing journey revenue columns remain compatibility snapshots.';

comment on column public.journey_revenue_entries.applied_by is
  'Application user UUID when available. Intentionally not constrained because auth user table shape differs by deployment.';
