alter table public.evidence_attachments
  add column if not exists evidence_hash text;

create unique index if not exists evidence_attachments_unique_related_hash
  on public.evidence_attachments (
    company_id,
    related_type,
    related_id,
    evidence_hash
  )
  where evidence_hash is not null;

comment on column public.evidence_attachments.evidence_hash is
  'Server-computed SHA-256 proof hash used to prevent duplicate evidence on the same company-scoped related record.';
