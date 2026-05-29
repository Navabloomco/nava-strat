create extension if not exists pgcrypto;

create table if not exists public.asset_availability_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  asset_id uuid null references public.fleet_assets(id) on delete set null,
  truck_id text null,
  journey_id uuid null references public.journeys(id) on delete set null,
  status text not null,
  source text not null default 'manual',
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  note text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_availability_events_status_check
    check (
      status in (
        'available',
        'on_trip',
        'grounded',
        'under_repair',
        'breakdown_reported',
        'out_of_service',
        'at_client_site',
        'loading',
        'offloading',
        'waiting',
        'unknown_stopped_time'
      )
    ),
  constraint asset_availability_events_source_check
    check (source in ('manual', 'provider', 'inferred')),
  constraint asset_availability_events_target_check
    check (asset_id is not null or nullif(trim(coalesce(truck_id, '')), '') is not null),
  constraint asset_availability_events_window_check
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists asset_availability_events_company_active_idx
  on public.asset_availability_events(company_id, ended_at, started_at desc);

create index if not exists asset_availability_events_asset_active_idx
  on public.asset_availability_events(company_id, asset_id, ended_at, started_at desc);

create index if not exists asset_availability_events_truck_active_idx
  on public.asset_availability_events(company_id, truck_id, ended_at, started_at desc);

create index if not exists asset_availability_events_journey_idx
  on public.asset_availability_events(company_id, journey_id);

alter table public.asset_availability_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_availability_events'
      and policyname = 'asset_availability_events_company_select'
  ) then
    create policy asset_availability_events_company_select
      on public.asset_availability_events
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
                cu.company_id = asset_availability_events.company_id
                and lower(trim(coalesce(cu.role, ''))) in (
                  'owner',
                  'admin',
                  'ops',
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
      and tablename = 'asset_availability_events'
      and policyname = 'asset_availability_events_ops_insert'
  ) then
    create policy asset_availability_events_ops_insert
      on public.asset_availability_events
      for insert
      to authenticated
      with check (
        source = 'manual'
        and exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = asset_availability_events.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin', 'ops')
              )
            )
        )
        and (
          asset_availability_events.asset_id is null
          or exists (
            select 1
            from public.fleet_assets fa
            where fa.id = asset_availability_events.asset_id
              and fa.company_id = asset_availability_events.company_id
          )
        )
        and (
          asset_availability_events.journey_id is null
          or exists (
            select 1
            from public.journeys j
            where j.id = asset_availability_events.journey_id
              and j.company_id = asset_availability_events.company_id
              and coalesce(j.is_demo, false) = false
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
      and tablename = 'asset_availability_events'
      and policyname = 'asset_availability_events_ops_update'
  ) then
    create policy asset_availability_events_ops_update
      on public.asset_availability_events
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
                cu.company_id = asset_availability_events.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin', 'ops')
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
                cu.company_id = asset_availability_events.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin', 'ops')
              )
            )
        )
      );
  end if;
end $$;

comment on table public.asset_availability_events is
  'Lightweight operational availability context for fleet assets. This is not a maintenance module or incident workflow.';

comment on column public.asset_availability_events.status is
  'Current operational availability label used to interpret stopped/low-productivity evidence. Marking available ends the active status in the application API.';
