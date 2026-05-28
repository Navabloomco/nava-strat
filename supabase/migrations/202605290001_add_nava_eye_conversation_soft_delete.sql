alter table if exists public.nava_eye_conversations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists nava_eye_conversations_visible_idx
  on public.nava_eye_conversations (company_id, created_by, status, updated_at desc)
  where deleted_at is null;
