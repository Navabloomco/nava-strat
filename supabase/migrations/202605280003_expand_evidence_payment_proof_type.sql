alter table public.evidence_attachments
  drop constraint if exists evidence_attachments_evidence_type_check;

alter table public.evidence_attachments
  add constraint evidence_attachments_evidence_type_check
    check (
      evidence_type in (
        'receipt',
        'mpesa_screenshot',
        'delivery_note',
        'weighbridge',
        'invoice',
        'payment_proof',
        'other'
      )
    );

comment on column public.evidence_attachments.evidence_type is
  'Evidence type label. Expense proof can be receipt, mpesa_screenshot, invoice, payment_proof, or other; Trip-level evidence can include delivery_note, weighbridge, invoice, receipt, or other.';
