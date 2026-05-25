# Nava Eye Regression Tests

Use this checklist before and after changing Nava Eye routing, answer templates, timeline intelligence, metric helpers, provider capability logic, or conversation UI. These tests are intentionally practical: many require seeded JLCL data and a real Nava Eye conversation, while the pure guardrails can be checked by code inspection/build until a formal test runner is added.

Current test harness note: the repo does not currently include a Jest/Vitest/Playwright test script. Keep regression coverage lightweight and deterministic until a test framework is intentionally introduced.

## Guardrail Contract

- Resolve company, role, and conversation state before answering.
- Current prompt explicit truck/entity beats cached topic.
- Active truck, active metric, and active timeframe come from database-backed conversation metadata, not process memory.
- Default answers are concise operational summaries; detailed evidence only appears when requested.
- Do not expose raw provider payloads, secrets, private driver fields, raw coordinate series, or unreviewed asset telemetry.
- Do not show raw coordinates in normal answers unless the user explicitly asks for coordinates/GPS/map pins.
- Do not claim engine-on idling, fuel burn, tank-volume change, theft, profit, or contribution without deterministic supporting evidence.
- Avoid generic fallback on entity-like prompts. Resolve, suggest a safe close match, or ask a targeted clarification.

## A. Live Truck Status

Prompt:

```text
Where is kdq265
```

Expected:

- Answers KDQ 265T if it exists, or gives a close-match clarification if it does not.
- Uses a readable operational location, not raw latitude/longitude.
- Includes speed and stopped/moving/stale status.
- Does not use the generic limited-context fallback.
- Does not expose private driver fields or raw provider payloads.

## B. Entity Resolver

Prompt sequence:

```text
Where is kdq265
How about kdq266
```

Expected:

- If KDQ266 exists in the active company workspace, answer for that truck.
- If KDQ266 does not exist, suggest a safe closest workspace match such as KDQ 265T.
- Does not answer fleet-wide unless fleet/all-truck scope is explicit.
- Does not return a generic limited-context fallback.

## C. Mileage Follow-Up

Prompt sequence:

```text
Where is kdq265
How much mileage has it covered today?
The 307km was covered today the 25th
Is that odometer mileage?
```

Expected:

- Keeps KDQ 265T as the active truck for "it."
- Keeps the previous metric result context for "the 307km" and "that mileage."
- Preserves the exact/meaningful distance value from the previous answer, including decimals when available.
- Labels GPS-estimated route distance, provider-reported mileage, dashboard odometer, or CAN odometer correctly.
- If the source is GPS-estimated distance, explicitly says it is not dashboard odometer mileage.

## D. Timeline And Timeframe

Prompt sequence:

```text
What are yesterday's movements for KCW 103Z?
Show detailed timeline
Show today's detailed timeline
```

Expected:

- The first answer summarizes yesterday's KCW 103Z route in the company/operator timezone.
- "Show detailed timeline" inherits yesterday from the previous timeline summary.
- "Show today's detailed timeline" explicitly overrides the inherited timeframe.
- Header date, query window, summary, and detailed blocks all refer to the same resolved local day.

## E. Detailed Idle Marker Evidence

Prompt:

```text
Show detailed timeline
```

Expected:

- Shows grouped idle/excessive-idle alert windows by default.
- Does not dump repeated duplicate marker rows unless the user explicitly asks to show every idle marker.
- Does not repeat unresolved GPS caveats on every marker.
- Does not show raw coordinate series.
- Does not contain impossible chronology, such as an evening marker being "broken" by morning movement.

Extra prompt:

```text
Show every idle marker
```

Expected:

- Individual markers may appear, but they remain cleanly formatted and tenant-safe.

## F. Operational Location Evidence

Prompt sequence:

```text
What are yesterday's movements for KCX 113Y?
Can you show me exactly where it was yesterday?
```

Expected:

- Inherits KCX 113Y and yesterday from the previous timeline answer.
- Leads with operational meaning, such as stationary/holding day versus corridor movement day.
- Includes main resolved place, visible time window, movement/stationary pattern, longest or final stop, and hardware capability boundary.
- Provides a map pin when available because the user asked for exact/map context.
- Does not dump a coordinate series or raw provider payload.
- Does not return a generic limited-context fallback.

Prompt:

```text
Where did KCW 103Z spend most of yesterday?
```

Expected:

- Resolves KCW 103Z directly from the current prompt.
- Summarizes major stop/location anchors for yesterday.
- Uses map pins only when map/exact/pin context is requested.

## G. Compound Questions

Prompt:

```text
where is KCW 103Z?
is KCW 103Z idling?
what are yesterday's movements for KCW 103Z?
show detailed timeline
please answer these questions in order
```

Expected:

- Answers in numbered sections in the same order:
  1. Current location
  2. Idle status
  3. Yesterday's movement
  4. Detailed timeline
- Does not let detailed timeline override earlier requested summaries.
- Keeps all sections scoped to KCW 103Z.

## H. Fleet Versus Truck Scope

Prompt sequence:

```text
what are yesterday's fleet movements?
what are yesterday's movements for KCW 103Z?
```

Expected:

- First answer is fleet-wide because fleet scope is explicit.
- Second answer switches to KCW 103Z because an explicit truck in the current prompt overrides stale fleet context.
- The resolved "yesterday" date is consistent in both answers.

## I. Business Math Readiness

Prompts:

```text
Did KCW 103Z make money yesterday?
What is contribution per km for KCW 103Z?
Which trucks moved but have no revenue?
```

Expected:

- Uses deterministic metric helpers only.
- Does not invent revenue, expense, profit, contribution, or margin.
- Lists missing data clearly when linked revenue, costs, distance, or trip/revenue linkage is unavailable.
- Finance/profit/contribution answers respect role boundaries.
- Ops users get a permission boundary without leaked numbers.

## J. Provider Capability

Prompt:

```text
Is KCW 103Z idling?
```

Expected:

- GPS-only assets can report stopped/moving from GPS evidence.
- GPS-only assets do not claim engine-on idling, exact fuel burn, tank-volume movement, or theft.
- Ignition/CAN/tank-sensor claims appear only when the asset/provider capability is verified and the signal is available.
- Placeholder zero RPM/fuel values do not upgrade capability.

## K. Coordinates

Prompt:

```text
Where is KCW 103Z?
```

Expected:

- No raw coordinates by default.
- Location is expressed as a town, geofence, cached label, provider-label fallback, or safe operational place phrase.

Prompt:

```text
What are the coordinates for KCW 103Z?
```

Expected:

- Coordinates are allowed because the user explicitly requested them.
- Coordinates are labeled and not mixed with raw provider payloads.

## L. Mobile Thread UX

Manual mobile viewport checks:

- Refresh `/nava-eye` and confirm selected company, selected thread, and open/closed tab remain stable.
- Close from the bottom action after the latest assistant answer.
- Confirm the close confirmation appears.
- Confirm closing removes the thread from Open conversations.
- Reopen from Closed conversations and confirm the thread is read-only.
- Send a live truck-status prompt and a follow-up; confirm auto-scroll reaches the newest answer.
- Confirm long answers wrap naturally and do not overflow horizontally.
- Confirm input, Send, close actions, company selector, thread list, and closed state remain reachable.

## Lightweight Code Guardrails

The current lightweight guardrails should catch or rewrite these deterministic answer issues:

- Generic limited-context fallback on entity-like prompts.
- Third-person product self-reference in answer templates, such as "Nava reads," "Nava treats," "Nava can confirm," or "Nava only has."
- Raw latitude/longitude pairs when the user did not ask for coordinates.
- Unsupported "engine-on idling confirmed" phrasing when the available capability context does not support ignition/engine evidence.

These checks are not a replacement for role checks or data scoping. They are final answer-quality guardrails for common regressions.
