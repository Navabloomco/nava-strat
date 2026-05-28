create extension if not exists pgcrypto;

create table if not exists public.client_rate_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_name text not null,
  route_from text null,
  route_to text null,
  unit_type text not null,
  billing_quantity_source text not null,
  rate_amount numeric not null,
  currency text not null default 'KES',
  fx_policy text not null default 'manual',
  fx_rate_to_kes numeric null,
  effective_from date not null,
  effective_to date null,
  status text not null default 'active',
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_rate_rules_client_name_required
    check (length(trim(client_name)) > 0),
  constraint client_rate_rules_unit_type_check
    check (unit_type in ('tonne', 'truck', 'bag', 'container', 'trip', 'custom')),
  constraint client_rate_rules_billing_quantity_source_check
    check (
      billing_quantity_source in (
        'loaded_quantity',
        'offloaded_quantity',
        'billing_quantity',
        'manual_quantity'
      )
    ),
  constraint client_rate_rules_rate_amount_positive
    check (rate_amount > 0),
  constraint client_rate_rules_currency_required
    check (length(trim(currency)) > 0),
  constraint client_rate_rules_fx_policy_check
    check (fx_policy in ('manual', 'company_standard', 'fixed_rate')),
  constraint client_rate_rules_fx_rate_positive
    check (fx_rate_to_kes is null or fx_rate_to_kes > 0),
  constraint client_rate_rules_effective_window_check
    check (effective_to is null or effective_to >= effective_from),
  constraint client_rate_rules_status_check
    check (status in ('active', 'inactive'))
);

create index if not exists client_rate_rules_company_id_idx
  on public.client_rate_rules(company_id);

create index if not exists client_rate_rules_client_name_idx
  on public.client_rate_rules(company_id, client_name);

create index if not exists client_rate_rules_route_idx
  on public.client_rate_rules(company_id, route_from, route_to);

create index if not exists client_rate_rules_status_idx
  on public.client_rate_rules(company_id, status);

create index if not exists client_rate_rules_effective_window_idx
  on public.client_rate_rules(company_id, effective_from, effective_to);

alter table public.client_rate_rules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_rate_rules'
      and policyname = 'client_rate_rules_finance_select'
  ) then
    create policy client_rate_rules_finance_select
      on public.client_rate_rules
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
                cu.company_id = client_rate_rules.company_id
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
      and tablename = 'client_rate_rules'
      and policyname = 'client_rate_rules_finance_insert'
  ) then
    create policy client_rate_rules_finance_insert
      on public.client_rate_rules
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
                cu.company_id = client_rate_rules.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance'
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
      and tablename = 'client_rate_rules'
      and policyname = 'client_rate_rules_finance_update'
  ) then
    create policy client_rate_rules_finance_update
      on public.client_rate_rules
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
                cu.company_id = client_rate_rules.company_id
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
                cu.company_id = client_rate_rules.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'finance'
                )
              )
            )
        )
      );
  end if;
end $$;

comment on table public.client_rate_rules is
  'Finance-owned client/route revenue rules. Ops records quantities and proof; rates and FX remain finance controlled.';

comment on column public.client_rate_rules.created_by is
  'Application user UUID when available. Intentionally not constrained because auth user table shape differs by deployment.';
