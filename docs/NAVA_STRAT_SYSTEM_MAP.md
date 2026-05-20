# Nava Strat System Map

Last updated: 2026-05-20

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
| `/nava-eye` | Nava Eye assistant UI. |
| `/tracking/live` | Live tracking view for enabled intelligence assets. |
| `/tracking/link` | Tracking link helper page. |
| `/tracking/processor` | Tracking processing/admin helper page. |
| `/tracking/providers` | Older provider-facing tracking route. Provider Vault is the current admin route. |

### Operations Routes

| Route | Purpose |
| --- | --- |
| `/ops/dashboard` | Operations command center: active journeys, enabled assets, alerts, shared disruption context, geofences, and assigned drivers. |
| `/ops/journey` | Journey list with create CTA and journey cards/table. |
| `/ops/journey/new` | Create journey form with saved route picker, enabled vehicle picker, and driver picker. |
| `/ops/journey/templates` | Saved Routes management for route presets. |
| `/ops/drivers` | Driver directory and current vehicle assignments. |
| `/geofences` | Company-scoped geofence list and archive/manage UI. |
| `/geofences/new` | Create geofence form. |

### Finance and Cost Routes

| Route | Purpose |
| --- | --- |
| `/finance/dashboard` | Role-aware Finance Hub linking to safe finance workflows. |
| `/finance/revenue` | Revenue management and rate/quantity workflow. |
| `/fuel` | Fuel ledger. |
| `/fuel/new` | Fuel entry form with JourneyPicker. |
| `/fuel/providers` | Company-scoped fuel provider management. |
| `/expenses` | Expense ledger. |
| `/expenses/new` | Expense entry form with JourneyPicker. |
| `/management/dashboard` | Management dashboard. |

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
| `/admin/assets` | Asset Review for imported provider assets and intelligence/billing readiness. Supports platform-owner `?companyId=` tenant context. |
| `/admin/providers` | Provider Vault for tracking provider configuration, testing, sync diagnostics, and enrichment diagnostics. Supports platform-owner `?companyId=` tenant context. |
| `/admin/providers/new` | Add provider page. |
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
| `GET/POST /api/providers` | Provider Vault list/create. Supports platform-owner `companyId` context. Sanitizes provider credentials in responses. |
| `GET/PATCH /api/providers/[id]` | Provider detail/update. Supports platform-owner `companyId` context for safe tenant-scoped updates. Platform-owner-only advanced fleet config including supplemental feeds and auth profiles. |
| `POST /api/providers/[id]/test` | Tests provider sync in the resolved tenant context and returns sanitized diagnostics. |
| `GET /api/providers/templates` | Provider templates. |
| `GET/POST /api/providers/setup-requests` | Provider setup request list/create. |
| `PATCH /api/providers/setup-requests/[id]` | Provider setup request status management. |
| `POST /api/sync/providers` | Cron/provider automation sync. Requires `Authorization: Bearer <CRON_SECRET>`. |
| `GET /api/tracking/live` | Role-gated live enabled-asset tracking response with geofence labels. Requires operations visibility. |
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
| `PATCH /api/fleet-assets/[id]` | Enable, exclude, disable, or review-later an imported asset in the resolved tenant context. |
| `POST /api/fleet-assets/suggest-classification` | Asset classification suggestion endpoint using resolved company operating context as weak signal. |

### Operations

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/journeys` | Company-scoped journey list/create with role-gated finance fields. |
| `GET/POST /api/journey-templates` | Saved Routes list/create. |
| `PATCH /api/journey-templates/[id]` | Saved Route update/disable. |
| `GET /api/ops/dashboard` | Role-gated ops dashboard data, alerts, shared disruption candidate, geofence context, and assigned drivers. Requires operations visibility. |
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
| `GET/PATCH /api/finance/revenue` | Revenue/rates/quantity workflow. Finance visibility/edit gates apply. |
| `GET/POST /api/fuel` | Fuel ledger and fuel entry. Role-gated, company-scoped, explicit safe fields. |
| `GET/POST /api/fuel/providers` | Company-scoped fuel provider settings. |
| `PATCH /api/fuel/providers/[id]` | Fuel provider update/disable. No hard delete. |
| `GET/POST /api/expenses` | Expense ledger and creation. Finance role gates apply. |
| `GET /api/management/dashboard` | Role-gated management dashboard data. Requires finance/management/elevated visibility. |

### Spares and Maintenance

| API Route | Purpose |
| --- | --- |
| `GET/POST /api/spares/usage` | Company-scoped spare lifecycle event ledger. No inventory mutation. |
| `GET/POST /api/spares/parts` | Lightweight parts catalog. No stock counts or serial tracking. |
| `PATCH /api/spares/parts/[id]` | Parts catalog update/disable. No hard delete. |

### Nava Eye

| API Route | Purpose |
| --- | --- |
| `POST /api/nava-eye/copilot` | Main Nava Eye assistant route. Uses context router, entity resolver, role-aware context, safe dashboard page context, deterministic fallbacks, and AI provider when configured. |
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
| `billing_invoices` | Platform-owner-created manual invoice records for tenant billing lifecycle tracking. Draft/sent/paid/void only; no Stripe/PDF/email. |
| `analytics_events` | Privacy-safe internal product/activation analytics events. Best-effort only; no third-party analytics, no raw prompts/answers, and no secrets/raw provider payloads. |

`companies.main_billing_unit` is a default billing/work measurement for operating context, not Nava Strat subscription billing and not a fixed rule for every customer job. Actual commercial billing can vary by client, route, journey, cargo, or revenue entry.

### Provider and Telemetry

| Table | Used For |
| --- | --- |
| `tracking_providers` | Provider credentials/config, auth type, fleet URL, field mapping, fleet config, sync status, and test diagnostics. |
| `provider_setup_requests` | Assisted provider onboarding requests. |
| `provider_templates` | Reusable provider setup templates. |
| `fleet_assets` | Imported provider assets, latest asset state, review status, intelligence enablement, and billing readiness. |
| `telemetry_logs` | Historical telemetry points from provider sync: location, speed, fuel level, provider location label, validation, and raw payload server-side. |
| `telemetry_events` | Derived operational events and alert context annotations. |
| `location_cache` | Reverse-geocoded location cache. |
| `fuel_risk_scores` | Fuel risk scoring output from fuel risk engine. |

### Operations

| Table | Used For |
| --- | --- |
| `journeys` | Operational trips, client/route/truck/driver text, fuel estimate, status, and finance/revenue fields. |
| `journey_templates` | Saved Routes for faster journey creation. |
| `geofences` | Company-scoped saved places: depots, yards, ports, customer sites, loading/offloading zones, border points, risk zones, service areas, and other. |
| `drivers` | Company driver directory. License fields are not exposed broadly. |
| `asset_driver_assignments` | Standing driver-to-asset responsibility windows until ended. |

### Finance and Cost

| Table | Used For |
| --- | --- |
| `fuel_logs` | Manual fuel entries linked to journeys when available. |
| `fuel_providers` | Fuel vendor/default price settings. |
| `truck_route_fuel_profiles` | Route/truck fuel profile averages for operational fuel expectations. |
| `expenses` | Expense ledger records linked to journeys when available. |

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

## 6. Multi-Tenancy Rules

- `company_users` is the access-control source.
- Active membership requires `is_active = true`.
- APIs must resolve a company before querying tenant data.
- Same-company role checks matter: a role in one company must not authorize mutation in another company.
- `platform_owner` can pass `companyId` on supported internal/admin APIs.
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

### Primary Flow

1. Read an active `tracking_providers` record.
2. Authenticate with the provider using `auth_type` and configured credentials.
3. Fetch the primary fleet feed from `fleet_url` or `fleet_config.fleet_url`.
4. Normalize provider rows into canonical fields:
   - `truck_id`
   - `latitude`
   - `longitude`
   - `speed`
   - `fuel_level`
   - `location_label`
   - `recorded_at`
5. Upsert `fleet_assets` by `(provider_id, truck_id)`.
6. Insert `telemetry_logs`.
7. Do not overwrite reviewed asset classification, billing, or intelligence enablement fields on sync.

### Provider Import Defaults

New imported assets default to:

- `asset_category = unknown`
- `billing_status = unreviewed`
- `intelligence_enabled = false`
- `first_seen_at = now`
- `status = active`

This is intentional. Imported provider assets must be reviewed before appearing as enabled intelligence vehicles.

### Supplemental Enrichment Feeds

`tracking_providers.fleet_config.supplemental_feeds` supports provider-agnostic enrichment feeds for data that is not present in the primary feed, such as fuel, odometer, engine hours, temperature, battery voltage, or driver name.

Supported feed capabilities:

- `GET` or `POST`.
- JSON payloads.
- Recursive template macros.
- Vehicle row paths.
- Match keys.
- Explicit field mappings.
- Sanitized diagnostics.

Currently persisted enrichment is intentionally conservative. `fuel_level` is the main end-to-end stored enrichment field. Other mapped fields may be diagnosed or merged internally only where code supports them.

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
- Do not paste browser cookies, session tokens, or Authorization values into config, chat, logs, or docs.
- Do not scrape the visual UI unless explicitly approved as a separate product/security decision.

## 9. Asset Review and Billing Readiness Rules

Asset Review is the gate between imported provider devices and billable Nava intelligence vehicles.

### Billable Asset Rule

An asset is billable-ready only when all are true:

- `fleet_assets.status = active`
- `fleet_assets.billing_status = enabled`
- `fleet_assets.intelligence_enabled = true`
- `fleet_assets.billing_enabled_at is not null`

Do not count assets as billable merely because one of `billing_status = enabled` or `intelligence_enabled = true` is true.

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
- Asset review: imported assets, enabled intelligence assets, strict billable assets, unreviewed assets, and imported-but-not-enabled warnings.
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
- Imported unreviewed assets may be visible in Asset Review and platform/admin diagnostics, but must not become live/intelligence/client-visible assets automatically.

## 10. Known "Do Not Break" Rules

- Do not hardcode customer emails, company IDs, truck IDs, or provider IDs for permissions.
- Do not use old `SUPER_ADMIN` or contact-email permission gates.
- Do not weaken `company_users` role semantics.
- Do not expose provider credentials, cookies, tokens, Authorization headers, API keys, passwords, or raw provider payloads.
- Do not expose disabled or unreviewed asset telemetry/location outside admin review/diagnostics.
- Do not auto-enable imported assets.
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
- `nava_eye_question_asked`
- `nava_eye_permission_boundary_shown`

Analytics metadata is sanitized before insert. It must not store provider credentials, auth config, tokens, cookies, passwords, raw provider payloads, private driver fields, or full Nava Eye prompt/answer text. There is no client-side tracking, third-party analytics vendor, or user-facing analytics dashboard yet.
