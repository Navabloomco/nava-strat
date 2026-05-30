create extension if not exists pgcrypto;

create table if not exists public.company_user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null,
  status text not null default 'pending',
  invited_by uuid null,
  invited_at timestamptz not null default now(),
  accepted_by uuid null,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null,
  supabase_user_id uuid null,
  invite_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_user_invitations_role_check
    check (role in ('owner', 'admin', 'ops', 'finance', 'management')),
  constraint company_user_invitations_status_check
    check (status in ('pending', 'accepted', 'revoked', 'failed')),
  constraint company_user_invitations_email_check
    check (position('@' in email) > 1)
);

create index if not exists company_user_invitations_company_status_idx
  on public.company_user_invitations(company_id, status, invited_at desc);

create index if not exists company_user_invitations_email_idx
  on public.company_user_invitations(lower(email));

create unique index if not exists company_user_invitations_one_pending_idx
  on public.company_user_invitations(company_id, lower(email))
  where status = 'pending' and revoked_at is null and accepted_at is null;

create or replace function public.set_company_user_invitations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_company_user_invitations_updated_at
  on public.company_user_invitations;

create trigger set_company_user_invitations_updated_at
  before update on public.company_user_invitations
  for each row
  execute function public.set_company_user_invitations_updated_at();

alter table public.company_user_invitations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_user_invitations'
      and policyname = 'company_user_invitations_admin_select'
  ) then
    create policy company_user_invitations_admin_select
      on public.company_user_invitations
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
                cu.company_id = company_user_invitations.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin')
              )
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_user_invitations'
      and policyname = 'company_user_invitations_admin_insert'
  ) then
    create policy company_user_invitations_admin_insert
      on public.company_user_invitations
      for insert
      to authenticated
      with check (
        role in ('owner', 'admin', 'ops', 'finance', 'management')
        and exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and (
              lower(trim(coalesce(cu.role, ''))) = 'platform_owner'
              or (
                cu.company_id = company_user_invitations.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin')
              )
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'company_user_invitations'
      and policyname = 'company_user_invitations_admin_update'
  ) then
    create policy company_user_invitations_admin_update
      on public.company_user_invitations
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
                cu.company_id = company_user_invitations.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin')
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
                cu.company_id = company_user_invitations.company_id
                and lower(trim(coalesce(cu.role, ''))) in ('owner', 'admin')
              )
            )
        )
      );
  end if;
end $$;

comment on table public.company_user_invitations is
  'Company-scoped Team Access email invitations. Auth invites are sent server-side; active company access is created after the invited email authenticates. invite_error stores safe categories only.';
