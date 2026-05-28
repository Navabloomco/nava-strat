alter table public.evidence_attachments
  drop constraint if exists evidence_attachments_related_type_check;

alter table public.evidence_attachments
  add constraint evidence_attachments_related_type_check
    check (related_type in ('trip', 'expense', 'fuel_log', 'fuel_allocation'));

drop policy if exists evidence_attachments_company_insert
  on public.evidence_attachments;

create policy evidence_attachments_company_insert
  on public.evidence_attachments
  for insert
  to authenticated
  with check (
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
    and (
      (
        related_type = 'trip'
        and exists (
          select 1
          from public.journeys j
          where j.id = evidence_attachments.related_id
            and j.company_id = evidence_attachments.company_id
            and coalesce(j.is_demo, false) = false
        )
      )
      or (
        related_type = 'expense'
        and exists (
          select 1
          from public.expenses e
          left join public.journeys j
            on j.id = e.journey_id
          where e.id = evidence_attachments.related_id
            and (
              e.company_id = evidence_attachments.company_id
              or (
                j.company_id = evidence_attachments.company_id
                and coalesce(j.is_demo, false) = false
              )
            )
        )
      )
      or (
        related_type = 'fuel_log'
        and exists (
          select 1
          from public.fuel_logs fl
          where fl.id = evidence_attachments.related_id
            and fl.company_id = evidence_attachments.company_id
        )
      )
      or (
        related_type = 'fuel_allocation'
        and exists (
          select 1
          from public.fuel_allocations fa
          where fa.id = evidence_attachments.related_id
            and fa.company_id = evidence_attachments.company_id
        )
      )
    )
  );

comment on table public.evidence_attachments is
  'Company-scoped evidence/receipt metadata. Expense receipts attach to expenses; trip evidence attaches to trips. Fuel evidence hooks are reserved for fuel_log and fuel_allocation.';
