# Nava Strat Pilot Smoke Test Playbook

Use this checklist before a pilot, demo, or go-live. The goal is to validate the platform-owner, tenant, billing, operations, and Nava Eye flows with real role boundaries and tenant context.

When this playbook discovers a bug, batch fixes into one Codex prompt. Do not patch one tiny issue at a time unless it blocks testing.

## 1. Pre-Test Setup

- [ ] Confirm the repo is clean or that any local changes are intentional.
- [ ] Confirm the latest expected commit is deployed.
- [ ] Confirm `https://navastrat.co` is serving the Nava Strat product as the primary product domain.
- [ ] Confirm `NEXT_PUBLIC_SITE_URL=https://navastrat.co` is set in Vercel after Supabase Auth redirect URLs include the product domain.
- [ ] Confirm existing domains such as `https://www.navabloomco.com` and `https://nava-strat.vercel.app` still work during transition.
- [ ] Confirm platform-owner login works.
- [ ] Confirm the additive `billing_invoices` SQL has been applied.
- [ ] Confirm a test tenant/company exists.
- [ ] Confirm at least one tracking provider is configured for the test tenant.
- [ ] Confirm at least one imported or asset-reviewable asset exists.
- [ ] Confirm the test tenant has at least one owner/admin/platform-owner membership.

## 2. Platform Owner Admin Smoke Test

Open these pages as a `platform_owner`:

- [ ] `/admin`
- [ ] `/admin/health`
- [ ] `/admin/pilot-readiness`
- [ ] `/admin/pilot-readiness/[companyId]`
- [ ] `/admin/tenants`
- [ ] `/admin/tenants/[companyId]`
- [ ] `/admin/tenants/[companyId]/invoice-preview`

Expected result:

- [ ] Pages load without runtime errors.
- [ ] Non-platform tools remain hidden or blocked where appropriate.
- [ ] Platform-only pages do not expose provider secrets, raw payloads, auth configs, cookies, tokens, or private driver data.
- [ ] `/admin/health` shows readable results, including one grouped manual-verification message if Supabase metadata schemas cannot be inspected.

## 3. Tenant Context Smoke Test

From `/admin/pilot-readiness/[companyId]`, click:

- [ ] Asset Review.
- [ ] Provider Vault.
- [ ] Company Settings.
- [ ] Tenant Billing.
- [ ] Invoice Preview.

Expected result:

- [ ] Links land in the intended tenant context.
- [ ] `companyId` is preserved in URLs where supported.
- [ ] Tenant context banner appears where supported.
- [ ] Pages that do not support automatic tenant context say so clearly instead of pretending.
- [ ] Non-platform users cannot use `companyId` to cross tenants.

## 4. Provider Smoke Test

Open `/admin/providers?companyId=<id>`.

- [ ] Confirm provider list loads.
- [ ] Confirm provider detail/test actions work or fail safely.
- [ ] Confirm Test Connection displays sanitized diagnostics.
- [ ] Confirm capability diagnostics separate provider default capability from observed row capability.
- [ ] Confirm observed BlueTrax/JLCL rows show `GPS Intelligence` unless ignition/CAN/tank signals have been explicitly verified.
- [ ] Confirm supported engine/tank signals show `none declared` for GPS-only providers.
- [ ] Confirm placeholder zero signals are shown as safe counts only and do not upgrade capability.
- [ ] Confirm distance diagnostics, if provider report rows exist, separate provider-reported mileage from physical odometer values.
- [ ] Upload a provider distance report CSV in dry-run mode and confirm parsed rows, matched assets, unmatched rows, static-zero count, mismatch count, and rows-would-write are shown before import.
- [ ] Import only after dry-run preview, then confirm matched rows are written to provider trip summaries and not to point telemetry logs.
- [ ] Confirm static zero odometer values with non-zero mileage are treated as odometer-health issues, not as zero movement.
- [ ] Confirm no secrets, tokens, cookies, Authorization values, raw provider payloads, or auth configs are visible.
- [ ] Confirm enrichment diagnostics show safe counts/key names only.
- [ ] Confirm BlueTrax current fuel limitation is treated as a provider-pending integration item, not a product failure.
- [ ] Confirm the Meitrack CAN Bus template, if visible, is setup-only/example mapping and does not ask for live credentials until a verified connection path exists.

Expected BlueTrax note:

- Primary BlueTrax location sync can work while Fleet Current Status fuel remains pending until the web analytics auth/report feed is correctly authorized or BlueTrax provides official report API access.

## 5. Asset Review Smoke Test

Open `/admin/assets?companyId=<id>`.

- [ ] Confirm imported assets count is visible.
- [ ] Confirm unreviewed assets are visually obvious.
- [ ] Enable one test asset if safe.
- [ ] Confirm enabled asset gets an asset category, `billing_status = enabled`, `intelligence_enabled = true`, and `billing_enabled_at` present.
- [ ] Confirm strict billable count includes only assets where all are true:
  - `status = active`
  - `billing_status = enabled`
  - `intelligence_enabled = true`
  - `billing_enabled_at is not null`
- [ ] Disable or review-later the test asset if needed.
- [ ] Confirm strict billable count drops after disabling/review-later.
- [ ] Confirm unreviewed assets do not appear in Live Tracking.

## 6. Billing Smoke Test

Open `/admin/tenants/[companyId]` and `/admin/tenants/[companyId]/invoice-preview`.

- [ ] Confirm tenant billing summary loads.
- [ ] Confirm invoice preview uses strict billable asset count.
- [ ] Confirm included assets, extra billable assets, currency, unit price, and estimated total are correct.
- [ ] Confirm pricing missing or zero shows a readiness warning.
- [ ] Create a draft invoice.
- [ ] Confirm duplicate invoice prevention for the same company and period.
- [ ] Mark draft invoice as sent.
- [ ] Mark sent invoice as paid.
- [ ] Void a draft or sent invoice when appropriate.
- [ ] Confirm status transitions follow only:
  - `draft -> sent`
  - `sent -> paid`
  - `draft -> void`
  - `sent -> void`
- [ ] Confirm non-platform users cannot access invoice APIs.

Expected result:

- [ ] Invoice creation recalculates totals server-side.
- [ ] No Stripe charge, PDF, email, customer-facing invoice, or payment collection is created.
- [ ] Missing `billing_invoices` SQL shows setup guidance instead of a generic crash.

## 7. Operations Smoke Test

Open these routes with appropriate company roles:

- [ ] `/ops/dashboard`
- [ ] `/ops/journey`
- [ ] `/ops/journey/new`
- [ ] `/fuel`
- [ ] `/fuel/new`
- [ ] `/expenses`
- [ ] `/expenses/new`
- [ ] `/tracking/live`

Confirm role gates:

- [ ] `ops` can create journeys where allowed.
- [ ] `ops` can create fuel where allowed.
- [ ] `ops` cannot view revenue or expense ledger if not permitted by current role rules.
- [ ] `finance` can view/edit finance workflows where allowed.
- [ ] `management` is view-only where applicable.
- [ ] `owner`, `admin`, and `platform_owner` retain elevated access.

Confirm workflow behavior:

- [ ] Create Journey keeps saved route picker behavior.
- [ ] Create Journey keeps enabled vehicle picker behavior.
- [ ] Vehicle picker can fill the truck field.
- [ ] Current standing driver assignment can fill or suggest the driver field.
- [ ] Fuel entry uses JourneyPicker and submits without changing journey payload names.
- [ ] Expense entry uses JourneyPicker and submits without changing payload names.
- [ ] Live Tracking only shows enabled intelligence assets.
- [ ] Geofence labels render when matched.

## 8. Nava Eye Smoke Test

Open `/nava-eye` and ask:

- [ ] Create a new Nava Eye conversation.
- [ ] "Which trucks are live?"
- [ ] "Which assets have stale location?"
- [ ] "Is KDQ265 siphoning fuel?"
- [ ] "Why is KDQ265 always stopping?"
- [ ] Ask "Where is KCW 103Z?", then reply "yes" and confirm the follow-up stays on KCW 103Z.
- [ ] Close the conversation and confirm the thread becomes read-only.

Expected result:

- [ ] Nava Eye conversation setup either works or shows clear setup-required SQL guidance.
- [ ] Nava Eye uses fuzzy vehicle matching where appropriate.
- [ ] Nava Eye does not expose disabled or unreviewed vehicle telemetry.
- [ ] Nava Eye does not expose private driver phone, license, notes, or employee code.
- [ ] Nava Eye avoids accusations and gives evidence-based answers.
- [ ] Fuel suspicion answers distinguish usable fuel telemetry from unavailable or all-zero readings.
- [ ] GPS-only assets answer with movement/location evidence but do not confirm engine-on idling, exact fuel burn, tank-volume change, or theft.
- [ ] CAN Bus or tank-sensor wording appears only when the asset/provider capability is actually verified.
- [ ] If BlueTrax current fuel is not yet ingesting, Nava Eye explains the provider data limitation carefully.
- [ ] Investigation answers include practical next checks instead of stopping at "no data."
- [ ] Current role permissions still apply on every message inside a conversation.

## 9. Client Visibility Smoke Test

Open `/admin/client-visibility`.

- [ ] Generate or inspect a client visibility token link if the workflow already exists for the tenant.
- [ ] Confirm links generated from `https://navastrat.co` use the product domain.
- [ ] Open the public client portal link.
- [ ] Confirm the portal is token-scoped.
- [ ] Confirm it does not expose internal dashboards, provider diagnostics, provider raw payloads, auth config, private driver data, or unreviewed assets.
- [ ] Confirm `record_client_visibility_link_access` behavior is either working or documented by Platform Health/manual verification.

## 10. Failure-State Checks

- [ ] Missing `billing_invoices` table shows setup-required guidance.
- [ ] Provider test failure shows readable diagnostics.
- [ ] Provider test diagnostics do not show secrets or raw payloads.
- [ ] Platform Health groups metadata inspection warnings into one manual-verification message.
- [ ] Unauthorized users get 401/403 responses.
- [ ] Cross-tenant `companyId` attempts by non-platform users do not leak data.
- [ ] Expired or invalid client visibility tokens do not leak data.
- [ ] API errors show clear UI messages instead of infinite loading states.

## 11. Demo Readiness Pass/Fail

Mark the pilot/demo ready only when all critical checks pass:

- [ ] Platform health acceptable.
- [ ] Tenant readiness is not blocked.
- [ ] Provider connected or provider limitation documented.
- [ ] Imported assets reviewed and at least one safe asset enabled.
- [ ] Billing preview works.
- [ ] Invoice record flow works.
- [ ] Ops flow works.
- [ ] Nava Eye answers safely.
- [ ] Client visibility remains privacy-limited.
- [ ] No obvious role leaks.

If any critical item fails, record:

- Route or API.
- Role used.
- Tenant/company context.
- Expected behavior.
- Actual behavior.
- Screenshot or sanitized error message.
- Whether the issue blocks demo/go-live or can be documented as a known limitation.
