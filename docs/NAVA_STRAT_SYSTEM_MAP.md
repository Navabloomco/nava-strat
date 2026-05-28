# Nava Strat System Map

Last updated: 2026-05-25

This document is the repo source of truth for the current Nava Strat product surface. Keep it current when routes, tenant rules, provider sync, asset review, or role behavior changes.

## 1. Product Summary

Nava Strat is a multi-tenant fleet intelligence SaaS platform for transport, logistics, field service, construction, and mixed fleet operators.

Brand and domain architecture:

- Legal/company/operator brand: Nava Bloom Co. / Navabloomco.
- Product/SaaS brand: Nava Strat.
- Primary product domain: `https://navastrat.co`.
- Existing company domain: `https://www.navabloomco.com`.
- Existing Vercel production domain: `https://nava-strat.vercel.app`.

The public root route is domain-aware: `navabloomco.com` and `www.navabloomco.com` render the Nava Bloom Co. parent-company homepage, while `navastrat.co`, `www.navastrat.co`, and `nava-strat.vercel.app` render the Nava Strat product landing page.

Keep the existing company and Vercel domains working during the product-domain transition. Public metadata and canonical product URLs should resolve to `https://navastrat.co` through `NEXT_PUBLIC_SITE_URL`, while product URL generation should still prefer request origin where appropriate and use `NEXT_PUBLIC_SITE_URL` as the canonical fallback instead of hardcoding production domains throughout app logic.

The product combines:

- Company onboarding and operating context.
- GPS/telematics provider connection and sync.
- Asset review before intelligence/billing activation.
- Live tracking for enabled intelligence assets.
- Journeys, fuel, expenses, revenue, and profitability.
- Driver directory and standing vehicle assignments.
- Geofences for saved operational places.
- Spares and repair lifecycle records.
- Nava Eye, the cross-domain fleet intelligence assistant.
- Platform-owner pilot readiness and provider onboarding tools.

The main product principle is convenience. Every user-facing page should make the next action obvious and should not require users to know internal URLs, table IDs, provider payload structure, or tenant architecture.

## 2. Current Route/Page Map

### Public and Entry Routes

| Route | Purpose |
| --- | --- |
| `/` | Domain-aware public landing route. `navabloomco.com`/`www.navabloomco.com` show the Nava Bloom Co. parent-company homepage; `navastrat.co`/`www.navastrat.co`/`nava-strat.vercel.app` show the Nava Strat product landing page. Both are public-safe and do not expose internal architecture. |
| `/login` | Supabase-auth login entry. |
| `/pricing` | Public pricing page. |
| `/privacy` | Privacy policy. |
| `/terms` | Terms page. |
| `/onboarding` | Company creation, operating context capture, and initial provider setup request flow. |
| `/client/track/[token]` | Public client tracking portal for tokenized client visibility links. |

### Core App Routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Customer-facing app dashboard and navigation hub for fleet tenants. Platform owners default to the Nava Bloom Co./Navabloomco platform operator workspace on first load. Durable detection uses `companies.company_type = platform_operator`, with the older Navabloomco slug/name heuristic only as a transition fallback when `company_type` is missing. For the platform/operator workspace, platform owners see a platform workspace home with safe aggregate KPIs, grouped platform/tenant/product actions, customer workspace cards, and a presentation-only sensitive metric toggle instead of empty fleet metrics. Customer tenants remain selectable from the company switcher. Includes Nava Eye Watch items built from safe dashboard summaries, and an embedded Nava Eye widget for customer fleet tenants that may pass safe page context for visible dashboard follow-ups. |
| `/nava-eye` | Nava Eye assistant UI with company-scoped investigation conversation threads. Threads are separate from durable Nava Eye memory and can be closed when the investigation is handled. The page preserves selected company, selected conversation, and open/closed tab through URL query state on ordinary refresh without storing message content in localStorage. Closed conversations are archived/read-only for MVP and remain accessible under Closed conversations; future retention can become configurable, such as 90 days. |
| `/tracking/live` | Live tracking view for enabled intelligence assets. Top cards show operational state (`Enabled assets`, `Live now`, `Stale assets`, `Telemetry 24h`, `Providers`); provider/raw import counts stay out of the primary customer-facing metric row. Live/stale rows may show active Trip context from company-scoped non-demo `journeys`, but Trip route context stays separate from current provider location and is not proof of arrival/offload. |
| `/tracking/link` | Tracking link helper page. |
| `/tracking/processor` | Tracking processing/admin helper page. |
| `/tracking/providers` | Older provider-facing tracking route. Provider Vault is the current admin route. |

### Operations Routes

| Route | Purpose |
| --- | --- |
| `/ops/dashboard` | Operations command center: active journeys, enabled assets, alerts, shared disruption context, geofences, and assigned drivers. |
| `/ops/efficiency` | Pilot operational efficiency and Trip Intelligence dashboard. Uses authenticated app session fetches to call `/api/ops/efficiency` and `/api/ops/trip-intelligence`, showing movement, GPS-estimated stopped time, provider idle markers, stale-location, low productive-time, trip-readiness, missing-data, and evidence-source summaries without raw coordinates, engine-on idle claims, or unsafe fuel/profit claims. |
| `/ops/journey` | Journey list with create CTA and journey cards/table. |
| `/ops/journey/new` | Create Trip form with saved route picker, enabled vehicle picker, driver picker, trip start/end time, and optional commercial details. Saves production `journeys` with `is_demo = false`. |
| `/ops/journey/[id]` | Trip Detail Phase 1. Opens one production Trip and separates operational entry from finance/management intelligence. Clerks/ops can complete allowed trip status, driver, timing, trip expenses, expense proof, and general trip evidence. Finance/management/elevated roles see revenue, rates, contribution summary, margin, and management flags according to role gates. Fuel is allocation evidence only, not burn/theft proof. |
| `/ops/journey/templates` | Saved Routes management for route presets. |
| `/ops/drivers` | Driver directory and current vehicle assignments. |
| `/geofences` | Company-scoped geofence list and archive/manage UI. |
| `/geofences/new` | Create geofence form. |

### Finance and Cost Routes

| Route | Purpose |
| --- | --- |
| `/finance/dashboard` | Role-aware Finance Hub linking to safe finance workflows. |
| `/finance/revenue` | Finance Revenue Review. Finance/management/elevated roles review production Trips, see current revenue source, match trips against configured client rate rules, and finance editors can apply a unique matched rule into `journey_revenue_entries` plus the compatibility journey revenue snapshot. This page does not create client rates; `/finance/rate-rules` owns rate setup. Ops/clerk users should not see rates or revenue. |
| `/finance/rate-rules` | Client Rates / Revenue Rules Phase 1 UI. Finance/management/elevated roles can view company-scoped rate rules; finance/elevated roles can create them. Ops/clerk users should not see the route or rates. Route entry uses separate `route_from` and `route_to` fields because direction matters; leaving both blank means a client-wide/default rate. This is a setup/review surface only, not invoicing or a supplier-payment workflow. |
| `/fuel` | Fuel ledger. |
| `/fuel/new` | Fuel entry form with JourneyPicker. |
| `/fuel/providers` | Company-scoped fuel provider management. |
| `/expenses` | Expense ledger. |
| `/expenses/new` | Expense entry form with JourneyPicker. |
| `/management/dashboard` | Management Intelligence dashboard. Finance/management/elevated roles see selected-period contribution velocity, Trip cycle time, contribution per active day, estimated trips/week potential, client contribution velocity, and operational drag/delay caveats. It uses Trip Intelligence contribution evidence instead of broad profit ranking. Ops/clerk users should not see finance intelligence. |

### Spares and Maintenance Routes

| Route | Purpose |
| --- | --- |
| `/spares` | Spares and repairs lifecycle ledger. |
| `/spares/usage/new` | Record spare usage, repair, transfer, retread, purchase, inspection, or removal. |
| `/spares/parts` | Lightweight company parts catalog. No inventory counts or serial tracking yet. |

### Admin and Platform Routes

| Route | Purpose |
| --- | --- |
| `/admin` | Role-aware Admin Hub. Platform owners see platform tools; company owners/admins see company tools. |
| `/admin/assets` | Asset Review for current provider assets and intelligence/billing readiness. Supports platform-owner `?companyId=` tenant context. |
| `/admin/providers` | Provider Vault for tracking provider configuration, testing, sync diagnostics, activation, and enrichment diagnostics. Supports platform-owner `?companyId=` tenant context. |
| `/admin/providers/new` | Guided Add Provider wizard. Customer owners/admins see public/supported providers, Custom API provider, and Request assisted setup; internal/setup-only templates are platform-owner-only and clearly marked as not customer-facing. New connections are created inactive, then tested/reviewed/activated from Provider Vault. |
| `/admin/provider-requests` | Platform-owner provider setup requests. |
| `/admin/provider-playbook` | Platform-owner internal provider onboarding playbook. |
| `/admin/pilot-readiness` | Platform-owner pilot/go-live readiness checklist across tenants. |
| `/admin/pilot-readiness/[companyId]` | Platform-owner tenant readiness detail grouped by setup, provider, asset, billing, role, operations, and Nava Eye checks. |
| `/admin/tenants` | Platform-owner tenant billing/readiness preview across companies. |
| `/admin/tenants/[companyId]` | Platform-owner tenant detail view with provider, member, telemetry, and strict billable asset summaries. |
| `/admin/tenants/[companyId]/invoice-preview` | Platform-owner manual invoice preview for one tenant and billing period. Preview only; no invoice is created. |
| `/admin/client-visibility` | Client visibility link management. |
| `/admin/company` | Company operating context settings. Supports platform-owner `?companyId=` tenant context. |
| `/admin/health` | Platform-owner pilot readiness health check. |

### Shared Components

| File | Purpose |
| --- | --- |
| `app/components/AppShell.tsx` | App shell wrapper. |
| `app/components/Sidebar.tsx` | Role-aware navigation. Uses `/api/companies` role payload defensively. |
| `app/components/JourneyPicker.tsx` | Searchable open journey selector used in fuel, expenses, and revenue helper flows. |
| `app/components/ui/Primitives.tsx` | Shared dark UI primitives such as `PageHeader`, `Panel`, `EmptyState`, buttons, and pills. |

## 3. API Route Map

### Auth, Companies, and Platform

| API Route | Purpose |
| --- | --- |
| `GET /api/companies` | Returns active company memberships, normalized roles, platform-owner status, and visible companies. |
| `GET /api/dashboard/overview` | Authenticated company dashboard overview. Returns `dashboard_mode = fleet` with role-aware safe fleet health for customer tenants, or `dashboard_mode = platform_operator` with safe aggregate platform stats and sanitized customer workspace summaries for the operator workspace when viewed by a platform owner. |
| `POST /api/onboarding/company` | Creates/updates company onboarding data, operating context, and provider setup requests. |
| `GET/PATCH /api/company-settings` | Reads and updates safe company operating context. Supports platform-owner `companyId` context. No billing/provider secrets. |
| `GET /api/admin/pilot-readiness` | Platform-owner-only pilot readiness checklist list across companies. Returns pass/warning/fail counts and safe tenant summaries. |
| `GET /api/admin/pilot-readiness/[companyId]` | Platform-owner-only tenant pilot readiness detail grouped by readiness category. No mutation. |
| `GET /api/admin/tenants` | Platform-owner-only tenant billing/readiness list using strict billable asset counts. |
| `GET /api/admin/tenants/[companyId]` | Platform-owner-only tenant detail with safe company, member, provider, asset, pricing, and telemetry summaries. |
| `GET /api/admin/tenants/[companyId]/invoice-preview` | Platform-owner-only manual invoice preview using strict billable assets, included allowance, and company asset pricing. No mutation. |
| `GET/POST /api/admin/tenants/[companyId]/invoices` | Platform-owner-only tenant invoice records list/create. POST creates a draft from server-side invoice preview calculation. |
| `PATCH /api/admin/tenants/[companyId]/invoices/[invoiceId]` | Platform-owner-only invoice status transitions: draft to sent, sent to paid, draft/sent to void. |
| `GET /api/platform/health` | Platform-owner-only environment, schema, constraint, and RPC health check. |

### Provider and Tracking

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/providers` | Provider Vault list/create. Supports platform-owner `companyId` context. Sanitizes provider credentials in responses. Returns safe provider test summaries, including latest vehicle counts when a successful test/sync has persisted them. POST supports public template creation and structured self-serve custom API provider creation; raw advanced config remains platform-owner-only. New provider connections are created inactive by default. |
| `GET/PATCH /api/providers/[id]` | Provider detail/update and explicit sync activation. Supports platform-owner `companyId` context for safe tenant-scoped updates. Platform-owner-only advanced fleet config including supplemental feeds and auth profiles. Customer owners/admins may update credentials and activate/deactivate sync for their company only after a successful connection test. |
| `POST /api/providers/[id]/test` | Tests provider sync in the resolved tenant context, persists a safe summary in provider config, and returns sanitized diagnostics, including vehicle counts, safe telemetry capability, safe provider API capability discovery, and automated distance-report dry-run counts when available. It also supports discovery-only diagnostics for configured endpoints and explicitly entered report endpoint candidates. It must not expose provider secrets or raw payloads. |
| `POST /api/providers/test-endpoint` | Owner/admin/platform-owner-only custom provider setup helper. Tests one HTTPS provider endpoint with strict SSRF protections, timeout, response-size cap, safe headers, and sanitized structure detection for token paths, row paths, and field mapping suggestions. It does not create, activate, or persist provider config. |
| `POST /api/providers/[id]/distance-import` | Provider-scoped admin CSV distance report fallback/backfill import. Dry-run previews BlueTrax-style report rows, asset matches, odometer health, and rows that would write; commit writes matched rows to `provider_trip_summaries` only. |
| `GET /api/providers/templates` | Role-aware provider templates. Customer owners/admins receive only public/supported self-serve templates; platform owners additionally receive internal setup-only templates marked as platform setup only. No live credentials. |
| `GET/POST /api/providers/setup-requests` | Provider setup request list/create. |
| `PATCH /api/providers/setup-requests/[id]` | Provider setup request status management. |
| `POST /api/sync/providers` | Cron/provider automation sync. Requires `Authorization: Bearer <CRON_SECRET>`. |
| `GET /api/tracking/live` | Role-gated live enabled-asset tracking response with geofence labels and active Trip context. Requires operations visibility. Default customer responses omit raw latitude/longitude; coordinates are returned only for explicit elevated/debug requests. |
| `POST /api/tracking/analyze` | Tracking analysis helper. |
| `POST /api/tracking/enrich-locations` | Location enrichment/cache helper. |
| `POST /api/tracking/pull` | Provider pull helper. |
| `POST /api/tracking/test-provider` | Retired legacy route. Returns HTTP 410. |
| `GET /api/place-search` | Authenticated sanitized Nominatim place helper. |
| `GET /api/reverse-geocode` | Authenticated sanitized reverse geocode helper. |

### Asset Review and Intelligence Enablement

| API Route | Purpose |
| --- | --- |
| `GET /api/fleet-assets` | Asset Review list, operating context, billing preview data, and strict billable counts. Supports platform-owner `companyId` context. |
| `PATCH /api/fleet-assets/[id]` | Enable, exclude, disable, or review-later a provider asset in the resolved tenant context. |
| `POST /api/fleet-assets/suggest-classification` | Asset classification suggestion endpoint using resolved company operating context as weak signal. |

### Operations

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/journeys` | Company-scoped journey list/create with role-gated finance fields. New production trip creation sets `is_demo = false`, stores selected `driver_id` when provided, stores manual driver text in `journeys.driver` when no directory driver is selected, normalizes `start_time` / `end_time` in the company/operator timezone, and accepts operational fields without requiring fuel. Rate, billing quantity, FX, and revenue-like commercial fields are processed only for finance/management/elevated visibility; non-finance journey editors can create the Trip but posted commercial fields are ignored. If the live `journeys.asset_id` FK cannot accept the selected `fleet_assets.id`, creation must preserve the provider asset/truck text and leave `asset_id` null instead of failing. |
| `GET/PATCH /api/journeys/[id]` | Company-scoped Trip Detail bundle and operational trip update. GET returns one non-demo Trip, role-gated capabilities, drivers for assignment where allowed, linked expenses where allowed, fuel allocation evidence where allowed, and latest Trip Intelligence for that Trip. PATCH updates operational trip fields such as driver/status/timing/fuel estimate; revenue remains through `/api/finance/revenue`, expenses through `/api/expenses`, and fuel allocations through `/api/fuel/allocations`. |
| `GET/POST /api/evidence` | Evidence Attachments Phase 1. Company-scoped, authenticated evidence/proof metadata and server-mediated private file upload or text-only proof for `relatedType=trip` or `relatedType=expense`; `fuel_log` and `fuel_allocation` are schema-supported for later fuel evidence but have no UI yet. GET returns safe attachment metadata and short-lived signed URLs; POST validates the same-company related record, evidence type, file type/size or pasted text, supports expense proof types such as receipt, invoice, payment proof, M-Pesa proof, and other, hashes proof content server-side, blocks duplicate proof on the same related record, uploads files to private Supabase Storage, and stores metadata/text in `evidence_attachments`. Failure responses include a safe `status`, `code`, `error`, and `message` so Trip Detail can show duplicate, unsupported type, size, permission, schema, or storage setup errors without exposing internals. No public files, cross-company access, raw storage paths, or M-Pesa parsing. |
| `GET/POST /api/journey-templates` | Saved Routes list/create. |
| `PATCH /api/journey-templates/[id]` | Saved Route update/disable. |
| `GET /api/ops/dashboard` | Role-gated ops dashboard data, alerts, shared disruption candidate, geofence context, and assigned drivers. Requires operations visibility. |
| `GET /api/ops/efficiency` | Role-gated operational efficiency JSON foundation for current provider assets. Returns company-scoped movement, GPS-stopped evidence, provider idle-marker evidence, stale-location, productivity, driver-readiness, and client-waiting readiness summaries for today, yesterday, or 7-day windows. No UI, no fuel/profit math, no raw coordinates, and no engine-on idle claim unless ignition/engine/CAN evidence supports it. |
| `GET /api/ops/trip-intelligence` | Role-gated Trip Intelligence Phase 1 JSON foundation. Projects existing `journeys` into business-readable Trip records with asset, driver, movement, delay, finance-readiness, profitability-readiness, and management flags. Uses current tables only, does not add schema, does not require fuel, and hides finance amounts from roles without finance visibility. |
| `GET /api/ops/enabled-assets` | Active, intelligence-enabled asset picker with current assigned driver. |
| `POST /api/ops/alerts/apply-context` | Applies context labels to excessive idle telemetry events. No suppression or deletion. |
| `GET/POST /api/geofences` | Company-scoped geofence list/create. |
| `PATCH /api/geofences/[id]` | Geofence update/archive. No hard delete. |

### Drivers

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/drivers` | Company-scoped driver directory. GET hides license number in list. |
| `PATCH /api/drivers/[id]` | Driver update. |
| `GET/POST /api/driver-assignments` | Current standing vehicle assignment list/create. |
| `PATCH /api/driver-assignments/[id]` | End assignment or update active assignment start. No hard delete. |

### Finance, Fuel, and Expenses

| API Route | Purpose |
| --- | --- |
| `GET/PATCH /api/finance/revenue` | Finance Revenue Review workflow. Finance visibility/edit gates apply. GET returns company-scoped non-demo Trips with latest safe revenue-entry metadata for review. PATCH can apply a unique configured client rate as `configured_rate`, or save a finance manual/override entry when required; it updates compatibility revenue snapshots on `journeys` and writes an auditable `journey_revenue_entries` record when the revenue-entry migration is present. |
| `GET/POST /api/finance/rate-rules` | Client Rates / Revenue Rules Phase 1 backend. Finance/management/elevated roles may list Finance-owned client/route rate rules; finance/elevated roles may create them. Rules are company-scoped and include client name, optional `route_from`, optional `route_to`, unit type, billing quantity source, rate, currency, FX policy, effective period, status, and notes. Blank route fields represent a client-wide/default rate. |
| `GET /api/finance/revenue-rules/match?journeyId=...` | Finance-visible deterministic matcher that compares one non-demo Trip with active same-company rate rules and returns `no_rule`, `unique_match`, `multiple_matches`, `missing_quantity`, or `missing_fx` plus a calculated revenue preview when safe. It does not update the Trip snapshot by itself and does not call external FX services. |
| `GET/POST /api/fuel` | Fuel issue ledger and fuel entry. Role-gated, company-scoped, explicit safe fields. Ops/fuel-entry users can see and enter operational litres, truck, vendor/source, status, and notes; price and total cost fields are returned only to finance/management/elevated visibility. A fuel issue is not proof of trip fuel burn. |
| `GET/POST /api/fuel/allocations` | Fuel Allocation Phase 1. Company-scoped allocation ledger that assigns part of a `fuel_logs` issue to a Trip, carry-forward balance, or reversal without rewriting the original fuel issue. Prevents active allocations exceeding the issued litres/cost. Allocation litres remain operational evidence; allocated costs and cost summaries are returned only to finance/management/elevated visibility. |
| `GET/POST /api/fuel/providers` | Company-scoped fuel provider settings. |
| `PATCH /api/fuel/providers/[id]` | Fuel provider update/disable. No hard delete. |
| `GET/POST /api/expenses` | Expense ledger and creation. Finance role gates apply for the general ledger. Trip-linked expense creation is also allowed for users who can edit journeys so clerks/ops can capture operational trip costs and proof without seeing finance intelligence. |
| `GET /api/management/dashboard` | Role-gated Management Intelligence data. Requires finance/management/elevated visibility and supports `range=today|yesterday|7d|30d`. Returns Trip Intelligence-backed review-ready contribution, contribution per active day, Trip cycle/duration metrics, client contribution velocity, trips needing review, and delay/operational-drag categories without raw coordinates or final-profit claims. |

### Spares and Maintenance

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/spares/usage` | Company-scoped spare lifecycle event ledger. No inventory mutation. |
| `GET/POST /api/spares/parts` | Lightweight parts catalog. No stock counts or serial tracking. |
| `PATCH /api/spares/parts/[id]` | Parts catalog update/disable. No hard delete. |

### Nava Eye

| API Route | Purpose |
| --- | --- |
| `POST /api/nava-eye/copilot` | Main Nava Eye assistant route. Uses context router, entity resolver, role-aware context, safe dashboard page context, deterministic fallbacks, deterministic business metric helpers, and source-grounded internal orchestration. External LLM calls are disabled in Phase 1. Accepts optional `conversation_id` for threaded follow-ups and rechecks current role permissions on every message. |
| `GET/POST /api/nava-eye/conversations` | Lists or creates current-user Nava Eye investigation threads for the resolved company. |
| `GET/PATCH /api/nava-eye/conversations/[id]` | Reads one current-user conversation with messages or closes an open conversation. Closed conversations are read-only in the MVP. |
| `POST /api/nava-eye/ask` | Older Nava Eye ask route. |
| `GET /api/nava-eye/fleet-summary` | Fleet summary helper. |
| `GET /api/nava-eye/fuel-risk` | Role-gated fuel risk helper. Requires fuel visibility. |
| `POST /api/nava-eye/run-events` | Event engine runner. |
| `GET /api/nava-eye/truck-report` | Truck report helper. |

### Client Visibility

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/client-visibility-links` | Admin-managed tokenized customer tracking links. |
| `PATCH /api/client-visibility-links/[id]` | Update/archive client visibility link. |
| `GET /api/client/track/[token]` | Public token-scoped client tracking response. Must remain privacy-limited. |

## 4. Database Tables and Usage

### Core Tenancy and Settings

| Table | Used For |
| --- | --- |
| `companies` | Tenant record, subscription/billing config, operating context, workspace identity, and `company_type` classification (`platform_operator`, `customer`, or `demo`). |
| `company_users` | Active user memberships and roles. This is the source of tenant access. |
| `company_ai_settings` | Nava Eye provider/model settings. |
| `nava_eye_memory` | Nava Eye memory and recurring operational facts. |
| `nava_eye_conversations` | Company-scoped, user-started Nava Eye investigation threads. Open/closed status, last intent, and short pending follow-up context only. |
| `nava_eye_conversation_messages` | Messages inside Nava Eye investigation threads. Stores user/assistant conversation text, but not provider secrets, raw payloads, auth configs, hidden prompts, or private driver fields in metadata. |
| `billing_invoices` | Platform-owner-created manual invoice records for tenant billing lifecycle tracking. Draft/sent/paid/void only; no Stripe/PDF/email. |
| `analytics_events` | Privacy-safe internal product/activation analytics events. Best-effort only; no third-party analytics, no raw prompts/answers, and no secrets/raw provider payloads. |

`companies.main_billing_unit` is a default billing/work measurement for operating context, not Nava Strat subscription billing and not a fixed rule for every customer job. Actual commercial billing can vary by client, route, journey, cargo, or revenue entry.

### Provider and Telemetry

| Table | Used For |
| --- | --- |
| `tracking_providers` | Provider credentials/config, auth type, fleet URL, field mapping, fleet config, sync status, safe telemetry capability declarations, supported signal metadata, provider timezone, and test diagnostics. Provider test summaries may include safe API capability discovery with field names/counts only, never raw values or secrets. |
| `provider_setup_requests` | Assisted provider onboarding requests. |
| `provider_templates` | Reusable provider setup templates. Internal setup-only templates may document signal mappings for future providers without live credentials or endpoints. |
| `fleet_assets` | Provider asset records, latest asset state, review status, intelligence enablement, billing readiness, and asset telemetry capability profile. |
| `telemetry_logs` | Historical telemetry points from provider sync: location, speed, fuel level, normalized engine/ignition/fuel/tank signal placeholders where supported, provider location label, validation, capability flags, and raw payload server-side. |
| `provider_trip_summaries` | Recommended additive table for provider report/trip-level distance evidence such as start/end odometer, provider-reported mileage, motion duration, start/end locations, violations, distance source, and distance quality. |
| `telemetry_events` | Derived operational events, provider-derived idle markers, and alert context annotations. Canonical provider idle markers use `event_type = provider_idle_marker` with safe metadata such as original marker label/source key. Legacy `excessive_idle` / `long_idle` rows may also count as provider idle-marker evidence only when metadata does not mark them as GPS-generated/event-engine estimates. GPS-derived stopped windows must be labeled separately and must not be treated as true engine-on idle. |
| `location_cache` | Reverse-geocoded location cache. |
| `fuel_risk_scores` | Fuel risk scoring output from fuel risk engine. |

### Operations

| Table | Used For |
| --- | --- |
| `journeys` | Operational trips, linked asset/driver IDs when available, client/route/truck/driver text, start/end time, fuel estimate, status, and finance/revenue fields. Customer-facing product language calls these Trips while the database table remains `journeys`. |
| `evidence_attachments` | Evidence Attachments Phase 1 metadata for receipts, M-Pesa proof, invoices, payment proof, delivery notes, weighbridge tickets, and other documents. `related_type` supports `trip`, `expense`, `fuel_log`, and `fuel_allocation`; Phase 1 UI uses trip and expense only. `evidence_type` includes expense-safe `payment_proof` for bank, cheque, cash, supplier, and other non-M-Pesa proof. `evidence_hash` stores a server-computed SHA-256 hash used only to block duplicate proof on the same company-scoped related record. Files live in a private Supabase Storage bucket such as `trip-evidence`; the table stores company, related record, type, filename, MIME, size, notes, verification status, uploader UUID, and upload timestamp only. |
| `journey_templates` | Saved Routes for faster journey creation. |
| `geofences` | Company-scoped saved places: depots, yards, ports, customer sites, loading/offloading zones, border points, risk zones, service areas, and other. |
| `drivers` | Company driver directory. License fields are not exposed broadly. |
| `asset_driver_assignments` | Standing driver-to-asset responsibility windows until ended. |

### Finance and Cost

| Table | Used For |
| --- | --- |
| `fuel_logs` | Fuel issue / receipt / ledger entries. `journey_id` remains for legacy compatibility, but a fuel issue should not be treated as fully consumed by one Trip unless allocation evidence says so. |
| `fuel_allocations` | Fuel Allocation Phase 1 table. Assigns issued fuel from `fuel_logs` to one or more Trips, carry-forward balances, or reversals. Safe claims are issued, allocated, unallocated, carried-forward, and pending allocation; actual burn/theft/efficiency require later CAN bus or tank-sensor evidence. |
| `client_rate_rules` | Client Rates / Revenue Rules Phase 1 table. Finance-owned company-scoped rules describe client name, optional `route_from`, optional `route_to`, unit type, billing quantity source, rate amount, currency, FX policy, effective window, status, and notes. Direction matters, so an origin-to-destination rule is different from the reverse. Blank route fields mean the rule is a client-wide/default rate. Ops/clerk users should not need to know or see these rates. |
| `journey_revenue_entries` | Auditable Trip revenue application records. Records can represent configured-rate application, manual finance entry, override, or missing revenue state. Existing `journeys` revenue columns remain compatibility snapshots until the Finance UI and Trip Intelligence fully move to revenue entries. |
| `fuel_providers` | Fuel vendor/default price settings. |
| `truck_route_fuel_profiles` | Route/truck fuel profile averages for operational fuel expectations. |
| `expenses` | Expense ledger records linked to journeys when available. Phase 1 structured transaction details live here where possible: supplier/vendor/payee (`vendor`), payment method, reference number, amount, and transaction/date evidence from existing date fields such as `created_at`. |

### Spares and Maintenance

| Table | Used For |
| --- | --- |
| `spare_lifecycle_events` | Spare usage, install/remove/repair/retread/transfer/purchase/inspection lifecycle records. |
| `spare_catalog_parts` | Lightweight reusable parts catalog. No inventory counts yet. |

### Client Visibility

| Table | Used For |
| --- | --- |
| `client_visibility_links` | Tokenized public portal links for selected journeys/customers. |

### Legacy or Caution Tables Still Referenced

| Table | Current Status |
| --- | --- |
| `user_roles` | Referenced by older role components/hooks. Active product role source should be `company_users`. |
| `financial_documents` / `financial-documents` | Referenced by legacy finance evidence components. Current `/finance/dashboard` does not render those components. |
| `trucks` | Referenced by legacy financial evidence uploader. Current fleet identity should flow through `fleet_assets`. |

## 5. Role Model

Roles are normalized by trimming and lowercasing. Shared helpers live in `lib/api/roleAccess.ts`.

| Role | Meaning |
| --- | --- |
| `platform_owner` | Platform-level operator. Can see all companies through controlled APIs and platform-only tools. |
| `owner` | Company owner. Can administer company setup and business workflows. |
| `admin` | Company admin. Can administer company setup and business workflows. |
| `ops` | Operations user. Can manage operational workflows such as journeys, fuel, drivers, assignments, spares usage, and alerts where allowed. |
| `finance` | Finance user. Can view/edit finance workflows where allowed. |
| `management` | Management viewer. Can view management/finance/operations summaries where allowed, generally not edit. |

Current shared helper behavior:

| Capability | Roles |
| --- | --- |
| Elevated/admin | `platform_owner`, `owner`, `admin` |
| Finance view | elevated, `finance`, `management` |
| Finance edit | elevated, `finance` |
| Journey view | elevated, `ops`, `management`, `finance` |
| Journey edit | elevated, `ops` |
| Fuel view | elevated, `ops`, `finance`, `management` |
| Fuel edit | elevated, `ops`, `finance` |
| Expense view | elevated, `finance`, `management` |
| Expense edit | elevated, `finance` |
| Asset review/enablement | `platform_owner`, `owner`, `admin` |
| Platform Health | `platform_owner` only |
| Pilot Readiness Checklist | `platform_owner` only |
| Tenant billing/readiness preview | `platform_owner` only |

Nava Eye and Nava Eye Watch use explicit safe capability flags derived from the resolved same-company role. These include finance, expenses, billing, platform billing, ops, fuel, journeys, spares, and platform-owner capabilities. Nava Eye should answer broadly inside those permissions and return a clear permission-boundary message instead of exposing restricted finance, billing, invoice, expense, provider-secret, raw-payload, or cross-tenant data.

Nava Eye should compare telemetry and event timestamps as actual instants, but user-facing fleet timelines should be displayed in the company/operator timezone where available. Until a durable company timezone field exists, Kenyan fleet answers default to `Africa/Nairobi`; truck timeline/live answers should state the time zone once, then use clean local clock times. Do not present UTC in normal fleet answers unless the user explicitly asks for UTC. Provider timestamps must not be displayed as exact future times. A timestamp slightly ahead of the app/server clock is treated as clock skew and should be phrased as just now / very recent with an approximation warning; a timestamp materially ahead is suspicious, should trigger timestamp review, and must not drive live freshness or movement/stopped calculations.

Nava Eye location answers should be operational, not coordinate-first. Nava-owned location resolution lives in `lib/location/resolveOperationalLocation.ts` and resolves display labels by readable provider label, company-scoped geofence, exact cached reverse-geocode label, nearby cached place label, deterministic Kenya nearest-town/corridor fallback, then coordinate-only fallback with a safe map URL. The Kenya fallback is dispatcher-friendly approximate language that varies by evidence and place type: landmarks can read `by The Hub, Karen, Nairobi`, urban and industrial areas use `around Industrial Area, Nairobi` or `around JKIA / Embakasi, Nairobi`, ports/hubs can read `by Mombasa Port, Mombasa`, towns can read `around Sultan Hamud, about 0.6 km south east of town` or `around Maungu, about 2.4 km south of town` when close and `near Maungu, about 18 km south of town` when farther out, border context reads `around Malaba, Kenya border`, and corridor-only context reads `between Voi and Mariakani, around Taru` or `along the Voi-Mariakani corridor`. It is not a postal address and must not expose raw coordinates. Curated intermediate towns should win before broad corridor labels, so `between Athi River and Sultan Hamud` or `between Nakuru and Eldoret` appears only when no closer known place is acceptable, and corridor labels should include the nearest useful intermediate place when available. Do not use heading, approaching, or toward language unless movement direction or journey evidence safely supports it; active Trip route context stays separate from actual location evidence and must not become the location label by itself. Nava-owned GPS interpretation lives in `lib/intelligence/truckTimelineService.ts`: it turns provider-agnostic `telemetry_logs` pings into compact movement/stationary blocks, compares provider idle markers against later movement, groups repeated provider idle/excessive-idle markers into operational marker windows, and gives Nava Eye an operational day story with first/latest seen, route progression, stop classification, longest stop, and idle-marker continuity interpretation instead of raw coordinate series or duplicate alert dumps. Truck timeline answers default to a logistics narrative: current status once, corridor route prose, provider idle-marker interpretation, and a single hardware/ignition boundary note. Live truck-status answers should use the same command voice: one bold current or last-known status line, one short operational state, stopped/provider-marker wording based on marker proximity and ignition availability, and a concise movement/provider-marker follow-up. Nava Eye should state what the evidence proves, what it suggests, and what remains unverified without leaking raw telemetry jargon or third-person product self-reference such as "Nava reads" or "Nava treats." Movement/history questions with explicit terms such as today, yesterday, route, movement, movements, history, stops, or where did should route to the truck timeline service instead of the current-status answer. Location-evidence follow-ups such as "where exactly was it", "show me where it was", "show me on the map", and "where did it spend the day" should inherit the active truck/timeframe and answer with operational meaning first: main place, visible window, movement/stationary pattern, longest/final stop, and hardware capability boundary. Map pins may be provided when the user asks for map/exact context, but the map must not be the whole answer and raw coordinate series must not be dumped. If no readable place name is known, say the latest GPS/status is available but Nava does not yet have a readable place name for that point; do not turn a Trip destination into a location proof. If the local operating day has just rolled over or only a thin post-midnight window exists, explain the new-day/overnight rollover and offer the previous day's route instead of reporting zero-duration movement metrics. Detailed movement/stationary blocks are shown only when the user explicitly asks for detailed timeline evidence; detailed route milestones should be readable prose/lists rather than arrow-chain logs, and unresolved marker locations should be summarized safely without raw coordinates. Individual provider idle marker rows should appear only for explicit raw-marker requests such as "show every idle marker." Do not show raw latitude/longitude in customer-facing Nava Eye location answers.

Nava Eye follows an Asymmetric Intelligence / Command Voice contract. The dark analytical layer resolves tenant context and current role capabilities first, fetches only role-safe company-scoped data, resolves places before text output, and runs calculations, timeline aggregation, chronology checks, idle continuity logic, and finance/billing math in TypeScript helpers instead of freeform prose. The presentation layer then gives concise operator-ready answers: direct operational statements, no raw provider payloads or telemetry dumps, no secrets/private driver fields/unreviewed asset telemetry, no default coordinate series, and no weak software-apology language such as "based on the data provided" or "available data does not prove." Default answers summarize; detailed evidence appears only when explicitly requested. High-confidence conclusions require evidence, active engine-on idling requires ignition/engine or equivalent support, and Nava Eye must not accuse drivers or recommend discipline/contact-driver by default.

Nava Eye deterministic answer paths use lightweight final answer-quality guardrails for known regression classes: generic limited-context fallback on entity-like prompts, third-person product self-reference in templates, raw coordinate pairs when coordinates were not requested, and unsupported engine-on idling confirmation when capability context does not prove ignition/engine evidence. These guardrails are not a permission system; role checks, company scoping, enabled-asset filtering, and deterministic helper calculations remain the source of truth.

Nava Eye business math uses deterministic helpers in `lib/intelligence/metricEngine.ts`. Profit, contribution per km, revenue per km, cost per km, moved-without-revenue, distance/mileage covered, distance status, and odometer reliability questions must be calculated or rejected by helper output, not freeform model guessing. The Phase 1 metric engine uses `provider_trip_summaries` for distance first, falls back to GPS-estimated distance from company-scoped enabled-asset `telemetry_logs` when trip summaries are missing, uses `fleet_assets.odometer_health` / `distance_quality` when available, and uses current finance tables (`journeys`, `fuel_logs`, `expenses`) only when records can be matched by company, truck text, date window, or `journey_id`. GPS-estimated distance is route-distance evidence and must not be called dashboard odometer mileage. Default metric answers should be concise: direct answer, source, caveat if needed, and one next action at most. Deterministic metric answers may store a short safe active-topic summary in Nava Eye conversation metadata, such as truck/fleet scope, metric intent, resolved date, distance value, distance source, provider summary count, telemetry point/segment counts, and filtered GPS-jump counts, so follow-ups like "was that today", "is that odometer mileage", or "how did you calculate that?" can answer the same metric without exposing raw coordinates, provider payloads, or secrets. Audit/detail mode is triggered only by questions such as "show evidence", "what data did you use", "how did you calculate that", or "why should I trust that"; it may show source hierarchy, record counts, filtered jumps/gaps, missing evidence, and confidence/provisional caveats. If distance, linked revenue, linked fuel/expense costs, or reliable trip/revenue linkage is missing, Nava Eye must say exactly what is missing instead of inventing profit. Ops roles may receive operational distance and odometer reliability context, but revenue, profit, contribution, rates, invoice, and moved-without-revenue checks remain finance/management/elevated only; expense-proof status may be shown to Trip-access roles without exposing restricted finance intelligence.

Operational Efficiency Intelligence Phase 1 lives in `lib/intelligence/operationalEfficiency.ts` and is intentionally deterministic. It summarizes company-scoped enabled assets using data Nava already has: provider trip summaries for provider-reported distance/motion duration, provider current-feed odometer/mileage deltas only when at least two sane points exist inside the selected period, `telemetry_logs` for GPS-estimated distance and moving/stopped intervals, `telemetry_events` for provider idle/excessive-idle marker windows, `fleet_assets.last_seen_at` for stale-location status, and `asset_driver_assignments` only as cautious standing-assignment context. Today, Yesterday, and 7-day ranges resolve in the company/operator timezone, default to Today, use start-inclusive/end-exclusive UTC query boundaries, cap open current-day data windows at the current server time, and expose selected-period/data-window labels in the UI so a Today view cannot silently show Yesterday data. Telemetry logs for movement rankings are fetched with explicit ordered pagination across the selected data window instead of a single globally limited batch; if a safety cap is reached, the response and UI must mark the telemetry source and affected rows as partial rather than silently ranking from the earliest page. Distance rows expose first/last telemetry point, points/segments used, selected period, coverage status, and cap warnings so Trucks Moved Most cannot look complete when only an early slice was analyzed. Every metric must carry an evidence label such as provider trip/report distance, provider current-feed odometer/mileage delta, GPS-estimated, provider-derived, unavailable, or not enough linked data. If provider current-feed mileage is detected but cannot form a safe period delta, the UI should say so and fall back to GPS-estimated distance rather than presenting provider distance as final. GPS-stopped time means the vehicle appears stationary from GPS/speed intervals and does not prove the engine is running. Provider idle markers are event markers supplied by the provider and depend on provider event quality; canonical `provider_idle_marker` rows are the new form, while legacy `excessive_idle` / `long_idle` rows are provider-derived only when their metadata does not mark them as GPS-generated/event-engine estimates. GPS-generated legacy idle rows remain GPS-stopped evidence. Provider idle marker count/window count is valid evidence, but provider/legacy `duration_minutes` may be cumulative, repeated, or accumulator-style; Nava uses observed marker windows by default and sums provider duration only when metadata verifies per-event semantics and the total passes selected-window sanity checks. True engine-on idle means engine/ignition/CAN confirms the engine is running while the vehicle is stationary. Stopped-time estimates must expose GPS point count, interval count, capped/large-gap status, and confidence so sparse provider pings do not look like exact idle proof. Provider idle markers and GPS-stopped intervals are not fuel-burn or driver-waste proof. Future provider timestamps are filtered before operational math: small clock skew is capped at now, while suspicious future rows are excluded from movement, stopped-time, provider idle-marker, freshness, and productivity calculations. Driver efficiency is available only as assignment-linked movement when assignment rows overlap the selected window; client waiting time remains deferred until GPS stops or provider idle markers can be linked safely to client geofences or journey legs. This layer powers `/api/ops/efficiency` and is designed to feed future Nava Eye answers and a future `/ops/efficiency` dashboard without adding fuel, profit, or external API assumptions.

Trip Intelligence Phase 1 lives in `lib/intelligence/tripIntelligence.ts`. The product object is Trip, while the current database table remains `journeys`. The helper deterministically projects each company-scoped non-demo journey into a business-readable Trip record: trip identity, matched asset/provider label, internal match key, enabled-intelligence status, driver evidence, movement evidence, delay/stopped evidence, stale-tracking evidence, finance evidence where the role allows it, profitability readiness, and management flags. `journeys.updated_at` is not required. Trip windows prefer `start_time` and `end_time` when present, then fall back to `created_at`; journey timestamps that come back without an offset are interpreted in the company/operator timezone rather than the server runtime timezone. Open active trips without an end time are capped to avoid overstating old open trips. New production Trip creation through `/ops/journey/new` and `POST /api/journeys` explicitly sets `is_demo = false`, saves same-company `driver_id` when selected, stores manual driver text in `journeys.driver` when no directory driver is selected, preserves optional `start_time` / `end_time`, and stores operational Trip fields without requiring fuel. Revenue, rate, billing quantity, and FX fields are controlled by finance/management/elevated visibility and must not be accepted from ops-only journey editors. The selected vehicle/provider asset name is always preserved as Trip `truck` text; `asset_id` is saved only when the current live FK accepts it, otherwise Trip Intelligence can still match the asset by provider label/truck text fallback. Demo journeys remain excluded from production Trip Intelligence. Movement uses provider trip summaries first, then GPS-estimated telemetry distance when safe; both are labeled and raw coordinates are never returned. Driver evidence prefers directory-linked journey drivers, treats `journeys.driver` without `driver_id` as `manual-driver-text` evidence, and only falls back to standing asset-driver assignments when the assignment overlaps the trip window. Finance evidence uses the latest `journey_revenue_entries` record when available, then falls back to the compatibility revenue snapshot on `journeys`; it also uses `fuel_allocations` assigned to the Trip and expenses linked by `journey_id`. If the revenue-entry migration is not applied yet, Trip Intelligence keeps working from the journey snapshot and reports the revenue-entry source as missing. If no fuel allocations exist for a journey, Trip Intelligence may use legacy `fuel_logs.journey_id` as a clearly labeled `legacy_journey_link` fallback; unallocated fuel is not counted as exact Trip cost. Expenses remain separate linked Trip costs and are not merged into fuel. Profitability readiness is `calculable` only when revenue and linked cost amounts are present, `partially_linked` when some finance or movement evidence exists but exact contribution is unsafe, and `not_enough_linked_data` when core links are missing. Fuel is not required as the only cost source, and no fuel burn, fuel theft, fuel efficiency, or profit conclusion is invented. `/api/ops/trip-intelligence` exposes this as a JSON foundation for future Nava Eye answers, `/ops/efficiency`, and management action dashboards. Trip Detail Phase 1 at `/ops/journey/[id]` is the practical completion surface: ops can complete driver/timing where permitted, finance can add revenue and linked expenses where permitted, and fuel-capable roles can allocate issued fuel to the Trip. The page must keep fuel allocation wording as allocation evidence, never actual burn or theft proof, and must show missing-data notes until Trip Intelligence can safely calculate contribution.

Live Tracking may attach lightweight active Trip context to each enabled asset row by matching the provider asset/truck label or linked `asset_id` against recent same-company, non-demo `journeys`. Only open/active/in-progress style statuses with no `end_time` are shown as active Trip context. Completed, offloaded, cancelled, closed, or ended journeys must not be displayed as active on live cards. If multiple active Trips match one truck, Live Tracking should show a review warning instead of silently choosing one. Route/client context explains the assigned Trip; it does not replace current location and does not prove delivery, offload, fuel use, revenue, or profit.

Customer-facing Trip Intelligence should not show the raw machine status `calculable` by itself. When revenue and at least one linked cost source such as a fuel allocation or trip expense exist, the UI label is "Contribution review ready." The contribution summary is linked revenue minus allocated fuel cost and linked trip expenses, surfaced as revenue, linked fuel cost, linked expense cost, linked variable cost, contribution, and contribution margin. Distance remains a separate evidence requirement for per-km metrics, so missing distance should appear as "Distance evidence missing" / "Distance-based metrics pending" rather than making basic contribution review sound impossible. If per-km contribution uses GPS-estimated distance, label it as "GPS-estimated contribution per km" and explain provider distance is still needed for final per-km review; provider-reported distance may use stronger "based on provider-reported distance" wording. If fuel allocation exists but no other trip expenses are linked, show "No additional trip expenses linked yet" as a supporting note, not as a blocker to linked revenue-minus-cost contribution review. Exact profit completeness still requires the remaining links to be reviewed; this is not final audited profit, fuel burn, fuel efficiency, or theft evidence.

Management Intelligence uses Trip Intelligence as its source of truth and ranks earning velocity, not only total contribution. `/management/dashboard` supports today, yesterday, 7-day, and 30-day periods. Review-ready contribution is linked revenue minus allocated fuel cost and linked Trip expenses. Trip duration prefers `start_time` to `end_time` for closed Trips and `start_time` to the dashboard generation time for active/open Trips; active/open cycle metrics are provisional. Contribution per active day is contribution divided by duration days, and estimated Trips/week potential is `7 / duration_days` when duration evidence exists. Client contribution velocity aggregates total contribution, average contribution/trip, average duration days, and average contribution/day across that client's reviewed Trips in the selected period. Delays are separated as client waiting, breakdown/mechanical, traffic/road, border/customs, driver, dispatch/company, or unknown. Operational drag may include GPS-stopped evidence, canonical provider idle markers, and qualifying legacy provider idle markers, but Management must not call those true idle, fuel burn, or driver waste unless engine-on/ignition/CAN/provider capability proves it. Client blame requires explicit client/customer waiting evidence; breakdown, road, border, driver, dispatch, and unknown delays are operational drag rather than client-caused conclusions.

Evidence Attachments Phase 1 lets same-company authenticated users with Trip access attach evidence to the record it directly proves from `/ops/journey/[id]`. General Trip evidence uses `relatedType=trip` for delivery notes, weighbridge tickets, invoices, and trip-level documents. Expense receipts, invoices, payment proof, M-Pesa proof, screenshots, and pasted payment/receipt text use `relatedType=expense` so they prove the exact linked expense/vendor/payment record. The Add trip expense form can create the expense first, then immediately attach uploaded proof and/or pasted proof text to the new expense; if proof upload fails after the expense is saved, the expense remains and the user can attach proof from the expense card. The forward evidence migrations also permit `fuel_log` and `fuel_allocation` for later fuel evidence, but Trip Detail UI defers those flows. Uploads are server-mediated through `/api/evidence`, validated against the company-scoped related record, limited to proof-safe images/PDFs up to 4MB or pasted text up to a short evidence-note limit, hashed server-side, stored in a private Supabase Storage bucket (`trip-evidence`) when a file exists, and listed with safe metadata plus short-lived signed URLs only. File hashes use SHA-256 over file bytes. Text proof hashes use trimmed, whitespace-collapsed, lower-case text so duplicate pasted messages are blocked even if spacing or case changes. Duplicate hashes for the same company, related type, and related record return a safe duplicate-proof message instead of inserting another attachment. For pre-hash legacy rows, uploads also check same-company related records with null `evidence_hash` by filename, MIME type, and file size for files, or normalized text for pasted proof, and return the same duplicate-proof message. Evidence lists collapse duplicate-looking legacy rows and prefer the hashed/newer row without deleting old audit rows; manual cleanup can be done later if a tenant wants permanent removal. Pasted M-Pesa or other payment text is stored as evidence text and is not parsed into amounts, dates, names, or transaction codes yet. Evidence files must not be public, storage paths and service keys must not be exposed to the browser, cross-company access must be blocked, and M-Pesa parsing remains deferred.

Expense evidence and general Trip evidence have different meanings. An expense receipt, invoice, payment proof, M-Pesa proof, or pasted payment text proves the specific linked expense/vendor/payment record, so supplier/vendor/payee, payment method, reference number, amount, and date should live on `expenses` wherever the current schema supports them and be shown before the attached evidence on Trip Detail. Trip Detail keeps expense proof under each expense row, lets proof be added during expense creation, summarizes linked expenses by type/category, and keeps delivery notes, weighbridge tickets, trip invoices, and other trip-level documents in General trip evidence. General Trip evidence supports trip movement, delivery, cargo, or tonnage context; it is not supplier-payment proof by itself. Contribution review uses all linked Trip expense records in addition to allocated fuel cost; grouped category totals are a review aid and do not replace individual expense rows or their proof. Do not build a full supplier model in Phase 1. Later supplier invoices/payments need structured supplier/vendor identity, invoice number, payment reference, credit terms, and settlement status.

Trip Detail and Trip creation must remain role-aware and audience-aware. Operational entry is for trip status, driver/timing, expenses, expense proof, and general trip documents. Finance/revenue is for revenue, rates, billing quantities, FX, and linked cost review. Management intelligence is for contribution summary, margin, readiness, and management flags. Users who can edit journeys may create Trips, create trip-linked expense records, and attach proof, but revenue, rates, billing quantity, FX, contribution, margin, linked variable cost totals, and management flags remain hidden unless the role has finance/management/elevated visibility. Fuel allocation litres can remain operational evidence for fuel-visible roles, but allocation costs on Trip Detail and fuel ledger APIs are finance-restricted. Client Rates / Revenue Rules Phase 1 moves the backend rate contract into Finance-owned `client_rate_rules` with client, separate route origin/destination fields, unit, effective date, rate, currency, and FX policy. Route direction matters; blank route fields are the client-wide/default rule. `/finance/revenue` is the Finance Revenue Review queue: it reviews Trip quantities, reports match status such as `unique_match`, `no_rule`, `multiple_matches`, `missing_quantity`, or `missing_fx`, and applies unique matched rules into `journey_revenue_entries` as `configured_rate`. Manual finance entry remains an override/correction path, not rate setup. Existing journey revenue columns remain compatibility snapshots until the UI fully migrates. Phase 1 FX remains manual, company-standard, or fixed-rate only; do not scrape Google or external FX sources.

Tenant examples in smoke tests are examples only, not reusable product copy or generic UI state. Customer-facing UI, prompt chips, placeholders, and empty states must not hardcode tenant names, truck plates, client names, driver names, routes, contribution amounts, or seeded pilot facts. Those values may appear only when they come from the authenticated same-company data being viewed. Finance-oriented Nava Eye prompt chips should appear only for finance/management/elevated visibility; generic operational prompt chips must stay tenant-neutral.

Nava Eye trip-performance questions such as "How did the KBJ132C Bamburi trip perform?", "Did the Bamburi trip make money?", "What was the contribution on KBJ132C Bamburi?", or "Is this trip ready for profit review?" must route to Trip Intelligence before live vehicle status. Matching should use internal trip reference, truck plus client text, truck plus route/destination text, or a clear recent trip for that truck. Exact trip reference wins; truck-plus-client, truck-plus-route, client-only, and truck-only matches may answer directly only when one production Trip matches the selected range. If multiple Trips match, Nava Eye must list safe candidates and ask the user to choose instead of falling back to live truck status or silently guessing. Finance-visible roles may see revenue, allocated fuel cost, linked expenses, contribution, margin, and per-tonne/per-km values where available. Roles without finance visibility should still receive a useful trip readiness answer with amount fields hidden: trip name, readiness label, revenue-present/fuel-allocation-linked/expense-linked status, missing distance or extra-expense caveats, and a finance-role boundary for contribution amounts.

Nava Eye query understanding lives in `lib/intelligence/queryUnderstanding.ts` and runs before source routing. It preserves the original user text, creates a normalized text form, records shorthand replacements, detects entity hints, periods, metric, intent family, follow-up status, and answer mode, then hands a structured intent to the conversation resolver and context router. It normalizes casual language such as `btwn` to between, `diff` to difference, `yday` to yesterday, `tdy` to today, `km/kms` to kilometers, and maps phrases like "how far", "gone", "covered", "stuck", "show proof", "made money", and "what should I do" into broad intent families instead of one-off route patches. It must not mutate vehicle plates, trip references, provider IDs, UUIDs, route text, or client names in ways that break entity matching. Structured intent families include distance, compare metric, explain previous answer, live status, idle/stopped evidence, Trip performance, expense evidence, finance revenue review, provider capability, management actions, and unknown. The parser itself does not fetch private data or authorize answers; the server-side role/company gates still run before any answer.

Nava Eye conversation resolution Phase 1 lives in `lib/intelligence/conversationResolver.ts` and uses database-backed `nava_eye_conversations.pending_followup`, not process memory. It resolves current-prompt truck/asset tokens before cached context, supports exact compact and unique-prefix asset matching, suggests close matches instead of silently choosing weak fuzzy matches, persists close-match clarification state, and reruns the original intent when the user confirms with "yes", "yeah", "correct", or "that truck". It inherits sensible active intents for "how about" / "what about" follow-ups, preserves fleet scope when explicitly requested, keeps distance/metric period follow-ups such as "what about yesterday?" or "what about yday?" on the prior metric instead of drifting into timeline mode, supports distance comparisons such as "difference in distance between yesterday and today" for the current truck/fleet subject, supports audit follow-ups such as "how did you calculate that?" or "why so low?", and can keep a recent Trip topic so expense/evidence follow-ups such as "which expenses on this trip are missing proof?" attach to the same production Trip. Phase 1 deliberately covers trucks/assets, fleet, metric result references, active Trip evidence/performance follow-ups, active intent, and timeframes only; broader driver/client/route/provider conversations remain incremental. Nava Eye's copilot route is a source-grounded internal orchestration layer in Phase 1; external LLM calls must stay disabled unless a future security-reviewed private model path explicitly opts in.

Nava Eye source-grounded domain routing now has lightweight deterministic branches for expense/evidence proof review, Finance Revenue Review summaries, Provider Vault capability summaries, provider idle-marker fleet questions, Trip Intelligence performance answers, live tracking status, and operational distance metrics. Each branch must enforce company scope and role/capability gates before returning data. Evidence answers may show safe attachment/proof counts and private-record status, but must not expose public URLs, raw storage paths, or files unless the secure signed-link route authorizes them. Provider capability answers use Provider Vault safe test summaries and must say detected/mapped/not detected; field detection alone is not proof of fuel burn, theft, diagnostics, or true engine-on idle.

Nava Eye must also speak according to the asset's telemetry capability. Providers send signals, Nava normalizes signals, and assets carry capability profiles. Capability values are `UNKNOWN`, `GPS_ONLY`, `GPS_WITH_IGNITION`, `CAN_BUS`, `FUEL_ROD`, and `HYBRID_CAN_AND_FUEL_ROD`. Manual/admin asset classification outranks provider declarations; provider declarations outrank weak auto-observed patterns. GPS-only assets can support movement/location/stop stories, but they must not support engine-on idling, fuel-burn, tank-volume, or theft conclusions. Zero RPM/fuel/tank values are placeholders unless the provider or asset capability confirms that signal is supported.

For narrow truck-specific compound prompts, Nava Eye may answer multiple ordered sub-questions in one response. Supported sub-intents are current location/status, current idle risk, movement timeline, and detailed timeline evidence. "Show detailed timeline" must not override earlier requested live-status or movement-summary sections. Each sub-answer still uses the same enabled-asset, company-scoped, role-aware contract, and detailed block evidence remains limited to the selected truck and requested timeframe.

Truck conversation threads maintain a safe active truck topic in short pending-follow-up metadata. If a follow-up omits the truck ID, such as "what are yesterday's movements?" or "show detailed timeline," Nava Eye should keep using the active truck unless the user explicitly asks for fleet/all-truck scope. A detailed timeline follow-up should inherit the active truck timeline's resolved timeframe/date window unless the new message explicitly says today or yesterday. A truck ID written in the current prompt always wins over cached truck or fleet context. If no active truck topic exists for an elliptical truck question, ask which truck to check. Relative dates such as today/yesterday must resolve once in the company/operator timezone and stay consistent between truck summary, truck detail, and fleet movement summary modes.

Nava Eye conversations are short investigation threads, not durable operational memory. A user can access their own conversations in companies where they have active access; platform owners can create/use conversations in an explicitly resolved company context. Role/capability checks must run on every copilot message, so old conversation context must not unlock finance, billing, provider, or tenant data that the current role cannot see. Closed conversations are read-only in the MVP and there is no admin transcript browser.

## 6. Multi-Tenancy Rules

- `company_users` is the access-control source.
- Active membership requires `is_active = true`.
- APIs must resolve a company before querying tenant data.
- Same-company role checks matter: a role in one company must not authorize mutation in another company.
- `platform_owner` can pass `companyId` on supported internal/admin APIs.
- Nava Eye conversations are company-scoped and user-owned by default. Do not expose one user's conversation transcript to other users or across tenants in the MVP.
- The Navabloomco company is the platform/operator workspace, not a customer fleet tenant. Platform owners using `/dashboard` in that workspace should see platform operations guidance and safe aggregate tenant stats, not an empty fleet dashboard.
- Durable platform/operator workspace identity should use `companies.company_type = platform_operator`. Normal customer tenants should use `company_type = customer`; test/demo companies may use `company_type = demo`.
- During transition, if `companies.company_type` is missing or absent on a row, dashboard/company selection falls back to the older normalized `slug` or `name` equals `navabloomco` heuristic for platform owners only. Do not remove this fallback until production data has been migrated.
- Admin pages that currently support platform-owner `?companyId=` tenant context include Asset Review, Provider Vault, and Company Settings.
- Non-platform users may only access companies where they have an active membership.
- Tenant data should be scoped by `company_id` before returning or mutating.
- Public client portal routes must remain token-scoped and must not expose internal company dashboards, provider payloads, driver private data, or unreviewed assets.
- Raw provider payloads are server-side diagnostics/storage only and must not be returned to normal browser UI.
- Production domains are part of deployment configuration, not tenant access control. `navastrat.co`, `www.navastrat.co`, `www.navabloomco.com`, `navabloomco.com`, and `nava-strat.vercel.app` may all serve the app during transition, but tenant authorization must still come from Supabase auth plus `company_users`.
- Supabase Auth redirect URLs must include every production domain that may start or complete an auth flow. Do not remove existing allowed URLs when adding `navastrat.co`.
- Production `NEXT_PUBLIC_SITE_URL` should be `https://navastrat.co` once Supabase Auth redirect URLs are configured for the product domain.
- Client visibility links should remain origin-aware and fall back to `NEXT_PUBLIC_SITE_URL`; do not hardcode `navastrat.co` into token link generation.

## 7. Provider Integration Model

Provider sync is implemented in `lib/providers/engine.ts` with normalization in `lib/providers/normalizeVehicle.ts`.

### Self-Serve Provider Onboarding

Provider Vault is moving from platform-developer configuration toward a guided SaaS onboarding flow:

1. Choose a public provider template, Custom API provider, or Request assisted setup.
2. For public templates, enter only the credential fields required by that template.
3. For Custom API provider, enter provider identity, safe auth method, fleet/current-location endpoint, row path, labeled field mappings, and business-language signal capability declaration. The API converts this structured form into provider config server-side.
4. Create the tenant provider connection as inactive.
5. Test the connection and review detected vehicles, observed signal capability, asset matches/unmatched rows, distance diagnostics, and setup blockers.
6. Explicitly activate sync after a successful test.

Customer owners/admins may create and manage provider connections for their own company. In Custom API setup, endpoint URL, row path, and field mapping are collected through guided fields instead of raw JSON templates. Supplemental auth profiles, advanced feed configuration, raw template internals, and internal setup-only templates remain advanced-only. Platform owners keep advanced visibility for provider setup and diagnostics. Ops, finance, and management users may view status where allowed but cannot create provider connections.

Customer-facing onboarding must not expose internal provider strategy, hardware roadmap, raw capability tiers, or setup-only engineering templates. Customer owners/admins should see public/supported providers, Custom API provider, and Request assisted setup. Platform-owner-only templates such as Meitrack planning examples, generic REST GPS, or generic CSV distance report backfill templates may exist for internal setup work but must be labeled internal/platform setup only.

Custom API provider setup supports safe auth options: no auth/public endpoint, API key header, bearer token, basic username/password, and POST login token where the current provider test infrastructure can authenticate and safely extract a token. The customer-facing Simple Connect surface should stay Google-simple: provider name, provider website/API link, email or username, password, optional API key/token, and a single Connect provider action. Nava then runs the guided setup checklist, attempts safe common patterns, detects vehicles, checks location fields, compares detected vehicles with existing assets, and creates the provider inactive for review. Progress states must be sequential and truthful: if sign-in fails, dependent vehicle, mapping, signal, and create steps are skipped instead of showing unrelated downstream errors. Technical auth method, token path, row path, endpoint candidates, token placement, field mapping, signal capability, and JSON/request body controls must stay hidden under collapsed Advanced troubleshooting. The wizard normalizes base API URLs, splits endpoint-specific values such as `/login` or `/get_devices` back to the provider API base, fills common login/fleet endpoint candidates, and auto-tests common token and vehicle-row patterns such as `user_api_hash`, bearer token, API-key header, and row arrays like `data`, `items`, `devices`, or `vehicles`. If provider notes or URLs look like a `user_api_hash` / `get_devices` API, the default surface should explain that the provider appears to use email/password sign-in that returns an access hash, while advanced troubleshooting can offer a one-click POST-login-token pattern instead of making a non-technical admin combine token paths manually. Customer-submitted request bodies must be JSON objects and must not contain credential-like keys; credentials belong in secure auth fields and are never echoed back to customers after save.

Saved provider connections use one provider connection contract across Simple Connect, Provider Vault Test Connection, Data Discovery Diagnostics, scheduled sync, and automated report/distance ingestion. The contract separates an auth channel from logical feeds: current vehicle feed rows go to `telemetry_logs`, while report/trip/distance feed rows go to `provider_trip_summaries`. The shared executor must perform login, extract configured token aliases such as `user_api_hash`, apply token placement, call the target feed, parse row paths, and return sanitized success/failure diagnostics without exposing tokens, passwords, cookies, auth configs, or raw payloads. Field mappings are always relative to the selected row path, not the full provider response: if the row path is `$.items`, the truck mapping is `name`, not `items.name`. Legacy prefixed mappings are normalized in memory for test/sync and cleaned when provider config is saved or a suggested row path is applied. High-stakes engine/fuel/tank mappings must not be inferred from vague identifier fields such as `inaccuracy` or `fuel_measurement_id`. FleetTrack-style providers may save `/get_devices` as the current vehicle feed and a `/get_reports` report-feed placeholder, but the report feed remains inactive until report parameters, row path, and distance mappings are configured. If Data Discovery finds a safer current-vehicle array path than the saved path, Provider Vault may apply that normalized row path and safe field-mapping suggestions through a narrow retest-required update that preserves credentials and keeps sync inactive until Test Connection succeeds again.

The setup-only Test Endpoint & Detect helper may be used during Custom API setup to inspect sanitized response structure and suggest token paths, row paths, and field mappings. It also powers the Auto-test setup flow, which tries common API patterns and stops at the first safe vehicle-row detection. It can chain a configured POST-login token into a fleet endpoint containing placeholders such as `{{user_api_hash}}` without showing the raw token. It is restricted to owner/admin/platform-owner roles, rejects localhost/private/link-local/metadata/internal targets, strips cookies/proxy headers, uses bounded timeouts and response-size limits, and returns only sanitized samples and path suggestions. It must never act as a raw response browser or store test responses.

Before a connection test, customer-facing capability language should stay business-oriented: vehicles detected, location tracking verified, engine data not verified, fuel/tank sensor not verified, matched assets, unmatched vehicles, and sync activation status. Raw values such as `GPS_ONLY`, `CAN_BUS`, `FUEL_ROD`, JSON mappings, endpoint URLs, token paths, and provider auth internals are not customer-facing onboarding copy.

Provider Vault cards should lead with a customer-ready status summary: connection status badge, last test badge, vehicles found, matched/unmatched trucks, live tracking verification, engine/fuel verification, report/distance feed status, and the next action. Test/sync counts should come from the latest safe provider test summary when available, with `last_test_message` parsing only as a legacy fallback. Matched truck counts must count distinct current provider rows that matched canonical assets and must never exceed vehicles found; impossible legacy counts fall back to `Review needed`. Inactive providers require a safe vehicle match review before activation, even when all rows are matched: the review may show provider vehicle label, matched canonical asset/truck ID, source/confidence, and match status, but no raw payloads or coordinates. Activation should require explicit review acknowledgement and a final confirmation for the vehicle mapping. Engine/fuel signals are verified only when supported signals and meaningful non-placeholder values prove ignition, engine, CAN, or tank telemetry. Report/distance feed is configured only when an active report feed has endpoint, row path, distance mapping, and concrete required parameters sufficient for provider trip summaries; placeholder report URLs are not configured. Provider API capability discovery belongs in Advanced diagnostics: it may show safe sampled field-name evidence for GPS, speed, provider idle markers, odometer/mileage, engine hours, ignition/engine state, fuel, driver, geofence/site, diagnostics/faults, event/status, PTO/auxiliary, safety, and HOS/duty status. Field-name discovery is not verification; it only tells setup/admin users what the current API response appears to expose or what may need a separate endpoint/permission. Metric placeholders should use plain status language such as `Not refreshed yet` or `Review needed`, not command labels such as `Run test`. Credential fields belong under a collapsed Manage credentials section, while technical panels such as provider connection contract, row paths, response shape, API capability discovery, data discovery, enrichment diagnostics, and CSV fallback/backfill import belong under a collapsed Advanced diagnostics section. Customer admins may expand safe diagnostics when allowed; platform owners retain deeper troubleshooting visibility. No secrets, tokens, raw payloads, cookies, passwords, raw values, or full coordinates may appear in either view.

New provider records must not start active by default, and provider sync must not run automatically just because a connection was created. CSV distance report import remains fallback/backfill, not the primary provider workflow.

### Primary Flow

1. Read an active `tracking_providers` record.
2. Authenticate with the provider using `auth_type` and configured credentials.
3. Fetch the primary fleet feed from `fleet_url` or `fleet_config.fleet_url`.
4. Normalize provider rows into canonical fields:
   - `truck_id`
   - `provider_label`
   - `attached_trailer_plate`
   - `latitude`
   - `longitude`
   - `speed`
   - `fuel_level`
   - `engine_rpm`
   - `engine_on`
   - `ignition_on`
   - `fuel_rate`
   - `lifetime_fuel_used`
   - `engine_hours`
   - `fuel_raw`
   - `fuel_volume_liters`
   - `telemetry_capability`
   - `signal_quality`
   - `provider_signal_flags`
   - `provider_reported_evidence`
   - `location_label`
   - `recorded_at`
5. Skip rows that do not have a safe vehicle identifier after mapped and fallback keys are checked. Provider sync must not create `UNKNOWN`, blank, or null reviewable assets.
   Provider labels may include both a truck plate and trailer text, for example `KCF529Z ZF3316`. The provider asset name remains the customer-facing Asset Review identity. Nava keeps the truck plate as an internal normalized match key for cross-provider matching and duplicate safety, and may store the trailer text only as label context. Attached trailers are operational metadata from the provider asset name and must not become primary billable intelligence assets unless trailer-specific tracking is explicitly introduced later.
   Asset Review is a current-state provider asset review page. Customer-facing rows and summary cards should show current provider assets as the provider identifies them, with provider source, review state, classification warnings, timestamp issues, and billing-safe enabled count. Raw provider records, canonical grouping internals, hidden legacy rows, and identity-collision diagnostics belong in platform diagnostics, not the primary customer review workflow. Possible match warnings should appear only for real current-state ambiguity requiring review. Obvious non-primary labels such as motorbikes, Probox/Hilux pickups, or raw IMEI/device identifiers stay reviewable under Needs classification but are kept out of likely-truck counts.
   Nava Eye follows the same identity model: provider asset names are first-class lookup aliases and customer-facing answer labels. A query for `KCF529Z ZF3316` should resolve to that provider asset name, while a query for `KCF529Z` may use the internal match key and explain the provider asset match where useful. A trailer-only query such as `ZF3316` must be treated as provider-label context, not independent trailer tracking. If the provider asset is present but not enabled for intelligence, Nava Eye should say it is present in Asset Review but must be enabled before live status can be answered.
   Nava Eye must not render blank provider location placeholders such as `near -` or `at -`; if no readable location label is available, say `location label unavailable` or omit the location phrase.
6. If the same provider has already imported the asset, upsert that provider-owned `fleet_assets` row by `(provider_id, truck_id)`.
7. If a different provider reports the same normalized registration/truck ID for an existing company asset, treat it as cross-provider telemetry for that asset and do not create a duplicate billable-review asset automatically.
8. Insert `telemetry_logs` with the incoming `provider_id`, normalized signal quality, timestamp quality, capability flags, and safe provider-reported evidence preserved. Current-feed provider evidence can include selected fields such as `total_distance`, `mileage`, `engine_hours`, `device_data.engine_hours`, `device_data.traccar.engine_on_at`, provider fuel fields, alarms, icon status, and device timezone. These are stored as labeled provider-reported evidence in JSON metadata such as `provider_signal_flags`, not as raw payload samples or customer-facing claims. Provider timestamps must be normalized and validated before use: Unix seconds/milliseconds should be interpreted safely when possible, while epoch/default dates, years before 2000, far-future dates, or dates that conflict with asset first-seen evidence must be marked invalid/suspect instead of being displayed as real last-seen telemetry. Asset Review should show `Last seen unavailable` or `Provider timestamp invalid` rather than 1970-style dates.
   Provider current-feed rows are also scanned for safe idle/excessive-idle marker values such as `idle`, `idling`, `excessive idle`, `prolonged idle`, and `stop idle` in event/status/alert-style fields. Detected provider markers are written to `telemetry_events` as canonical `provider_idle_marker` rows with company, provider, truck, timestamp, optional duration, safe marker label/source metadata, and explicit `engine_on_idling_confirmed = false` / `fuel_burn_confirmed = false` metadata. Generic GPS stop/stationary values are not promoted to provider idle markers. Existing legacy `excessive_idle` / `long_idle` rows remain usable as legacy provider-marker evidence only when metadata does not identify them as GPS-generated/event-engine stopped estimates.
9. Do not overwrite reviewed asset classification, billing, or intelligence enablement fields on sync.

### Second Provider Onboarding

Multiple active `tracking_providers` can exist for one tenant. During controlled onboarding of a second provider:

- Test connection first before enabling automated sync.
- Existing tenant assets should match by normalized registration/truck ID where possible.
- Cross-provider matches are reported in Provider Vault diagnostics and kept as telemetry evidence, not silently inserted as duplicate billable-review assets.
- Telemetry logs must retain the incoming `provider_id` so BlueTrax, Meitrack, CAN bus, tank sensor, and future feeds remain auditable.
- Verified richer capability declarations from a second provider may upgrade the canonical asset capability when they outrank the existing non-manual capability.
- Weak auto-observed signals and placeholder zeros must not silently upgrade high-stakes capability such as CAN bus or tank intelligence.
- Existing manual/admin-reviewed capability settings must not be downgraded or overwritten by provider sync.

### Provider Import Defaults

New provider assets default to:

- `asset_category = unknown`
- `billing_status = unreviewed`
- `intelligence_enabled = false`
- `first_seen_at = now`
- `status = active`

This is intentional. Provider assets must be reviewed before appearing as enabled intelligence vehicles.

### Supplemental Enrichment Feeds

`tracking_providers.fleet_config.supplemental_feeds` supports provider-agnostic enrichment feeds for data that is not present in the primary feed, such as fuel, distance summaries, odometer health, engine hours, temperature, battery voltage, or driver name.

Supported feed capabilities:

- `GET` or `POST`.
- JSON payloads.
- Recursive template macros.
- Vehicle row paths.
- Match keys.
- Explicit field mappings.
- Sanitized diagnostics.

Currently persisted enrichment is intentionally conservative. `fuel_level` is the main end-to-end stored point enrichment field. Provider trip/report-level distance fields should flow into `provider_trip_summaries` when the additive distance schema exists, not into every `telemetry_logs` row unless a provider truly sends point-level odometer/distance signals.

Provider-reported current-feed fields are evidence, not audited truth. FleetTrack/Oak-style current feeds may expose richer evidence such as `total_distance`, `engine_hours`, nested engine-hour, fuel quantity/price/rate, alarm, and icon status fields; BlueTrax-style current feeds may expose `mileage` and device timezone. Nava maps selected current-feed values into provider-reported evidence metadata so Operational Efficiency can prefer sane provider-reported distance/odometer deltas over GPS-estimated distance. Fuel issued/allocation remains the finance/control source of record; provider fuel fields do not create fuel-burn, theft, efficiency, or driver-misuse claims. Richer historical distance, idle, diagnostics, HOS, or safety evidence may still require provider report/event/history endpoints and permissions.

### Provider-Agnostic Distance Intelligence

Distance is its own evidence layer. Nava must track the source and reliability of distance data instead of assuming physical odometer values are true.

Separation rules:

- `telemetry_logs` are point-in-time telemetry pings.
- `provider_trip_summaries` are provider trip/report-level records such as start/end odometer, provider mileage, motion duration, start/end locations, and violations.
- `fleet_assets` carries current odometer health, distance source preference, virtual/manual odometer baseline, last distance update time, and distance quality metadata when the additive columns exist.
- Provider sync should ingest configured provider distance/report enrichment feeds automatically when a provider exposes trip/report data. CSV import is fallback/backfill only.
- Provider Vault can import provider distance report CSVs through a dry-run first workflow when automated provider API access is unavailable. Import writes matched rows into `provider_trip_summaries` only, never into `telemetry_logs`.

Distance detection rules:

- `odometer_delta_km = end_odometer_km - start_odometer_km`.
- If provider-reported mileage is meaningful while odometer delta is zero, mark odometer health as `static_zero` or `static_nonzero` depending on the odometer values.
- If odometer delta is negative, mark `rollover_suspected`.
- If odometer delta and provider-reported mileage disagree heavily, mark `mismatch`.
- Provider `Mileage` is provider-reported mileage unless provider docs confirm it is GPS-calculated.
- GPS-calculated distance from coordinate pings is a future fallback and should not be confused with provider-reported mileage.

Provider distance CSV import rules:

- CSV imports are company/provider scoped, require provider administration access, and are not the primary product workflow.
- Rows match `fleet_assets` by normalized `Vehicle`, `truck_id`, or registration.
- Dry-run must show rows parsed, matched assets, unmatched rows, static odometer counts, mismatch counts, and rows that would write.
- Commit/import must use server-side normalization and upsert by `provider_id + provider_trip_key` when available, with a stable generated key when the provider file has no trip key.
- CSV report fields such as `StartOdometer`, `EndOdometer`, `Mileage`, `MotionDuration`, `StartLocation`, `EndLocation`, and `Violations` are report summary evidence and must not be mixed into point telemetry.

Automated provider distance feed rules:

- Provider Vault advanced config may define report feeds through the saved `report_feed` contract, through `supplemental_feeds` with `feed_type`/`purpose` such as `distance_report`, `trip_summary`, or `fleet_current_status`, or through direct `distance_report_*`/`trip_summary_*` config fields.
- Required automated setup is endpoint URL, auth profile/token path when needed, row path/data group, match keys, and mappings for `truck`, `report_start_time`, `report_end_time`, `start_odometer`, `end_odometer`, `mileage`, `motion_duration`, `violations_count`, and `provider_trip_key` when available.
- Provider Test Connection should dry-run automated distance writes and show rows found, mapped distance fields, matched assets, rows that would write, and setup blockers.
- Scheduled/provider sync uses the same saved provider connection executor as Test Connection and may write matched automated distance summaries into `provider_trip_summaries`.

Nava Eye distance wording should follow the evidence:

- Broken/static odometer: "The dashboard odometer is not reliable for this asset. Distance should use provider-reported mileage or GPS-derived movement until the odometer is inspected."
- Valid odometer: "Physical odometer movement is consistent with provider mileage."
- Mismatch: "Distance signals disagree: the provider reported X km, while the odometer changed by Y km. Treat the dashboard odometer as suspect until inspected."

### Provider-Agnostic Telemetry Capability Model

Telemetry capability is the contract between hardware evidence and Nava Eye wording:

| Capability | Friendly Label | What It Proves |
| --- | --- | --- |
| `UNKNOWN` | Unknown Capability | Hardware capability is not classified yet. Location may be available, but engine and fuel conclusions are not verified. |
| `GPS_ONLY` | GPS Intelligence | GPS movement/location data only. Fuel burn and engine-on idling are not verified. |
| `GPS_WITH_IGNITION` | Ignition-Aware GPS | Ignition state can verify idle risk, but exact fuel burn is not measured. |
| `CAN_BUS` | Engine Intelligence | RPM/fuel-rate/lifetime-fuel/engine-hour signals can support engine-on idle and fuel-burn estimates. |
| `FUEL_ROD` | Tank Intelligence | Tank-volume changes can be evaluated, subject to calibration and signal quality. |
| `HYBRID_CAN_AND_FUEL_ROD` | Full Fuel Intelligence | Engine and tank signals can be cross-checked. |

Signal validation rules:

- Null, blank, and dash-like values mean unsupported.
- Zero is valid only when the provider or asset confirms that signal is supported.
- Repeated zero RPM/fuel on a moving asset should be treated as placeholder/unsupported unless verified.
- Provider field presence alone does not prove that a signal is meaningful.
- Observed signal patterns may suggest capability but must not silently upgrade high-stakes fuel/theft claims.
- BlueTrax/JLCL assets classify as `GPS_ONLY` unless real ignition, CAN, or tank signals are verified. BlueTrax dashboard zero fuel/RPM placeholders must not be treated as engine/fuel evidence.
- Meitrack and future hardware should plug in through provider adapter, field mapping, `supported_signals`, and normalized telemetry columns without provider-specific Nava Eye rewrites.

Provider Vault should separate provider declarations from observed row evidence:

- Provider default capability comes from `tracking_providers.capability_profile.default_capability` and may remain `UNKNOWN` during onboarding.
- Observed row capability comes from normalized test/sync rows and should be counted separately, for example `GPS Intelligence - 21 rows`.
- Supported engine/tank signals should show declared meaningful signals only, not field names that are present but unsupported.
- Placeholder zero signals should be reported as safe counts/key names and must not upgrade the asset or provider capability.
- Provider API capability discovery is a broader field-name scan of sampled current/supplemental rows. It can say, for example, `Provider idle marker fields detected`, `Odometer not detected`, or `Engine-on evidence not detected`, but it does not prove actual engine-on idle, fuel burn, diagnostics, or driver behavior. If fields are absent, the next action is to ask the provider for the relevant report/event/history endpoint or API permission rather than calling unknown endpoints blindly.
- Data Discovery Diagnostics may test configured provider endpoints and explicitly entered candidate report endpoints using saved credentials server-side. It reports only sanitized shape evidence: masked endpoint URL, auth method label, HTTP status, response type, top-level keys, candidate row paths, array counts, useful field names, and value-type sample shape. It must not write telemetry/trip summaries, activate sync, expose raw payloads, or display credentials/tokens.

BlueTrax/JLCL current state is GPS Intelligence: the primary feed supports location/speed/timestamp movement intelligence, while engine-on idling, exact fuel burn, tank volume, and fuel-theft conclusions remain unverified until ignition/CAN/tank signals are explicitly proven.

Meitrack onboarding uses a setup-only CAN Bus example template for field mapping and capability planning. It is not a live credential template. Expected normalized signals include location, speed, recorded time, ignition, RPM, fuel rate, lifetime fuel used, and engine hours where the specific Meitrack installation actually provides them.

### Supplemental Auth Profiles

`tracking_providers.fleet_config.supplemental_auth_profiles` allows a supplemental feed to use a different login flow than the primary fleet feed.

Key rules:

- Platform-owner-only advanced configuration.
- Tokens are captured for the current sync/test run only and are never persisted.
- Diagnostics may show status, key names, paths checked, macro names, and booleans.
- Diagnostics must never show tokens, cookies, passwords, Authorization values, raw auth responses, raw request bodies, or credential values.
- `username_override` lets a supplemental auth profile use a different login identifier than `tracking_providers.username`.

## 8. BlueTrax Current Status and Limitation

Current known BlueTrax state:

- Primary location endpoint works:
  - `https://public-api.bluetrax.co.ke/api/Public/fleet_current_location`
- Primary feed includes location-style fields such as:
  - alerts
  - course
  - timezone
  - fixtime
  - latitude
  - location
  - longitude
  - mileage
  - reg_no
  - speed
  - unit_id
- Primary feed does not include the Fleet Current Status `Current Fuel` column.
- Fleet Current Status/report exports may include trip-level distance evidence such as `StartOdometer`, `EndOdometer`, `Mileage`, `MotionDuration`, `StartLocation`, `EndLocation`, and `Violations`. These are provider report summaries, not per-ping telemetry fields.
- BlueTrax web UI Fleet Current Status uses:
  - `POST https://api.bluetrax.co.ke/rest/analytics/vehicle`
  - `reportType = FleetCurrentStatus`
  - row path `items`
  - fuel key `currentFuelLevel`
- That analytics endpoint appears to require BlueTrax web-session style auth, not the same public fleet API credential flow.

Nava has generic support for the needed shape:

- `supplemental_feeds`
- `supplemental_auth_profiles`
- `username_override`
- auth metadata macros such as `analytics_user_id`
- sanitized feed/auth/request/response diagnostics

Current limitation:

- BlueTrax current fuel will not ingest until the configured supplemental auth profile successfully captures the correct web analytics token or BlueTrax provides official report/API access for that endpoint.
- BlueTrax distance summaries should use provider-reported `Mileage` when odometer values are static or zero; do not treat `StartOdometer = 0` and `EndOdometer = 0` as proof that the truck did not move when `Mileage` is non-zero.
- Provider Vault Data Discovery Diagnostics can test the configured public fleet endpoint and any explicitly supplied BlueTrax report/trip endpoint candidate. If no additional report endpoint is configured, the correct setup blocker is to ask the provider for trip/report endpoint, auth method, token path, row path, and sample response.
- Do not paste browser cookies, session tokens, or Authorization values into config, chat, logs, or docs.
- Do not scrape the visual UI unless explicitly approved as a separate product/security decision.

## 9. Asset Review and Billing Readiness Rules

Asset Review is the gate between current provider assets and billable Nava intelligence vehicles.

For larger fleets, Asset Review should support batch triage instead of one-by-one scrolling: filters for current provider assets, pending review, enabled intelligence, excluded/disabled, timestamp review, light vehicles, trucks, and classification-needed assets; search by asset name/plate/provider/category/status; sortable views; select-all-visible; and bulk actions for enable, exclude, disable, review later, and category updates. Legacy import/collision rows may remain in the database for audit, but they should not be customer-facing review work once a newer current provider asset row exists. Bulk enabling must require confirmation, must block protected match-conflict rows, and must show the projected strict billable count and planning-only monthly estimate before applying. Do not auto-enable suggested classifications or duplicate/multi-provider assets without user confirmation.

### Billable Asset Rule

An asset is billable-ready only when all are true:

- `fleet_assets.status = active`
- `fleet_assets.billing_status = enabled`
- `fleet_assets.intelligence_enabled = true`
- `fleet_assets.billing_enabled_at is not null`

Do not count assets as billable merely because one of `billing_status = enabled` or `intelligence_enabled = true` is true.

Unreviewed/pending-review counts should only include active current provider assets with `billing_status = unreviewed` and `intelligence_enabled = false`. Excluded, disabled, inactive, hidden legacy rows, or already-enabled assets must not be treated as still needing review.

### Platform Tenant Billing Preview

`/admin/tenants` and `/admin/tenants/[companyId]` are internal platform-owner-only previews. They estimate pilot billing from strict billable assets but do not create invoices, billing events, Stripe records, or customer-facing billing artifacts.

Revenue preview uses:

- strict billable asset count
- `companies.asset_unit_price`
- `companies.billing_currency`

If `asset_unit_price` is missing or zero, the preview must show `Pricing not set` rather than inventing a price.

The preview may show safe provider status and telemetry freshness, but must not show provider credentials, tokens, auth configs, raw provider payloads, private driver data, or public client data.

### Manual Invoice Preview

`/admin/tenants/[companyId]/invoice-preview` is a platform-owner-only manual invoice preview for one tenant and billing period. It is not an invoice engine.

Invoice preview uses:

- strict billable asset count
- `companies.included_assets`
- `companies.asset_unit_price`
- `companies.billing_currency`
- selected billing period, defaulting to the current month

The estimated invoice total is:

`max(strict_billable_asset_count - included_assets, 0) * asset_unit_price`

If pricing is missing or zero, the preview must show a readiness warning and no monetary total. If strict billable count is zero, it must show a readiness warning. The preview must include the note: "Preview only. No invoice has been created."

The invoice preview GET endpoint must not create invoice rows, billing events, PDFs, exports, emails, Stripe records, payment statuses, or customer-facing billing artifacts. The UI's "Create Draft Invoice" action must use the invoice records API below, which recalculates totals server-side before inserting a draft record.

### Manual Invoice Records

`billing_invoices` stores the first internal invoice lifecycle records. These records are platform-owner-only and are created from server-side invoice preview math. The client must never send trusted totals.

Invoice record lifecycle:

- `draft`
- `sent`
- `paid`
- `void`

Allowed transitions:

- `draft -> sent`
- `sent -> paid`
- `draft -> void`
- `sent -> void`

Creating a draft invoice:

- recalculates strict billable assets on the server
- uses `companies.included_assets`
- uses `companies.asset_unit_price`
- uses `companies.billing_currency`
- prevents duplicate non-void invoices for the same company and billing period

Invoice records are still MVP internal records. They must not create Stripe charges, PDFs, emails, customer-facing billing artifacts, or payment collection behavior.

Platform Health must verify the `billing_invoices` table before pilot invoice operations. Required readiness checks include all invoice columns, the named billing invoice indexes, and a status constraint that limits records to `draft`, `sent`, `paid`, and `void`. If Supabase does not expose metadata schemas to the health endpoint, index/constraint/RPC checks are grouped into one manual-verification warning instead of one warning per object. Invoice APIs and UI should degrade to a setup-required message if the table or required columns have not been applied yet.

### Pilot Readiness Checklist

`/admin/pilot-readiness` and `/admin/pilot-readiness/[companyId]` are platform-owner-only go-live checklists. They combine existing tenant, provider, asset review, billing, role, operations, and Nava Eye signals into a clear status:

- `ready`: no failed checks and no warnings
- `needs_attention`: no failed checks, but at least one warning
- `blocked`: at least one failed check

Readiness categories:

- Company setup: company record, name/slug, operating context, billing currency, and asset unit price.
- Provider setup: active provider, test/sync history, and recent sync freshness.
- Asset review: current provider assets, enabled intelligence assets, strict billable assets, pending-review assets, and provider-assets-not-enabled warnings.
- Billing readiness: `billing_invoices` availability, invoice preview possibility, pricing, strict billable assets, and recent invoice records.
- Role/security readiness: active owner/admin/platform-owner membership and role counts only.
- Operations readiness: enabled assets, drivers, geofences, journeys, and saved routes.
- Nava Eye readiness: enabled intelligence context, company AI settings count, and memory count.

Pilot readiness routes are read-only. They must not create invoices, mutate setup data, expose provider secrets, expose raw payloads, expose private driver data, or reveal Nava Eye memory internals beyond safe counts.

The manual pre-pilot/demo smoke test checklist lives in `docs/PILOT_SMOKE_TEST.md`. Use it before pilot, demo, or go-live checks, and batch any discovered bug fixes into one focused patch prompt unless a single issue blocks testing.

### Enable Asset

Enabling an asset should:

- require a non-`unknown` `asset_category`
- set `billing_status = enabled`
- set `intelligence_enabled = true`
- set `reviewed_at = now`
- set `reviewed_by = user.id`
- set `billing_enabled_at = existing billing_enabled_at OR now`
- set `billing_disabled_at = null`
- clear `excluded_reason`

### Disable or Exclude Asset

Disabling or excluding should:

- set `intelligence_enabled = false`
- set `billing_status = disabled` or `excluded`
- set `billing_disabled_at = now` when currently enabled/billable or when empty
- keep `billing_enabled_at` as historical first-enable trace
- set `excluded_reason` for excluded assets

### Review Later

Review later should:

- set `billing_status = unreviewed`
- set `intelligence_enabled = false`
- set `billing_disabled_at = now` when it was enabled/billable
- keep `billing_enabled_at` as historical trace
- follow current code intent for `excluded_reason`; at present this action clears it

### Intelligence Visibility

- Live tracking, ops dashboard, Nava Eye, enabled vehicle pickers, and client-visible live context should only use reviewed/enabled intelligence assets unless a route is explicitly an admin review route.
- Pending-review provider assets may be visible in Asset Review and platform/admin diagnostics, but must not become live/intelligence/client-visible assets automatically.

## 10. Known "Do Not Break" Rules

- Do not hardcode customer emails, company IDs, truck IDs, or provider IDs for permissions.
- Do not use old `SUPER_ADMIN` or contact-email permission gates.
- Do not weaken `company_users` role semantics.
- Do not expose provider credentials, cookies, tokens, Authorization headers, API keys, passwords, or raw provider payloads.
- Do not expose disabled or unreviewed asset telemetry/location outside admin review/diagnostics.
- Do not auto-enable provider assets.
- Do not let provider sync overwrite reviewed asset category, billing status, intelligence enablement, or billing timestamps.
- Do not expose driver phone, license, notes, or employee code in Nava Eye or public/client routes.
- Do not expose financial values to plain ops users.
- Do not let Nava Eye or Nava Eye Watch expose data outside the current user role's same-company capability boundary.
- Do not suppress, delete, or mutate telemetry alerts unless the route explicitly does so. Shared disruption context annotation only adds context fields.
- Do not remove geofencing. Geofencing is core Nava Strat functionality.
- Do not require inventory, serial numbers, or catalog parts before recording spare usage.
- Do not make accusations in Nava Eye. Use evidence-based wording such as "I cannot confirm" and "what to verify next."
- Do not treat `fuel_level > 100` as invalid by default. Provider fuel readings may be litres or provider units, not percent.
- Do not display fuel as `%` unless the unit is known to be percent.
- Do not call external news/weather APIs for disruption context.
- Do not hard delete operational records in MVP workflows where archive/disable/end is available.
- Do not add schema migrations silently from app code.
- Do not treat platform tenant billing preview as invoicing. It is internal readiness/math only until a real billing engine exists.
- Do not show the platform/operator workspace as an empty customer fleet dashboard. Platform-owner operator context should guide users toward platform operations, tenant billing, readiness, health, provider requests, and provider diagnostics.
- Do not treat manual invoice records as external billing. They are internal lifecycle records only until a real billing engine is designed.
- Do not let invoice record pages crash when the additive `billing_invoices` SQL has not been applied; show setup-required guidance instead.
- Do not let pilot readiness mutate tenant setup or expose secrets; it is a platform-owner-only checklist built from safe counts and summaries.
- Do not let analytics event recording break a primary user workflow. Analytics metadata must be sanitized and must not contain provider secrets, raw payloads, tokens, cookies, passwords, driver private data, or full Nava Eye prompt/answer text.
- Do not remove `navabloomco.com` or `nava-strat.vercel.app` support when enabling `navastrat.co`.
- Do not edit real environment files with domain changes that could affect production secrets. Configure product-domain values in Vercel/Supabase dashboards.
- Do not use generic old Vercel DNS defaults for `navastrat.co`; use the exact Vercel Project Settings -> Domains DNS values shown for the domain.

## 11. Recent Important Commits/Features

### Supplemental Provider Auth Profiles

Provider enrichment feeds can use named auth profiles in `fleet_config.supplemental_auth_profiles`. A feed can specify `auth_profile`, authenticate lazily, use that token only for the current test/sync run, and expose only sanitized diagnostics.

This enables providers where primary location data and analytics/report data use different auth sessions.

### `username_override`

Supplemental auth profiles support `username_override` so a report/login feed can use a different username/email than the primary provider sync.

This is important for providers such as BlueTrax where:

- the public API username may be a short API account name
- the web analytics login may require an email address

The override is redacted in provider responses and diagnostics.

### `roleAccess` Helper

`lib/api/roleAccess.ts` centralizes role normalization and key workflow capabilities:

- finance view/edit
- journey view/edit
- fuel view/edit
- expense view/edit
- same-company role extraction

Use this helper for new active APIs instead of reimplementing broad "any active user" checks.

### Sanitized API Response Fields

Active APIs have been moving away from broad `select("*")` and broad full-row returns.

Rules for new/updated APIs:

- select explicit fields
- return only UI-needed fields
- hide raw payloads and credentials
- hide finance fields from roles that should not see them
- keep company scoping strict

### Strict Billable Asset Count

Asset Review now distinguishes:

- imported assets
- unreviewed assets
- enabled intelligence assets
- strict billable enabled assets

Strict billable count requires:

- active asset
- enabled billing status
- intelligence enabled
- non-null billing enabled timestamp

This prepares the product for per-enabled-vehicle billing without building the full invoicing engine yet.

### Platform Tenant Billing Preview

Platform owners now have `/admin/tenants` and `/admin/tenants/[companyId]` to review tenant readiness, provider presence, active member counts, imported assets, strict billable assets, pricing setup, telemetry freshness, and estimated monthly revenue.

The preview is platform-only and deliberately excludes provider secrets, raw payloads, private driver data, and invoice/Stripe behavior.

### Manual Invoice Preview

Platform owners now have `/admin/tenants/[companyId]/invoice-preview` and `GET /api/admin/tenants/[companyId]/invoice-preview` to preview a tenant's monthly invoice math from strict billable assets, included asset allowance, and company pricing fields.

The preview is read-only and deliberately excludes invoice creation, PDFs, email sending, Stripe/payment status, provider secrets, raw payloads, and private driver data.

### Manual Invoice Records

Platform owners now have `GET/POST /api/admin/tenants/[companyId]/invoices` and `PATCH /api/admin/tenants/[companyId]/invoices/[invoiceId]` for simple invoice record lifecycle tracking.

Draft invoices are created from server-side preview calculations only. The lifecycle is `draft -> sent -> paid` or `draft/sent -> void`. The tenant detail page lists recent invoices and can update status. No Stripe, PDF, email, payment collection, amount editing, or customer-facing invoice portal exists yet.

Platform Health checks `billing_invoices` columns, expected invoice indexes, and the invoice status constraint. If Supabase metadata schemas are not accessible from the API context, metadata checks are grouped into one manual-verification warning while table/column checks continue normally. Invoice APIs return setup-required guidance when the table or required columns are missing instead of exposing a generic server crash.

### Pilot Readiness Checklist

Platform owners now have `/admin/pilot-readiness`, `/admin/pilot-readiness/[companyId]`, `GET /api/admin/pilot-readiness`, and `GET /api/admin/pilot-readiness/[companyId]`.

The checklist returns pass/warning/fail checks grouped by company setup, provider setup, asset review, billing readiness, role/security readiness, operations readiness, and Nava Eye readiness. It is read-only and uses safe counts/summaries only.

### Platform Workspace Dashboard Mode

When a platform owner selects the Navabloomco platform/operator workspace and opens `/dashboard`, the dashboard returns `dashboard_mode = platform_operator` and shows a platform workspace home instead of fleet metrics.

Platform workspace detection now prefers `companies.company_type = platform_operator`. The Navabloomco slug/name heuristic exists only as a migration fallback while older environments are missing `company_type`.

The platform workspace dashboard shows:

- customer tenant count
- strict billable assets across customer tenants
- estimated monthly revenue by currency where pricing exists
- pilot readiness blocked / needs-attention counts
- grouped action cards for Platform Operations, Tenant Operations, and Product Intelligence
- sanitized customer workspace cards with tenant name/slug, readiness status, strict billable count, provider counts, and links to the fleet dashboard/readiness detail
- a local presentation-only hide/show sensitive metrics toggle that masks selected KPI values without changing API authorization or data

It must not aggregate or expose raw cross-tenant telemetry, provider secrets, auth configs, raw payloads, or private driver data. Customer tenant selection keeps the normal fleet dashboard behavior.

### Analytics Events Phase 1

Nava Strat now has a server-only helper at `lib/api/analyticsEvents.ts` for privacy-safe internal product analytics. The helper records to `analytics_events` on a best-effort basis and never blocks the user workflow if the table is missing or an insert fails.

Phase 1 instruments only high-value server-side events:

- `provider_test_success`
- `provider_test_failed`
- `first_asset_enabled`
- `asset_enabled`
- `draft_invoice_created`
- `invoice_marked_sent`
- `invoice_marked_paid`
- `invoice_voided`
- `nava_eye_conversation_created`
- `nava_eye_conversation_closed`
- `nava_eye_question_asked`
- `nava_eye_permission_boundary_shown`

Analytics metadata is sanitized before insert. It must not store provider credentials, auth config, tokens, cookies, passwords, raw provider payloads, private driver fields, or full Nava Eye prompt/answer text. There is no client-side tracking, third-party analytics vendor, or user-facing analytics dashboard yet.
