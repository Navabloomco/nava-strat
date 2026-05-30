# Nava Strat Pilot Smoke Test Playbook

Use this checklist before a pilot, demo, or go-live. The goal is to validate the platform-owner, tenant, billing, operations, and Nava Eye flows with real role boundaries and tenant context.

When this playbook discovers a bug, batch fixes into one Codex prompt. Do not patch one tiny issue at a time unless it blocks testing.

## Product Voice Guardrails

This playbook may use pilot/testing language because it is an internal validation document. The product UI should sound productized and enterprise-ready.

- [ ] Customer-facing pages use `Trips`, `Ops Intelligence`, `Revenue Review`, `Client rates`, `Contribution review`, and `review-ready contribution` instead of old pilot/dashboard/profitability language.
- [ ] Customer-facing pages do not show `pilot view`, `pilot readiness`, `canonical`, `legacy`, `event_type`, `provider_signal_flags`, raw payload wording, or row-path/debug terminology unless it is inside a clearly advanced/platform diagnostic surface.
- [ ] Evidence caveats remain visible but concise: GPS-derived distance estimate, provider distance evidence, stopped-time evidence, tracker idle markers, and engine-on idle not verified.
- [ ] Nava Eye answers are concise by default and only show audit details after questions such as `how`, `why`, `show evidence`, or `why should I trust it`.
- [ ] Reusable UI placeholders do not contain tenant-specific examples, real truck plates, real client names, real trip IDs, or pilot contribution amounts.
- [ ] Public, pricing, login, and onboarding pages use controlled-rollout language such as `Request implementation review`, `Start setup`, `Open workspace`, and `Talk to Nava Bloom` instead of customer-facing `pilot trial` / `Start trial` copy.
- [ ] Public/client-facing tracking pages do not show raw coordinates as the primary location when a readable place label is unavailable.

## 1. Pre-Test Setup

- [ ] Confirm the repo is clean or that any local changes are intentional.
- [ ] Confirm the latest expected commit is deployed.
- [ ] Confirm `https://navastrat.co` is serving the Nava Strat product as the primary product domain.
- [ ] Confirm `NEXT_PUBLIC_SITE_URL=https://navastrat.co` is set in Vercel after Supabase Auth redirect URLs include the product domain.
- [ ] Confirm existing domains such as `https://www.navabloomco.com` and `https://nava-strat.vercel.app` still work during transition.
- [ ] Confirm platform-owner login works.
- [ ] Confirm the additive `billing_invoices` SQL has been applied.
- [ ] Confirm the `client_rate_rules` and `journey_revenue_entries` migrations have been applied before testing Client Rates / Revenue Rules.
- [ ] Confirm the `company_user_invitations` migration has been applied before testing Team Access email invitations.
- [ ] Confirm a test tenant/company exists.
- [ ] Confirm at least one tracking provider is configured for the test tenant.
- [ ] Confirm at least one current provider asset or asset-reviewable record exists.
- [ ] Confirm the test tenant has at least one owner/admin/platform-owner membership.

## 2. Platform Owner Admin Smoke Test

Open these pages as a `platform_owner`:

- [ ] `/admin`
- [ ] `/admin/team-access?companyId=<companyId>`
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

## Team Access Controlled-Pilot Smoke Test

Open `/admin/team-access` as a company `owner` or `admin`, and as `platform_owner` with an explicit `companyId`.

- [ ] Confirm current company users load with email/name where available, role, active/inactive state, and account date metadata.
- [ ] As a tenant admin, confirm platform-owner/internal support users are absent from the visible table and excluded from total/active counts.
- [ ] Confirm only `owner`, `admin`, `ops`, `finance`, and `management` are offered as editable pilot roles.
- [ ] Invite a new email as `ops` and confirm a real pending invitation appears.
- [ ] Confirm invite email delivery is sent through the server-side auth invite path and no service-role key or provider internals appear in the browser.
- [ ] Accept the invite, sign in, and confirm the user appears in Team Access as an active `ops` user.
- [ ] Confirm the invited `ops` user can access operational routes but cannot see restricted finance amounts.
- [ ] Invite or add an existing authenticated user as `finance` and confirm the user appears in the same-company list.
- [ ] Revoke a pending invite and confirm accepting/signing in through that revoked invite does not create company access.
- [ ] Resend a pending/failed invite and confirm the status remains visible without raw Supabase errors.
- [ ] Change a user to `ops`, then confirm that user sees operational routes and does not see restricted finance amounts.
- [ ] Change a user to `finance`, then confirm Revenue Review and Client Rates are visible and operational Trip creation is not presented as a finance-owned action.
- [ ] Change a user to `management`, then confirm the Management dashboard is visible according to role policy.
- [ ] Deactivate a user and confirm the membership disappears from active company context and cannot access the workspace.
- [ ] Reactivate the user and confirm access returns for the selected role.
- [ ] Confirm the API blocks demoting/deactivating the last active owner/admin for the company.
- [ ] Confirm tenant admins cannot invite or grant `platform_owner`.
- [ ] Confirm tenant admins cannot edit internal access rows by guessed user id or email; the API rejects the request without exposing internal role mechanics.
- [ ] Confirm `platform_owner` sees a clear company context before editing access, can retain internal visibility, and cannot accidentally edit another company through a tenant user's role.

## 4. Dashboard Command Brief Smoke Test

Open `/dashboard` as an admin/finance user for a customer tenant.

- [ ] Confirm the page title and first section read as a Command Brief / operating brief, not a raw widget dashboard.
- [ ] Confirm `Needs attention today` appears above the compact fleet-state tiles.
- [ ] Confirm action cards route to the right specialist page and include safe `Ask Nava Eye` shortcuts where available.
- [ ] Confirm the top Nava Eye block says `Ask Nava Eye about this brief` and shows two or three tenant-safe prompt chips.
- [ ] Click a dashboard Nava Eye prompt and confirm the answer appears directly under the top prompt area, not far down in Nava Eye Watch.
- [ ] Click `Ask Nava Eye` from a lower dashboard action/watch item and confirm the page scrolls/focuses the top answer panel.
- [ ] Confirm dashboard Nava Eye answers ask about the current brief without hardcoded tenant examples or restricted finance leakage.
- [ ] Confirm the compact fleet-state strip appears below the action cards.
- [ ] Confirm review queues are role-aware and do not expose restricted finance amounts to roles without finance/management access.
- [ ] Confirm quick links are secondary under `Command routes`, visible before grouped event review but not dominant at the top.
- [ ] Confirm Nava Eye Watch is prominent and actionable.
- [ ] Confirm grouped event review uses tracker event record / triage wording and avoids raw event spam as the primary experience.
- [ ] Confirm links route to Live Tracking, Trips, Ops Intelligence, Revenue Review, Provider Vault, and Nava Eye according to role permissions.
- [ ] As an ops/clerk-style role, confirm finance/revenue/contribution queues are restricted or absent while operational routes remain usable.

## 5. Provider Smoke Test

Open `/admin/providers?companyId=<id>`.

- [ ] Confirm provider list loads.
- [ ] Open `/admin/providers/new?companyId=<id>` as owner/admin/platform-owner.
- [ ] As a customer owner/admin, confirm the guided Add Provider flow shows only public/supported providers, Custom API provider, and Request assisted setup.
- [ ] Select Custom API provider and confirm the default Simple Connect form shows only Provider name, Provider website/API link, Email/username, Password, optional API key/token, and Connect provider.
- [ ] Confirm auth method, token path, row path, endpoint URL candidates, token placement, field mapping, signal capability, and JSON config are hidden under collapsed Advanced troubleshooting.
- [ ] Enter a provider base URL and credentials, then click Connect provider. Confirm Nava automatically tries safe common setup patterns without requiring raw JSON.
- [ ] Enter an endpoint-specific value such as `https://fleettrack.africa/api/login` in API base URL and confirm the wizard normalizes the base to `https://fleettrack.africa/api` while filling the login endpoint separately.
- [ ] When provider notes mention `user_api_hash` or `get_devices`, confirm "Use detected login-token setup" fills POST login token, token path, fleet endpoint, and row path defaults.
- [ ] Use Auto-test setup with a safe FleetTrack-style provider and confirm it detects login token path, fleet endpoint, row path, field mappings, and vehicle count when available.
- [ ] Click Connect provider and confirm the progress runner uses plain labels: Checking secure connection, Signing in, Confirming access, Finding vehicles, Matching trucks, Checking location fields, Checking signal quality, Creating inactive provider, and Ready for review.
- [ ] If sign-in fails, confirm only Signing in fails and dependent steps such as Confirming access, Finding vehicles, Matching trucks, Checking location fields, Creating inactive provider, and Ready for review are skipped.
- [ ] If sign-in succeeds but no vehicles are found, confirm Finding vehicles fails and later matching/mapping/create steps are skipped.
- [ ] If vehicles are found but location fields are missing, confirm Checking location fields fails and provider creation is skipped.
- [ ] Confirm the success screen shows Vehicles found, Matched existing trucks, New/unmatched vehicles, Tracking verified, Engine/fuel signals verified, Provider created inactive, and Review in Provider Vault.
- [ ] Confirm the failure screen shows one plain-language problem plus Try advanced troubleshooting and Request assisted setup.
- [ ] Confirm row path accepts one JSON path only, such as `data`, and rejects URLs or multiple paths like `items data devices`.
- [ ] Use Test Endpoint & Detect on a safe provider login endpoint and confirm token path suggestions appear without raw secrets or full payloads.
- [ ] Use Test Endpoint & Detect on a safe fleet/current-location endpoint and confirm row path and field mapping suggestions can be applied.
- [ ] Confirm Test Endpoint & Detect rejects localhost/private/internal/metadata URLs.
- [ ] Confirm Custom API provider creation stores the connection inactive and does not run sync automatically.
- [ ] As a customer owner/admin, confirm internal templates such as Meitrack examples, Generic REST GPS, and Generic CSV Distance Report are hidden.
- [ ] As a platform owner, confirm internal templates are visible only under internal/platform setup labeling.
- [ ] Confirm customer-facing setup copy uses business language such as location tracking, engine data not verified, and fuel/tank sensor not verified instead of raw capability tier names.
- [ ] Confirm the guided Add Provider flow shows provider selection, credential fields, safe verification summary, and setup notes without raw JSON by default.
- [ ] Confirm new provider connections are created inactive and redirect back to Provider Vault for testing.
- [ ] Confirm Activate Sync is disabled until Test Connection succeeds.
- [ ] Confirm platform-owner advanced settings remain available but collapsed by default.
- [ ] Confirm ops/finance/management cannot create provider connections.
- [ ] Confirm provider detail/test actions work or fail safely.
- [ ] Confirm Test Connection displays sanitized diagnostics.
- [ ] Confirm Provider Vault shows Current vehicle feed and Report/distance feed as separate connection channels.
- [ ] Confirm Provider Vault cards lead with a clean customer-ready summary: connection status badge, last test badge, vehicles found, matched/unmatched trucks, live location tracking, engine/fuel signal verification, report/distance feed status, and next action.
- [ ] Click Provider Vault `Ask setup priorities` and confirm Nava Eye opens a company-scoped provider setup question without raw payloads or secrets.
- [ ] On a provider card, click `Ask what this provider exposes` and confirm Nava Eye answers from sanitized capability/setup summaries only.
- [ ] Confirm provider summary metrics use latest successful test/sync counts when available, such as 36 FleetTrack vehicles or 21 BlueTrax vehicles, and otherwise show plain placeholders such as `Not refreshed yet` / `Review needed`.
- [ ] Confirm matched existing trucks never exceeds vehicles found; if legacy or uncertain counts are impossible, the card shows `Review needed`.
- [ ] For an inactive second provider with successful test results, confirm Provider Vault shows a Vehicle match review with provider vehicle label, matched canonical truck, match source/confidence, and status.
- [ ] Confirm Vehicle match review uses compact match labels such as `Existing asset · High confidence` and active providers use sync-maintenance copy rather than activation copy.
- [ ] Confirm activation stays blocked until the admin checks `I reviewed these vehicle matches`, even when all rows are matched.
- [ ] Confirm activating after review shows a final confirmation describing how many provider vehicles will map to existing assets.
- [ ] Confirm GPS-only providers keep Engine/fuel signals as `not verified` unless supported ignition, engine/CAN, or tank signals have meaningful non-placeholder values.
- [ ] Confirm Report/distance feed is `not configured` for placeholder report URLs until endpoint, row path, distance mapping, and required report parameters are configured well enough to write provider trip summaries.
- [ ] Confirm the card does not repeat status copy such as `Inactive until activated` or `Connection test passed` inside both badges and the summary sentence.
- [ ] Confirm username/password/token fields are hidden under collapsed Manage credentials and saved secrets are not echoed.
- [ ] Confirm Provider Vault technical panels such as connection contract, row path, response shape, data discovery, enrichment diagnostics, and CSV fallback/backfill import are collapsed under Advanced diagnostics by default.
- [ ] Confirm a Simple Connect provider created from a login-token flow can be replayed by Provider Vault Test Connection without re-entering endpoint/token details.
- [ ] Confirm Test Connection shows plain-language failure states such as Sign-in failed, Access token not found, Vehicle endpoint rejected access, No vehicle rows found, Required location fields missing, Report endpoint not configured, or Report endpoint rejected parameters.
- [ ] Confirm no raw browser alert displays messages such as `Fleet API returned HTTP 401`; failures appear as sanitized inline Provider Vault status.
- [ ] Run Provider Vault Data Discovery Diagnostics with no extra endpoint and confirm it tests configured endpoints only, shows sanitized response shape/key/path information, and writes nothing.
- [ ] Confirm Data Discovery Diagnostics allows one explicitly entered report/trip candidate endpoint at a time or a short explicit list, with masked query values and no raw payload display.
- [ ] If Data Discovery finds a better current-vehicle array path, such as saved `$` with 1 row and suggested `$.items` with 36 rows, confirm Provider Vault shows "Apply suggested vehicle path."
- [ ] Confirm the suggested path is normalized as `$.items`, not `$.$.items` or `$$.items`.
- [ ] Click "Apply suggested vehicle path" and confirm the saved current feed row path and safe field mappings update, provider sync remains inactive/retest-required, and no credentials or raw payloads are exposed.
- [ ] Run Test Connection again and confirm it uses the applied row path and reports the larger vehicle count.
- [ ] Confirm saved JSONPath row paths such as `$.items` work for root-array wrapper responses such as `[{ "items": [...] }]`.
- [ ] Confirm field mappings are saved relative to the selected row path: with row path `$.items`, mappings are `truck: name`, `latitude: lat`, `longitude: lng`, not `items.name`, `items.lat`, or `items.lng`.
- [ ] Confirm vague/high-stakes fields such as `inaccuracy` and `fuel_measurement_id` are not mapped as ignition, engine, fuel, or tank signals unless explicitly verified by provider-supported signals.
- [ ] Confirm generic Provider Vault helper copy says "provider report/trip URLs" and does not mention a specific provider unless inside that provider's card/template or platform-owner setup context.
- [ ] Confirm sanitized endpoint display preserves safe query values such as `lang=en` while redacting `user_api_hash`.
- [ ] If no automated report endpoint is configured, confirm the setup blocker says to ask the provider for trip/report endpoint, auth method, token path, row path, and sample response.
- [ ] Confirm capability diagnostics separate provider default capability from observed row capability.
- [ ] Confirm observed BlueTrax/JLCL rows show `GPS Intelligence` unless ignition/CAN/tank signals have been explicitly verified.
- [ ] Confirm supported engine/tank signals show `none declared` for GPS-only providers.
- [ ] Confirm placeholder zero signals are shown as safe counts only and do not upgrade capability.
- [ ] Confirm Advanced diagnostics shows a safe Provider API capability scan after Test Connection, with field-name evidence such as GPS, speed, provider idle markers, odometer/mileage, ignition/engine state, fuel, driver, geofence/site, diagnostics/faults, event/status, PTO/auxiliary, safety, and HOS/duty status where detected.
- [ ] Confirm provider capability discovery never shows raw payload values, tokens, passwords, cookies, full coordinates, or secrets, and that field names alone do not mark engine-on idle, fuel burn, diagnostics, or driver behavior as verified.
- [ ] Run FleetTrack/Oak Test Connection and confirm useful current-feed fields such as `total_distance`, `engine_hours`, nested engine-hour/fuel/status fields, and alarms move from useful-unmapped to mapped-by-Nava evidence where present.
- [ ] Run BlueTrax Test Connection and confirm `mileage` is treated as provider-reported current-feed distance evidence when present; provider fuel/theft/engine-on idle claims remain absent unless explicit supported signals prove them.
- [ ] Confirm distance diagnostics, if provider report rows exist, separate provider-reported mileage from physical odometer values.
- [ ] Confirm automated distance report feed status is clear: active feed rows/matches when configured, or "No automated distance report feed is active yet" when not configured.
- [ ] For FleetTrack/Oak and Gold-style setup, confirm `/get_devices` is treated as the current vehicle feed and `/get_reports` is listed as a report-feed placeholder, not active until date range/report type/device parameters, row path, and distance mappings are configured.
- [ ] If an automated distance/report feed is configured, confirm Test Connection dry-runs rows found, mapped distance fields, matched assets, and rows-would-write without exposing secrets.
- [ ] If automated feed auth fails, confirm the setup blocker identifies the missing endpoint/auth token path/row path/field mapping requirement without showing tokens or raw payloads.
- [ ] Upload a provider distance report CSV in fallback/backfill mode and confirm parsed rows, matched assets, unmatched rows, static-zero count, mismatch count, and rows-would-write are shown before import.
- [ ] Import CSV only as fallback/backfill after dry-run preview, then confirm matched rows are written to provider trip summaries and not to point telemetry logs.
- [ ] Confirm static zero odometer values with non-zero mileage are treated as odometer-health issues, not as zero movement.
- [ ] Confirm no secrets, tokens, cookies, Authorization values, raw provider payloads, or auth configs are visible.
- [ ] Confirm enrichment diagnostics show safe counts/key names only.
- [ ] Confirm data discovery sample shape shows keys and value types only, not provider secrets, tokens, cookies, Authorization values, raw rows, or raw response bodies.
- [ ] Confirm BlueTrax current fuel limitation is treated as a provider-pending integration item, not a product failure.
- [ ] If testing a second provider on an existing fleet, confirm Provider Vault reports cross-provider asset matches instead of creating duplicate billable-review assets.
- [ ] Confirm provider labels with an attached trailer, such as `KCF529Z ZF3316`, canonicalize to truck `KCF529Z` with attached trailer context `ZF3316`; the trailer does not become a separate billable intelligence asset.
- [ ] Confirm second-provider telemetry logs preserve the incoming `provider_id` and signal quality.
- [ ] Confirm verified richer capability declarations can improve asset capability, while placeholder/auto-observed values do not silently upgrade GPS-only assets.

Expected BlueTrax note:

- Primary BlueTrax location sync can work while Fleet Current Status fuel remains pending until the web analytics auth/report feed is correctly authorized or BlueTrax provides official report API access.

## 6. Asset Review Smoke Test

Open `/admin/assets?companyId=<id>`.

- [ ] Confirm Current provider assets count is visible and represents the customer-facing provider asset list, not raw historical database rows.
- [ ] Confirm top summary cards show Current provider assets, Enabled intelligence assets, Pending review, Needs classification, Needs timestamp review, and Excluded/disabled.
- [ ] Confirm pending-review assets are visually obvious.
- [ ] Confirm legacy/pre-normalization rows do not appear as normal customer review work when a newer current provider asset row exists.
- [ ] Confirm backend/raw counts such as raw provider records, canonical groups, hidden legacy rows, and identity collisions are absent from the main customer summary and available only as platform diagnostics if shown.
- [ ] Confirm a clean provider asset label such as `KCF529Z ZF3316` is shown as the Asset name and is not marked Needs match review unless another competing current provider asset row exists.
- [ ] Confirm bulk enable refuses any current-state match-conflict row and the billable preview does not count protected rows as new billable assets.
- [ ] Confirm obvious non-primary labels such as `MOTOR BIKE`, `TOYOTA PROBOX`, `HILUX PICK-UP`, or raw IMEI/device IDs are kept out of likely-truck and truck-duplicate counts.
- [ ] Confirm the Needs classification tab shows non-primary/noisy rows separately from Unreviewed trucks.
- [ ] Confirm FleetTrack/Oak and Gold assets do not display 1970-style `Last seen` dates; invalid provider timestamps show `Provider timestamp invalid` or `Last seen unavailable`.
- [ ] Confirm the `Needs timestamp review` filter shows assets with invalid, missing, future, or first-seen-conflicting provider timestamps.
- [ ] Confirm search works by truck ID/plate, provider, category, and review status.
- [ ] Confirm truck-and-trailer provider labels show the provider asset name first, with the internal match key and trailer label context shown only as secondary review detail.
- [ ] Confirm filters/tabs work for Review assets, Pending review, Enabled intelligence, Excluded/disabled, Needs timestamp review, Needs classification, Cars/pickups/motorbikes, and Trucks.
- [ ] Select multiple unreviewed provider assets and bulk exclude cars/pickups/motorbikes with an excluded reason.
- [ ] Select truck assets and bulk enable only after the confirmation shows projected billable enabled count and planning-only monthly estimate.
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

## 7. Billing Smoke Test

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

## 8. Operations Smoke Test

Open these routes with appropriate company roles:

- [ ] `/finance/rate-rules`
- [ ] `/ops/dashboard`
- [ ] `/ops/efficiency`
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
- [ ] Open `/finance/dashboard` as a finance/management role and confirm the Finance Hub routes to finance-owned work: Revenue Review, Client Rates, Expense Review, Fuel Cost Review, Fuel Providers, and Contribution Review.
- [ ] Confirm `/finance/dashboard` does not show `Create Trip` as a finance action; Trip creation remains available from `/ops/journey` or `/ops/journey/new` only for roles allowed to create Trips.

Confirm workflow behavior:

- [ ] Create Trip keeps saved route picker behavior.
- [ ] Create Trip keeps enabled vehicle picker behavior.
- [ ] Create Trip saves production journeys as `is_demo = false` and preserves `start_time` / `end_time` if supplied.
- [ ] Create Trip persists the selected same-company driver link (`driver_id`) when the picker is used.
- [ ] Create Trip persists typed manual driver text in `journeys.driver` when no driver-directory ID is selected.
- [ ] Create Trip with an enabled provider asset such as `KBJ132C` succeeds even if the live `journeys.asset_id` FK cannot accept `fleet_assets.id`; in that case the Trip preserves the vehicle text and safely leaves `asset_id` null.
- [ ] Create Trip accepts partial trips: client, vehicle, origin, destination, status, and start time are enough; revenue, fuel, expenses, and end time can be added later.
- [ ] Finance-visible commercial fields can store quantity/rate when known, but Trip Intelligence still marks contribution unsafe until linked cost evidence exists.
- [ ] After creating a Trip, open `/ops/journey/[id]` from the Trip list or the create flow and confirm the detail page shows trip reference, status, truck/provider asset, client, route, start/end time, driver, Trip Intelligence readiness, missing-data notes, and management flags.
- [ ] On Trip Detail, assign or update a driver/timing/status with an ops/admin role and confirm the page refreshes without changing finance values.
- [ ] On Trip Detail, use the Asset availability context row to mark the Trip truck Under repair, Breakdown reported, Out of service, At client/site, Loading, Offloading, Waiting, or Available; confirm it is operating context only and does not create a transfer/incident workflow.
- [ ] On Trip Detail, enter `KARIUKI` as manual driver text, save, and confirm Driver shows `KARIUKI` and Trip Intelligence labels driver evidence as manual driver text instead of missing.
- [ ] On Trip Detail, add or update revenue with a finance/elevated role and confirm Trip Intelligence no longer lists missing revenue after refresh.
- [ ] On Trip Detail, confirm allocated fuel appears as litres/cost allocation evidence and does not claim actual fuel burn, theft, tank balance, or fuel efficiency.
- [ ] On Trip Detail, allocate part of an existing fuel issue to the Trip only when the role can edit fuel; confirm the fuel issue remaining/carry-forward balance is still shown safely.
- [ ] On Trip Detail, add a linked expense with a finance/elevated role and confirm it appears as a separate trip expense, not merged into fuel.
- [ ] Confirm linked expense cards clearly show supplier/vendor/payee, payment method, reference number, amount, and date before attached evidence files.
- [ ] Apply the `evidence_attachments` migration, the forward migration that expands `related_type` to `trip`, `expense`, `fuel_log`, and `fuel_allocation`, the forward migration that adds expense `payment_proof`, and the forward migration that adds `evidence_hash`; confirm the private `trip-evidence` Supabase Storage bucket exists before testing evidence uploads.
- [ ] On Trip Detail, add a linked trip expense and use the Proof optional fields in the same Add trip expense form to upload a receipt, invoice, payment proof, or M-Pesa proof and/or paste payment/receipt text.
- [ ] Confirm saving creates the expense first, then attaches the uploaded file and pasted proof text to that new expense.
- [ ] Confirm pasted M-Pesa or other payment text appears as evidence under the expense and is not parsed into amount/date/name/transaction-code facts yet.
- [ ] Upload the same proof file to the same expense twice and confirm the second upload is blocked with a safe duplicate-proof message.
- [ ] Paste the same proof text twice with different spacing/case and confirm the second paste is blocked with a safe duplicate-proof message.
- [ ] If an older pre-hash attachment already exists with the same filename, MIME type, and file size, upload the same proof again and confirm Nava blocks it with the same duplicate-proof message.
- [ ] If both a legacy null-hash proof row and a newer hashed proof row exist for the same expense, confirm Trip Detail shows one proof item, prefers the hashed/newer row, and may show the subtle note `Duplicate-looking pre-hash evidence hidden.`
- [ ] Confirm old pre-hash duplicate rows are not deleted automatically; any permanent cleanup remains a company-scoped manual/admin task.
- [ ] Try uploading an unsupported file type and confirm the inline form error says `This file type is not supported.`
- [ ] Try uploading a file larger than 4MB and confirm the inline form error says `File is too large. Maximum size is 4MB.`
- [ ] If evidence schema/hash migration or storage bucket setup is missing, confirm Trip Detail shows a safe setup-required message instead of failing silently or exposing raw storage details.
- [ ] If proof upload fails after expense creation, confirm the expense remains saved and the page says proof can be attached from the expense card.
- [ ] Attach a receipt, invoice, payment proof, or M-Pesa proof later from an existing expense row's Attach proof flow.
- [ ] Confirm the proof appears under that exact expense row, not only in the general Trip evidence list.
- [ ] Add two expenses of the same category, for example `Per diem` KES 6,000 and `Per diem` KES 5,000, and confirm Trip Detail shows `Per diem` total KES 11,000 from 2 records.
- [ ] Confirm each expense keeps its own proof list even when category totals roll up together.
- [ ] Confirm Trip Intelligence contribution linked expenses include both records in linked expense cost and linked variable cost.
- [ ] On Trip Detail, upload a delivery note, weighbridge ticket, invoice, or other trip-level document in General trip evidence and confirm it stays separate from expense receipts.
- [ ] Confirm an expense receipt supports the specific expense/vendor/payment record, while general trip evidence supports delivery, movement, cargo, or tonnage and is not treated as supplier-payment proof by itself.
- [ ] Confirm evidence opens only through a short-lived secure link, does not expose a public file URL or raw storage path, and remains inaccessible to users outside the related record's company.
- [ ] Confirm M-Pesa proof is stored as evidence only; no M-Pesa text parsing, fuel-burn, theft, or expense inference is claimed yet.
- [ ] As an ops/clerk-style user with journey edit access but without finance visibility, open Trip Detail and confirm operational entry, expense creation, expense proof, and general trip evidence work without showing revenue, rates, contribution, margin, or management flags.
- [ ] As an ops/clerk-style user without finance visibility, confirm fuel allocation costs, linked variable costs, and management finance flags are hidden while fuel litres and operational proof remain usable where the role can view fuel.
- [ ] As a finance/management/elevated user, open the same Trip Detail and confirm Finance / revenue and Management intelligence sections are visible according to role permissions.
- [ ] Confirm revenue/rate/FX entry remains finance-controlled. Clerks should not need confidential rates to enter operational expenses or proof.
- [ ] As an ops/clerk-style user, open `/ops/journey/new` and confirm only operational Trip fields are visible; rate, currency, billing quantity, FX, revenue, and contribution fields are not shown or saved.
- [ ] As a finance/management/elevated user with Trip creation access, confirm commercial Trip creation fields are available where intended and still store through role-gated server logic.
- [ ] As a finance/elevated user, create a Client Rate Rule through `POST /api/finance/rate-rules` with client, optional route, unit type, billing quantity source, rate, currency, FX policy, effective date, and status.
- [ ] As a finance/admin user, open `/finance/rate-rules`, confirm existing current-company rules appear, and create a new test rule without any hardcoded tenant examples in the form.
- [ ] Confirm the Client Rates form uses separate editable `From / Origin` and `To / Destination` fields, not only a combined route selector.
- [ ] If the optional Trip route helper is shown, select a current-company Trip and confirm it fills client, From / Origin, and To / Destination while leaving the fields editable before saving.
- [ ] Create a route-specific rate rule with From / Origin and To / Destination populated, then confirm the table displays the lane in origin-to-destination order.
- [ ] Create a client-wide/default rate rule with From / Origin and To / Destination blank, then confirm the table displays `Default / all routes`.
- [ ] Confirm the reverse lane is not treated as the same rate unless finance creates a separate reverse-direction rule.
- [ ] As a management user, confirm `/finance/rate-rules` is visible read-only if the role can view finance but cannot edit finance.
- [ ] As a management/finance/elevated user, call `GET /api/finance/rate-rules` and confirm rules are returned only for the selected company.
- [ ] As an ops/clerk-style user without finance visibility, confirm `GET /api/finance/rate-rules` and `GET /api/finance/revenue-rules/match?journeyId=<id>` return a finance access boundary instead of rates or revenue amounts.
- [ ] For a same-company Trip with matching client/route and available billing quantity, call `GET /api/finance/revenue-rules/match?journeyId=<id>` and confirm the match status is `unique_match` with a revenue preview.
- [ ] Confirm the rate-rule matcher returns `no_rule`, `multiple_matches`, `missing_quantity`, or `missing_fx` instead of guessing when a configured rate cannot be applied safely.
- [ ] Open `/finance/revenue` as a finance/admin role and confirm it is titled `Finance Revenue Review`, not `Revenue Engine` or `Rate setup`.
- [ ] Confirm `/finance/revenue` links to `/finance/rate-rules` for rate setup instead of creating rates on the revenue page.
- [ ] Confirm `/finance/revenue` shows finance-scoped Nava Eye prompts such as Trips needing review and Finance priorities, and that these prompts are not exposed to ops-only roles.
- [ ] Confirm each Trip row/card shows trip reference, client, route, truck, quantities, current revenue source, match status, and matched rate-rule summary when one exists.
- [ ] On a Trip with no matching rate, click `Ask why no rate matched` and confirm Nava Eye stays in finance/revenue review context.
- [ ] Apply a unique matched configured rate and confirm `/api/finance/revenue` writes `journey_revenue_entries.revenue_source = configured_rate` while updating the compatibility journey revenue snapshot.
- [ ] Confirm manual finance entry remains an override/correction path with a reason, not the default rate setup workflow.
- [ ] Confirm `/api/finance/revenue` still updates existing journey revenue snapshots and, when the migration exists, writes an auditable `journey_revenue_entries` record labeled `configured_rate`, `manual_finance_entry`, or `overridden`.
- [ ] Confirm Trip Intelligence uses the latest `journey_revenue_entries` record when available and falls back to the journey revenue snapshot when the revenue-entry table is absent or empty.
- [ ] Confirm no external FX service is called; non-KES revenue requires a manual/company-standard/fixed FX rate before KES revenue can be calculated.
- [ ] Confirm generic Trip Detail UI does not show hardcoded pilot tenant examples, truck plates, clients, driver names, routes, or contribution amounts; such values should appear only when loaded from the current company data.
- [ ] On Trip Detail, confirm the Nava Eye context strip offers Trip summary, missing links, expenses/proof, and finance/contribution prompts only where the role allows them.
- [ ] Click `What is missing?` from Trip Detail and confirm Nava Eye opens a fresh Trip-scoped investigation and follow-ups stay on that Trip.
- [ ] Vehicle picker can fill the truck field.
- [ ] Current standing driver assignment can fill or suggest the driver field.
- [ ] Fuel entry creates a fuel issue ledger record. A fuel issue linked with legacy `journey_id` remains a fallback only; exact Trip fuel cost should come from `fuel_allocations`.
- [ ] Apply the `fuel_allocations` migration before testing allocation workflows.
- [ ] Create a 700L fuel issue with no exact Trip allocation, then call `POST /api/fuel/allocations` to allocate 450L to Trip A and confirm `GET /api/fuel/allocations?fuelLogId=<id>` shows 250L remaining/unallocated or carry-forward pending.
- [ ] Confirm the allocation API rejects a second active allocation that would exceed the fuel issue litres/cost, excluding reversed allocations.
- [ ] As an ops/fuel-entry role without finance visibility, confirm `/fuel`, `/fuel/new`, `/api/fuel`, and `/api/fuel/allocations` show litres, truck, vendor/source, status, and notes but do not return or display `price_per_liter`, `total_cost`, `allocated_cost`, or cost summaries.
- [ ] As a finance/management/elevated role, confirm fuel issue costs, allocation costs, and cost summaries remain visible.
- [ ] Expense entry uses JourneyPicker and submits without changing payload names.
- [ ] Live Tracking only shows enabled intelligence assets.
- [ ] Geofence labels render when matched.
- [ ] Live Tracking does not show raw coordinates as the primary location. Dash-like provider labels such as `-` should fall back to readable provider labels, geofences, exact/nearby cached place labels, dispatcher-friendly Kenya urban/landmark/town/corridor wording such as `by The Hub, Karen, Nairobi`, `around JKIA / Embakasi, Nairobi`, `around Industrial Area, Nairobi`, `by Mombasa Port, Mombasa`, `around Maungu, about 2.4 km south of town`, `around Malaba, Kenya border`, `between Voi and Mariakani, around Taru`, or `along the Voi-Mariakani corridor`, then `Readable place name unavailable`.
- [ ] Confirm `/api/tracking/live` does not return raw `latitude` / `longitude` to normal company users by default; coordinates require an explicit elevated/debug request.
- [ ] Confirm Live Tracking top cards prioritize operational state (`Enabled assets`, `Live now`, `Stale assets`, `Telemetry 24h`, `Providers`) and do not show raw imported asset counts as a primary card.
- [ ] Confirm Live Tracking rows show active Trip context when a same-company non-demo journey is active/open and matched to the truck, for example `Trip: BAMBURI · MOMBASA → ATHI RIVER`, while keeping current location separate.
- [ ] Complete/offload/end that Trip and confirm Live Tracking no longer shows it as active Trip context.
- [ ] Confirm the Live Tracking command bar appears below setup/review notices and above the Live trucks / Provider status / Stale assets grid.
- [ ] Search a truck with and without spaces or hyphens and confirm the same row appears without clearing on auto-refresh.
- [ ] Search by provider name, safe provider asset label, attached trailer label when present, active Trip client/route, geofence, and readable location; confirm raw coordinates are not exposed.
- [ ] Search an exact stale truck and confirm the matching stale asset appears before Provider status; clear search and confirm the normal Live trucks / Provider status / Stale assets layout returns.
- [ ] With a Live Tracking search/filter active, click `Ask Nava Eye about these results` and confirm Nava Eye opens a scoped result-set question.
- [ ] On a live truck row, click `Ask about this truck` and confirm follow-ups such as `what should I do about it?` stay on that truck.
- [ ] On a stale truck row, click `Ask about this truck` and confirm Nava Eye explains stale/freshness checks without raw coordinates.
- [ ] Confirm quick filters preserve grouping: Live, Stale, Moving, Stopped, Has active trip, and Needs readable location. If no rows match, the page shows `No matching assets found.`
- [ ] With only search text active, confirm the reset button says `Clear search` and clears search without changing the selected filter.
- [ ] With only a quick filter active, confirm the reset button says `Reset filter` and returns to `All`.
- [ ] With search text and a quick filter active, confirm the reset button says `Reset search & filter` and clears both.
- [ ] With search text active, click the `All` chip and confirm the search text remains.
- [ ] Apply the `asset_availability_events` migration, mark an enabled truck `Under repair` or `Grounded` from Live Tracking or Trip Detail with an ops/admin role, and confirm Live Tracking shows a compact availability chip without raw coordinates or incident-form clutter.
- [ ] Mark the same truck `Available` again and confirm the active availability chip clears.
- [ ] Call `GET /api/ops/efficiency?range=yesterday` with an ops-visible role and confirm the JSON returns movement, idle/stopped, stale-location, productivity, driver-readiness, and client-waiting readiness sections.
- [ ] Confirm `/api/ops/efficiency` labels metric evidence as provider-reported, GPS-estimated, provider-derived, unavailable, or not enough linked data instead of inventing fuel/contribution/driver/client conclusions.
- [ ] Confirm Trucks Moved Most separates provider trip/report distance, provider current-feed odometer/mileage delta, and GPS-estimated fallback. If provider mileage is detected but cannot form a safe period delta, the row should say that instead of presenting GPS fallback as final provider distance.
- [ ] Confirm Trucks Moved Most telemetry is fetched across the full selected data window with ordered pagination, not from a single globally limited early-day batch.
- [ ] Confirm Evidence Sources shows GPS telemetry rows/pages fetched and marks the source partial if a telemetry row cap is reached.
- [ ] Confirm each distance row shows first/last telemetry point, points/segments used, and a partial-coverage warning when the last point is much earlier than the selected period end.
- [ ] Confirm stopped-time rows show customer-readable evidence such as "No movement observed in sampled intervals", "Movement observed in X% of sampled intervals", GPS point/interval counts, and low-confidence sparse/capped labels instead of technical observed-interval ratios.
- [ ] Confirm stopped-time rows are labeled GPS-estimated stopped time and do not claim engine-on idling, fuel burn, driver waste, or fuel misuse.
- [ ] On Ops Intelligence movement, stopped, low-productive-time, known unavailable, and tracker idle-marker rows, click the compact Nava Eye action and confirm the prompt stays scoped to that truck/evidence type.
- [ ] On an Ops Intelligence Trip row, click `Ask what is blocking this Trip` and confirm Nava Eye opens a Trip-scoped review question.
- [ ] If a provider current-feed stop duration is present, confirm `/ops/efficiency` shows it separately from Nava GPS-stopped time and explains that provider current stop is the current continuous episode while Nava GPS-stopped is the selected-period stationary total.
- [ ] Confirm stopped rows show cautious context labels such as Provider current stop episode, Provider status indicates stopped/parked, At/near known place, or Unknown stopped time, without turning site dwell into client delay or blame.
- [ ] Confirm trucks with active availability statuses such as Grounded, Under repair, Breakdown reported, or Out of service are labelled as known unavailable context in Ops Intelligence and are not treated as ordinary low-productivity candidates.
- [ ] Confirm idle/excessive-idle event sections are labeled provider idle markers/provider-derived marker windows unless ignition/engine/CAN data verifies true engine-on idle.
- [ ] Confirm provider idle markers are present in `telemetry_events` as canonical `provider_idle_marker` rows when the provider feed supplies idle/excessive-idle marker values.
- [ ] Confirm legacy `excessive_idle` / `long_idle` rows count as provider-derived markers only when metadata does not mark them as GPS-generated/event-engine stopped estimates.
- [ ] Confirm GPS-only stopped windows and GPS-generated `excessive_idle` rows are not counted as provider-derived idle markers.
- [ ] Confirm Provider Idle Markers shows marker/window counts and observed marker span, and never displays impossible 100+ hour provider-duration totals for a one-day operating window.
- [ ] Confirm provider/legacy `duration_minutes` fields are not summed unless duration semantics are verified as per-event.
- [ ] Ask Nava Eye "which trucks have idle markers?" and confirm it answers with provider idle marker evidence first, while saying engine-on idling and fuel burn are not verified without ignition/engine/CAN support.
- [ ] Ask Nava Eye why a provider stop duration differs from Nava stopped time and confirm it explains provider current stop versus selected-period GPS-stopped total without claiming engine-on idle, fuel burn, client blame, or driver blame.
- [ ] Confirm `/api/ops/efficiency` does not return raw coordinate series and does not expose disabled/unreviewed asset telemetry.
- [ ] Confirm `/api/ops/efficiency` does not let future provider timestamps inflate movement/stopped/productivity metrics or mark an asset fresh when timestamp quality is suspicious.
- [ ] Confirm ops/management/owner/admin/platform-owner can view operational efficiency summaries and unauthorized roles receive a role boundary.
- [ ] Open `/ops/efficiency` and confirm the page fetches operational efficiency and Trip Intelligence through the authenticated app session pattern instead of requiring direct unauthenticated API browsing.
- [ ] Confirm `/ops/efficiency` range selector works for today, yesterday, and 7 days.
- [ ] Confirm Today defaults to the current company/operator date, the selected period/data window are shown in local time, Yesterday shows the previous local date, and stale async responses cannot repaint Yesterday data after switching to Today.
- [ ] Confirm `/ops/efficiency` shows trucks moved most, stopped most, stale locations, low productive-time trucks, idle marker windows, evidence labels, Trip Intelligence counts, missing-data summary, and not-enough-linked-data panels.
- [ ] Confirm `/ops/efficiency` shows a friendly in-page access message instead of raw JSON when the user lacks access.
- [ ] Call `GET /api/ops/trip-intelligence?range=yesterday` with an ops-visible role and confirm the JSON returns Trip records projected from `journeys`.
- [ ] Confirm `/api/ops/trip-intelligence` does not require `journeys.updated_at`; it uses `start_time` / `end_time` when available and `created_at` as fallback.
- [ ] Confirm Trip Intelligence interprets journey `start_time`, `end_time`, and `created_at` values without explicit timezone offsets in the company/operator timezone, so same-day active Trips are not dropped on UTC server runtimes.
- [ ] Confirm production Trip Intelligence excludes demo journeys. If no real trips exist, the API succeeds with `trips: []`, journey source `empty`, and a clear empty-state message instead of schema-missing output.
- [ ] Create one real production Trip in `/ops/journey/new`, then open `/ops/efficiency?range=today` and confirm Trips projected is greater than 0 with clear missing-data notes if revenue/cost/distance links are incomplete.
- [ ] Confirm Trip Intelligence returns trip identity, asset evidence, driver evidence, movement evidence, delay evidence, stale-tracking evidence, missing-data notes, contribution-review readiness, and management flags.
- [ ] Confirm Trip Intelligence labels movement distance as provider-reported, GPS-estimated, journey-recorded, or unavailable, and does not return raw coordinate series.
- [ ] Confirm Trip Intelligence uses journey revenue plus `fuel_allocations` and linked `expenses` only when the role can see finance, and does not use unlinked fuel/costs for exact trip contribution.
- [ ] If a journey has no fuel allocations but has legacy `fuel_logs.journey_id`, confirm Trip Intelligence labels the fuel source as `legacy_journey_link`.
- [ ] Confirm Trip Intelligence uses the 450L allocation/cost for Trip A, not the full 700L fuel issue, and does not claim actual fuel burn, fuel theft, or fuel efficiency.
- [ ] As an ops-only role, confirm Trip Intelligence hides finance amounts and returns a role visibility note.
- [ ] As a finance/management/elevated role, confirm Trip Intelligence keeps deterministic machine readiness while the UI labels revenue-plus-linked-cost trips as `Contribution review ready`, not raw `Calculable`.
- [ ] On Trip Detail, confirm the Contribution summary shows revenue, allocated fuel cost, linked expenses, linked variable cost, contribution, and contribution margin from linked evidence only.
- [ ] Confirm `Contribution per tonne` does not show `Requires billing quantity` when billing/offloaded quantity exists and the per-tonne value is calculated.
- [ ] On `/ops/efficiency`, confirm contribution-ready trips show a compact contribution line with revenue, linked variable cost, contribution, and margin.
- [ ] Confirm missing distance appears separately as `Distance evidence missing` / `Distance-based metrics pending` and only blocks per-km metrics, not basic contribution review from linked revenue minus linked costs.
- [ ] If per-km contribution uses GPS-estimated distance, confirm Trip Detail, `/ops/efficiency`, and Nava Eye label it as provisional/GPS-estimated and say provider distance is still needed for final per-km review.
- [ ] Confirm trips with linked fuel allocation and no other expenses show `No additional trip expenses linked yet` as a supporting note rather than a blocker.
- [ ] Confirm contribution wording does not claim final audited profit, fuel burn, fuel efficiency, or fuel theft.
- [ ] Confirm Trip Intelligence does not require fuel as the only cost source and does not invent contribution when linked revenue/cost evidence is missing.
- [ ] As a finance/management/elevated role, open `/management/dashboard` and confirm the period selector supports Today, Yesterday, 7 days, and 30 days.
- [ ] Confirm Management Intelligence uses `Review-ready contribution`, `Contribution per active day`, `Trips reviewed`, and `Trips needing review` instead of `Net Margin`, `Top clients by profit`, or `Journey ranking`.
- [ ] Confirm Trip contribution velocity ranks reviewed Trips by contribution/day, shows contribution/trip, duration, estimated trips/week potential, and marks active/open Trips as provisional.
- [ ] Confirm Client contribution velocity shows total contribution, average contribution/trip, average duration days, average contribution/day, trip count, and estimated trips/week potential for the selected period.
- [ ] Confirm operational drag categories show client waiting only when explicit client/customer delay evidence exists; breakdown, road, border, driver, dispatch, and unknown delays must not be blamed on the client.
- [ ] Confirm Management operational drag distinguishes GPS-stopped evidence from provider idle markers and does not present either as true engine-on idle without verified ignition/engine data.
- [ ] Confirm ops/clerk roles cannot access Management Intelligence finance metrics.

## 9. Nava Eye Smoke Test

Run the detailed Nava Eye regression pack in `docs/NAVA_EYE_REGRESSION_TESTS.md` before changing routing, timeline intelligence, metric answers, provider capability wording, or conversation thread UX.

Open `/nava-eye` and ask:

- [ ] Confirm `/nava-eye` opens as a focused AI workspace with a slim conversation rail, wide message area, and bottom composer rather than a narrow form block.
- [ ] Confirm suggested prompt chips sit above the composer, stay compact on desktop, and scroll/wrap safely on mobile.
- [ ] Confirm the old `Done with this investigation?` flow does not interrupt the chat; close/delete controls remain available in the thread controls.
- [ ] Create a new Nava Eye conversation.
- [ ] Open Nava Eye from a contextual page prompt and confirm it creates a fresh investigation thread, sends the scoped prompt, and clears the prompt from the URL.
- [ ] Confirm contextual links from Live Tracking, Ops Intelligence, Trip Detail, Finance Revenue Review, Client Rates, and Provider Vault open `/nava-eye` with the scoped prompt visible in the active conversation instead of rendering an answer on the source page.
- [ ] After opening from a truck, Trip, provider, or revenue-review prompt, ask `what should I do about it?` and confirm Nava Eye keeps the scoped subject without exposing internal context wording.
- [ ] "Which trucks are live?"
- [ ] "Which assets have stale location?"
- [ ] "Is KDQ265 siphoning fuel?"
- [ ] "Why is KDQ265 always stopping?"
- [ ] Ask "Where is KCW 103Z?", then reply "yes" and confirm the follow-up stays on KCW 103Z.
- [ ] Ask "Where is KCF529Z ZF3316?" for a provider asset label and confirm Nava Eye uses the full provider asset name in the answer; if it is not enabled, it should say the provider asset is present in Asset Review but must be enabled before live status can be answered.
- [ ] Ask "Where is KCF529Z?" and confirm Nava Eye can use the internal match key while explaining the matching provider asset name, such as `KCF529Z ZF3316`, where useful.
- [ ] Ask "Where is ZF3316?" for trailer text seen in a provider label and confirm Nava Eye explains it appears in the provider asset name, location/status comes from that tracked provider asset, this is not independent trailer tracking, and not-enabled provider assets do not leak live status.
- [ ] Confirm Nava Eye never says `near -`, `at -`, or raw coordinates; blank provider labels should become a human-readable fallback such as "Nava does not yet have a readable place name for the latest GPS point" or be omitted when another readable place is available.
- [ ] Confirm Nava Eye never displays a provider timestamp ahead of the app clock as an exact future `last seen` time; small skew should read as `just now` / very recent with an approximation warning, and materially future timestamps should say the provider time needs review.
- [ ] Ask "Where is KDQ265?", then ask "How about KDQ266" and confirm Nava Eye answers that truck if it exists, or suggests the closest workspace match instead of returning generic limited context.
- [ ] Ask "How many km has kbu132c gone today?" when the closest workspace asset is a similar plate, then reply "yes" and confirm Nava Eye reruns the original distance question for the confirmed truck instead of only acknowledging the correction.
- [ ] Ask "What has kcq358 been up to today?" and confirm Nava Eye does not show duplicate identical asset choices; if one unique enabled asset remains, it answers directly, and if multiple true matches remain, each option includes distinguishing context such as enabled/review state or trailer/provider label.
- [ ] Ask "What has kcq358 been up to today?" after the asset resolves and confirm Nava Eye returns a Truck Day Story: start/current location, distance evidence, GPS-stopped time, key stop, tracker idle markers if any, active Trip/availability context, and a next action instead of only live status.
- [ ] After the Truck Day Story, ask "show timeline" and confirm Nava Eye lists key movement/stopped windows for the same truck and operating day without raw coordinates.
- [ ] After the Truck Day Story, ask "what about yesterday?" and confirm Nava Eye returns the same truck's previous operating-day story.
- [ ] After the Truck Day Story, ask "how did you calculate that?" and confirm Nava Eye gives audit detail: source hierarchy, telemetry point/block counts, first/last evidence timestamps, distance source, stopped-window method, missing evidence, and no raw coordinates.
- [ ] After the Truck Day Story chain, ask "where is it now?" and confirm Nava Eye keeps the same truck and switches to live status/location without asking which truck.
- [ ] After the Truck Day Story chain, ask "was it idling?" and confirm Nava Eye keeps the same truck and distinguishes GPS-stopped evidence, tracker idle markers, and unverified engine-on idle.
- [ ] Refresh or trigger a new serverless request between Truck Day Story follow-ups and confirm the same truck/period/audit target are rebuilt from persisted conversation context, not process memory.
- [ ] Say "start over" or "clear context", then ask "where is it now?" and confirm Nava Eye asks which truck rather than reusing the previous subject.
- [ ] After "start over", ask "was it idling?" and confirm Nava Eye asks which truck instead of reusing the previous subject.
- [ ] After "start over", ask "how did you calculate that?" and confirm Nava Eye says there is no recent answer to audit or asks what to review.
- [ ] After a Truck Day Story audit, confirm window/date text remains readable, for example `2026-05-29 00:00 to 2026-05-29 23:59`, and is not altered by coordinate hiding.
- [ ] When Nava Eye lists multiple true vehicle candidates, reply "1" or "second" and confirm it reruns the original question for the selected candidate and remembers that subject.
- [ ] Ask "How about KCW103Z" after a truck-status answer and confirm Nava Eye inherits current-status intent for KCW 103Z.
- [ ] Ask "Where is KDQ265?", then ask "How much mileage has it covered today?" and confirm the answer stays on KDQ 265T instead of switching to fleet-wide.
- [ ] After a truck mileage answer, ask "how did you calculate that?" and confirm Nava Eye gives audit detail for the same truck and metric: source hierarchy, provider summary count if any, GPS point/segment counts if used, filtered jumps/gaps, and provisional caveats without raw coordinates.
- [ ] After a truck mileage answer, ask "what about yesterday?" and confirm Nava Eye keeps the same truck and distance intent while changing only the operating period.
- [ ] After a truck mileage answer, ask "what about yday?" and confirm the query understanding layer normalizes it to yesterday and keeps the same truck and distance intent.
- [ ] After a truck mileage answer, ask "diff in distance btwn yday and today" and confirm Nava Eye compares yesterday versus today for the same truck, gives the distance difference, source/caveat, and does not expose raw coordinates.
- [ ] After a truck mileage answer, ask "diff in distance btwn yday and the day before yesterday" and confirm Nava Eye compares yesterday versus the day before yesterday for the same truck, not the company/fleet total.
- [ ] After a truck distance comparison, ask "so which is it?" and confirm Nava Eye explains the relative-date/period ambiguity for the same truck and latest comparison instead of routing to generic fleet health.
- [ ] After a distance comparison, ask "how did u calculate that?" or "why so low?" and confirm Nava Eye gives audit detail for the comparison/latest distance answer instead of a generic fallback.
- [ ] After a truck mileage answer, ask "where is it now?" and confirm Nava Eye switches source to live status/location for the same truck.
- [ ] After a truck status or mileage answer, ask "was it stuck or idling?" and confirm Nava Eye answers with provider idle marker or GPS-stopped evidence for the same truck without claiming true engine-on idle unless supported.
- [ ] After the KDQ265 mileage answer, ask "What about KCW 103Z?" and confirm Nava Eye inherits the mileage intent for KCW 103Z.
- [ ] After the KDQ265 mileage answer, say "The 307km was covered today the 25th" and confirm Nava Eye refers to the previous KDQ 265T metric, resolved date, and exact GPS-estimated distance instead of losing context.
- [ ] Ask "Is that odometer mileage?" and confirm Nava Eye says GPS-estimated route distance is not dashboard odometer mileage when that was the previous source.
- [ ] "How many km has KCW 103Z covered today?" and confirm explicit truck mileage works with provider-reported mileage or GPS-estimated distance.
- [ ] "How much mileage has the fleet covered today?" and confirm a fleet-wide distance answer only happens when fleet/all-truck scope is explicit.
- [ ] Ask "What are yesterday's movements for KCW 103Z?", then "What about KCV020P?" and confirm Nava Eye inherits the yesterday timeline intent for KCV020P.
- [ ] Ask "What are yesterday's movements for KCX 113Y?", then "Can you show me exactly where it was yesterday?" and confirm Nava Eye gives operational location evidence plus a map pin when available.
- [ ] Ask "Where did KCW 103Z spend most of yesterday?" and confirm Nava Eye summarizes major stop/location anchors instead of returning a generic fallback.
- [ ] "Did KCW 103Z make money yesterday?" and confirm the answer either calculates from linked revenue/cost/distance or clearly lists missing data.
- [ ] After a contribution-review readiness answer, ask "What about KDQ265T?" and confirm Nava Eye inherits the contribution-review intent only for roles allowed to see it.
- [ ] "What is contribution per km for KCW 103Z?" and confirm Nava Eye does not invent revenue, cost, or contribution if records are missing.
- [ ] Ask "How did the KBJ132C Bamburi trip perform?" and confirm Nava Eye answers from Trip Intelligence instead of live truck status.
- [ ] Ask "Did the Bamburi trip make money?" as a finance/management/elevated role and confirm the answer includes trip reference, truck/client/route, readiness, revenue, linked fuel allocation cost, linked expenses, contribution, margin, per-tonne where available, and per-km pending when distance is missing.
- [ ] Ask "What was the contribution on KBJ132C Bamburi?" and confirm Nava Eye routes to Trip Intelligence, not live truck status.
- [ ] If multiple KBJ132C Bamburi production Trips exist in the selected range, confirm Nava Eye lists candidate trip IDs/dates/routes/readiness and asks which one to use instead of guessing.
- [ ] Ask the same trip-performance question as an ops-only role and confirm finance amounts are hidden while trip readiness, revenue-present/fuel-linked/expense-linked status, missing distance, and the finance-role boundary remain useful.
- [ ] Confirm trip-performance answers do not claim final audited profit, actual fuel burn, fuel efficiency, fuel theft, or engine-on idling from GPS-only evidence.
- [ ] Ask "What should I act on today?" and confirm Nava Eye returns role-appropriate action items from company-scoped fleet health without leaking finance amounts to non-finance roles.
- [ ] Ask "What should I do today?" with no active truck/Trip context and confirm Nava Eye returns a company-scoped action summary, not a "which truck?" clarification.
- [ ] After a truck or Trip problem answer, ask "What should I do about it?" and confirm Nava Eye keeps the current subject without exposing internal context wording.
- [ ] After marking a truck Under repair or Grounded, ask Nava Eye "why is this truck stopped?" and confirm it uses the recorded availability status first, while saying engine-on idle, fuel burn, driver blame, and client blame are not verified by that status.
- [ ] After a truck distance-unavailable answer, ask "what should i do about it?" and confirm Nava Eye recommends provider sync/freshness and retrying when enough telemetry exists, not whole-fleet health.
- [ ] After a GPS-estimated distance answer, ask "what should i do with that?" and confirm Nava Eye says to treat it as provisional movement evidence and get provider trip/report distance or a safe odometer delta before final per-km review.
- [ ] After an idle-marker answer, ask "what should i do?" and confirm Nava Eye recommends reviewing marker windows without claiming fuel burn, theft, or true engine-on idle.
- [ ] After a Trip performance answer, ask "what should i do?" and confirm Nava Eye gives Trip-specific next steps for proof, distance, fuel allocation, and finance review according to role permissions.
- [ ] Confirm Nava Eye copilot answers are deterministic/source-grounded in Phase 1 and do not call external LLM APIs.
- [ ] Ask "Which expenses on this trip are missing proof?" after a Trip performance answer and confirm Nava Eye checks same-company expenses plus private `evidence_attachments`; normal roles must not receive raw storage paths or public URLs, and finance-restricted roles must not see restricted money fields.
- [ ] After a Trip performance answer, ask "did it make money?" and confirm Nava Eye keeps the active Trip topic; finance roles see allowed contribution amounts, while ops-only roles get a useful restricted summary.
- [ ] Ask "Which trips need revenue review?" as a finance/management/elevated role and confirm Nava Eye summarizes production Trips using `journeys` plus latest `journey_revenue_entries`; ask as an ops-only role and confirm a finance boundary appears.
- [ ] Ask "Does my tracking provider expose fuel or engine data?" and confirm Nava Eye answers from Provider Vault safe capability summaries as detected/mapped/not detected evidence, not final truth or a fuel-burn/theft claim.
- [ ] Ask an idle/stopped question and confirm Nava Eye distinguishes GPS-stationary evidence, provider idle markers, and true engine-on idle; without ignition/engine/CAN support it says engine-on idling and fuel burn are not verified.
- [ ] "Which trucks moved but have no revenue?" and confirm it requires reliable trip/revenue linking before producing an exception list.
- [ ] "Can we trust KCW 103Z odometer?" and confirm the answer uses odometer health/distance quality evidence.
- [ ] As an `ops` user, ask a revenue/contribution question and confirm Nava Eye shows a role boundary without leaking finance values.
- [ ] Confirm Nava Eye suggested prompt chips are generic or generated from current-company data only. They must not hardcode pilot trucks, clients, trip IDs, contribution amounts, or tenant examples.
- [ ] Close the conversation and confirm the thread becomes read-only.
- [ ] Refresh `/nava-eye` and confirm the selected company, selected thread, and open/closed tab remain stable.
- [ ] Close an open conversation from the bottom action after the latest assistant answer.
- [ ] Confirm closing requires confirmation, removes the thread from Open conversations, and returns the page to the conversation list/new state without requiring a manual New click.
- [ ] Reopen the same thread from Closed conversations and confirm it is read-only.
- [ ] Click New and confirm the old truck/trip/client context is not reused; a pronoun-only question such as "where is it now?" should ask which truck or trip to check.
- [ ] Delete a non-active Nava Eye conversation and confirm it disappears after confirmation without deleting other users' conversations.
- [ ] Delete the active Nava Eye conversation and confirm the active thread clears safely.
- [ ] In a mobile viewport, confirm the conversation list, message body, input, close actions, and long answers do not overflow horizontally and remain reachable.

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
- [ ] Closed conversations are archived, not hard-deleted, and remain accessible under Closed conversations.
- [ ] Deleted Nava Eye conversations are soft-deleted from the current user's visible list after the delete migration is applied.

## 10. Client Visibility Smoke Test

Open `/admin/client-visibility`.

- [ ] Confirm only owner/admin/platform-owner style roles can open the Client Visibility management page and APIs.
- [ ] Confirm the page lists same-company links with client name, display name, active/expired/revoked status, expiry mode/date, access count, last accessed, and created/updated timestamps.
- [ ] Generate a new client visibility token link.
- [ ] Confirm the public URL appears only immediately after generation and can be copied from the one-time panel.
- [ ] Confirm existing links do not show the public URL or `token_hash`; they say to regenerate for a new secure link.
- [ ] Regenerate an existing link and confirm the previous link is revoked while the new public URL is shown once.
- [ ] Revoke a link and confirm the public URL stops working.
- [ ] Confirm links generated from `https://navastrat.co` use the product domain.
- [ ] Open `/client` and confirm it is a safe landing page with no tenant list, trip data, truck data, login requirement, or tracking data.
- [ ] Open the public client portal link.
- [ ] Confirm the portal is token-scoped.
- [ ] Confirm valid links show only privacy-limited active delivery visibility for the configured client relationship.
- [ ] Confirm expired, revoked, invalid, and malformed links fail with the safe unavailable message.
- [ ] Confirm the portal does not expose internal dashboards, provider diagnostics, provider raw payloads, auth config, private driver data, unreviewed assets, raw coordinates, or token hashes.
- [ ] Confirm `record_client_visibility_link_access` behavior is either working or documented by Platform Health/manual verification.

## 11. Failure-State Checks

- [ ] Missing `billing_invoices` table shows setup-required guidance.
- [ ] Provider test failure shows readable diagnostics.
- [ ] Provider test diagnostics do not show secrets or raw payloads.
- [ ] Platform Health groups metadata inspection warnings into one manual-verification message.
- [ ] Unauthorized users get 401/403 responses.
- [ ] Cross-tenant `companyId` attempts by non-platform users do not leak data.
- [ ] Expired or invalid client visibility tokens do not leak data.
- [ ] API errors show clear UI messages instead of infinite loading states.

## 12. Demo Readiness Pass/Fail

Mark the pilot/demo ready only when all critical checks pass:

- [ ] Platform health acceptable.
- [ ] Tenant readiness is not blocked.
- [ ] Provider connected or provider limitation documented.
- [ ] Current provider assets reviewed and at least one safe asset enabled.
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
