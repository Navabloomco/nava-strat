create extension if not exists pgcrypto;

create table if not exists public.evidence_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  related_type text not null,
  related_id uuid not null,
  evidence_type text not null,
  storage_bucket text null,
  storage_path text null,
  original_filename text null,
  mime_type text null,
  file_size_bytes bigint null,
  text_content text null,
  notes text null,
  verification_status text not null default 'uploaded',
  uploaded_by uuid null,
  uploaded_at timestamptz not null default now(),
  constraint evidence_attachments_related_type_check
    check (related_type in ('trip')),
  constraint evidence_attachments_evidence_type_check
    check (
      evidence_type in (
        'receipt',
        'mpesa_screenshot',
        'delivery_note',
        'weighbridge',
        'invoice',
        'other'
      )
    ),
  constraint evidence_attachments_verification_status_check
    check (verification_status in ('uploaded', 'reviewed', 'rejected')),
  constraint evidence_attachments_file_size_nonnegative
    check (file_size_bytes is null or file_size_bytes >= 0)
);

create index if not exists evidence_attachments_company_id_idx
  on public.evidence_attachments(company_id);

create index if not exists evidence_attachments_related_idx
  on public.evidence_attachments(related_type, related_id);

create index if not exists evidence_attachments_uploaded_at_idx
  on public.evidence_attachments(uploaded_at desc);

create index if not exists evidence_attachments_verification_status_idx
  on public.evidence_attachments(verification_status);

alter table public.evidence_attachments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'evidence_attachments'
      and policyname = 'evidence_attachments_company_select'
  ) then
    create policy evidence_attachments_company_select
      on public.evidence_attachments
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.company_id = evidence_attachments.company_id
            and cu.is_active = true
            and lower(trim(coalesce(cu.role, ''))) in (
              'platform_owner',
              'owner',
              'admin',
              'ops',
              'finance',
              'management'
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
      and tablename = 'evidence_attachments'
      and policyname = 'evidence_attachments_company_insert'
  ) then
    create policy evidence_attachments_company_insert
      on public.evidence_attachments
      for insert
      to authenticated
      with check (
        related_type = 'trip'
        and exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.company_id = evidence_attachments.company_id
            and cu.is_active = true
            and lower(trim(coalesce(cu.role, ''))) in (
              'platform_owner',
              'owner',
              'admin',
              'ops',
              'finance',
              'management'
            )
        )
        and exists (
          select 1
          from public.journeys j
          where j.id = evidence_attachments.related_id
            and j.company_id = evidence_attachments.company_id
            and coalesce(j.is_demo, false) = false
        )
      );
  end if;
end $$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'trip-evidence',
  'trip-evidence',
  false,
  4194304,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'trip_evidence_objects_company_select'
  ) then
    create policy trip_evidence_objects_company_select
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'trip-evidence'
        and exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and cu.company_id::text = (storage.foldername(name))[1]
            and lower(trim(coalesce(cu.role, ''))) in (
              'platform_owner',
              'owner',
              'admin',
              'ops',
              'finance',
              'management'
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'trip_evidence_objects_company_insert'
  ) then
    create policy trip_evidence_objects_company_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'trip-evidence'
        and exists (
          select 1
          from public.company_users cu
          where cu.user_id = auth.uid()
            and cu.is_active = true
            and cu.company_id::text = (storage.foldername(name))[1]
            and lower(trim(coalesce(cu.role, ''))) in (
              'platform_owner',
              'owner',
              'admin',
              'ops',
              'finance',
              'management'
            )
        )
      );
  end if;
end $$;

comment on table public.evidence_attachments is
  'Company-scoped evidence/receipt metadata for Trips. Files live in private Supabase Storage; M-Pesa parsing is deferred.';

comment on column public.evidence_attachments.uploaded_by is
  'Application user UUID when available. Intentionally not constrained because auth user table shape differs by deployment.';
