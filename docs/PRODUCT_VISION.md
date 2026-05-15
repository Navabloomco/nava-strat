Nava Strat / Nava Eye — Full Product Vision

Nava Strat is a multi-tenant fleet intelligence SaaS platform designed to become the operational brain of transport and logistics companies.

It is not just a GPS tracking dashboard.

The long-term vision is to create an enterprise-grade operating system for fleet businesses across Africa and eventually globally — combining live telemetry, finance, operational intelligence, maintenance, fuel analytics, AI copilots, and executive decision support into one unified platform.

At the center of the platform is Nava Eye:
an intelligence layer that continuously watches fleet behavior, operational patterns, financial activity, maintenance trends, journeys, drivers, and fuel consumption to generate insights, risks, recommendations, and automation.

CORE PRODUCT GOAL

The platform should allow:

* transport companies
* logistics operators
* cement distributors
* fuel haulers
* construction fleets
* FMCG transporters
* enterprise trucking operations

to run their entire business from one system.

The platform must scale to:

* 10,000+ trucks
* multiple countries
* multiple tracking providers
* many companies simultaneously
* real-time telemetry ingestion
* AI-assisted operations

without collapsing architecturally.

MULTI-TENANT SAAS ARCHITECTURE

Nava Strat is designed as a true SaaS platform.

Every company:

* has isolated data
* separate users
* separate AI context
* separate dashboards
* separate telemetry
* separate memories
* separate operational intelligence

Core tenancy model:

* companies
* company_users
* company_id everywhere

No client-specific hardcoding.

The platform owner (Navabloomco) has:

* platform_owner role
* ability to switch between companies
* management oversight
* operational visibility across tenants
* SaaS-level administration tools

SELF-ONBOARDING SYSTEM

A major differentiator is self-onboarding.

Goal:
Any fleet company globally should be able to:

1. Sign up
2. Create company
3. Connect tracking provider
4. Map fields automatically
5. Begin ingesting telemetry
6. Start receiving Nava Eye intelligence

without engineering intervention.

The system should support:

* BlueTrax
* Wialon
* FleetComplete
* Gurtam
* custom GPS APIs
* any provider with API access

through:

* provider templates
* authentication adapters
* field mapping
* normalization pipelines

TELEMETRY & TRACKING ENGINE

The telemetry system ingests:

* GPS positions
* speed
* fuel levels
* ignition
* odometer
* engine status
* timestamps
* raw provider payloads

Pipeline:
tracking_providers
→ sync engine
→ fleet_assets
→ telemetry_logs
→ telemetry_events
→ Nava Eye intelligence

Key tables:

* fleet_assets
* telemetry_logs
* telemetry_events

The platform stores:

* latest truck state
* historical movement
* operational events
* anomalies
* AI memory

NAVA EYE INTELLIGENCE LAYER

Nava Eye is the strategic differentiator.

It is designed to behave like:

* an operations analyst
* fleet controller
* finance auditor
* fuel investigator
* maintenance strategist
* risk detection system
* AI fleet copilot

Nava Eye analyzes:

* telemetry
* journeys
* fuel behavior
* idle behavior
* route patterns
* geofences
* maintenance trends
* spare consumption
* driver performance
* finance
* expenses
* profitability
* operational anomalies

Examples:

* fuel theft suspicion
* excessive idle
* route inefficiency
* recurring truck breakdown patterns
* underperforming routes
* risky drivers
* suspicious expense behavior
* tyre abuse
* maintenance prediction
* downtime forecasting

Nava Eye creates:

* telemetry_events
* memories
* recommendations
* operational alerts
* executive summaries

AI MEMORY SYSTEM

The memory engine stores recurring operational intelligence.

Examples:

* “Truck KCW 603E repeatedly experiences fuel drops while stationary.”
* “Driver X consistently exceeds idle thresholds.”
* “Route Nairobi–Kampala shows abnormal fuel variance.”

Stored in:

* nava_eye_memory

Purpose:
Nava Eye should remember patterns over time instead of reacting only to single events.

DASHBOARD STRUCTURE

1. Operations Dashboard
    Used by:

* dispatch
* controllers
* fleet supervisors

Includes:

* live fleet map
* truck status
* journeys
* geofences
* alerts
* idle
* fuel events
* driver monitoring

2. Finance Dashboard
    Used by:

* accountants
* finance teams
* management

Includes:

* trip profitability
* fuel costs
* expenses
* invoicing
* revenue analysis
* route margin analysis
* operational cost tracking

3. Management / CEO Dashboard
    Used by:

* executives
* owners
* directors

Includes:

* fleet utilization
* profitability
* operational health
* risk scoring
* growth analytics
* downtime
* performance summaries
* AI executive insights

4. Nava Eye Dashboard
    AI-focused operational intelligence center.

Includes:

* memories
* anomalies
* risk rankings
* event intelligence
* AI summaries
* operational recommendations

SPARES & MAINTENANCE MODULE

This is a core part of the vision.

The system should manage:

* spare inventory
* workshop operations
* tyre tracking
* service schedules
* breakdown history
* maintenance cost analysis
* supplier management

Nava Eye should correlate:

* telemetry
* usage
* failures
* maintenance records
* spare consumption

to predict:

* breakdowns
* abuse
* poor maintenance
* recurring faults

JOURNEY INTELLIGENCE

The system should intelligently manage:

* recurring routes
* customer delivery patterns
* cargo movement
* loading/offloading
* turnaround time
* fuel usage per route
* cost per route
* trip profitability

Future goal:
The platform should automatically suggest:

* routes
* expected costs
* fuel expectations
* likely delays
* operational risks

based on historical memory.

CLIENT TRACKING EXPERIENCE

Clients should receive:

* shareable tracking links
* live shipment visibility
* loading/offloading visibility
* ETA prediction
* journey status

Truck disappears from client view once:

* return journey starts
* or geofence conditions are met

without needing manual completion.

SCALABILITY REQUIREMENTS

The platform must support:

* real-time ingestion
* thousands of vehicles
* multi-region growth
* event-driven processing
* AI enrichment
* large telemetry volumes

Architecture must avoid:

* hardcoded companies
* tenant-specific logic
* brittle shortcuts
* fake/demo architecture

DESIGN PHILOSOPHY

The UI must feel:

* executive-grade
* modern
* operationally serious
* premium SaaS
* clean
* scalable

Not:

* toy dashboards
* generic admin templates
* fake analytics
* static demo UI

Dark mode should be optional.

LONG-TERM VISION

Nava Strat is intended to evolve into:

* a logistics operating system
* an AI fleet intelligence platform
* a transport ERP
* a decision engine for logistics companies

The eventual goal is not just fleet tracking.

The goal is:
AI-assisted fleet operations and business intelligence at enterprise scale.
