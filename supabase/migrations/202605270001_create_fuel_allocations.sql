create extension if not exists pgcrypto;

create table if not exists public.fuel_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fuel_log_id uuid not null references public.fuel_logs(id) on delete cascade,
  journey_id uuid null references public.journeys(id) on delete set null,
  asset_id uuid null references public.fleet_assets(id) on delete set null,
  truck_text text null,
  allocated_liters numeric not null default 0,
  allocated_cost numeric not null default 0,
  allocation_status text not null default 'allocated',
  allocation_basis text not null default 'manual',
  notes text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint fuel_allocations_allocated_liters_nonnegative
    check (allocated_liters >= 0),
  constraint fuel_allocations_allocated_cost_nonnegative
    check (allocated_cost >= 0),
  constraint fuel_allocations_status_check
    check (allocation_status in ('allocated', 'carried_forward', 'reversed')),
  constraint fuel_allocations_basis_check
    check (
      allocation_basis in (
        'manual',
        'expected_trip_standard',
        'finance_review',
        'legacy_journey_link'
      )
    )
);

create index if not exists fuel_allocations_company_id_idx
  on public.fuel_allocations(company_id);

create index if not exists fuel_allocations_fuel_log_id_idx
  on public.fuel_allocations(fuel_log_id);

create index if not exists fuel_allocations_journey_id_idx
  on public.fuel_allocations(journey_id);

create index if not exists fuel_allocations_asset_id_idx
  on public.fuel_allocations(asset_id);

create index if not exists fuel_allocations_allocation_status_idx
  on public.fuel_allocations(allocation_status);

comment on table public.fuel_allocations is
  'Allocation ledger that assigns issued fuel from fuel_logs to trips or carry-forward balances. Actual fuel burn is not implied.';

comment on column public.fuel_allocations.created_by is
  'Application user UUID when available. Intentionally not constrained because auth user table shape differs by deployment.';
