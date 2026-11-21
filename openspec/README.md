# Bop behavioral reference

The baseline records the behavior of the prep repository at `292ba5f8a8f73cb17bbabd233978920154df8fd2`. Source and test paths in these documents refer to that revision. The competition implementation is written independently. The scenarios are acceptance criteria for that implementation. Passing OpenSpec validation checks the documents' structure; application tests establish behavioral coverage. [Reference revision](https://github.com/Team37-Bop/sea-x-openai-regional-codex-hackathon-thailand-prep/tree/292ba5f8a8f73cb17bbabd233978920154df8fd2)

## Capabilities

| Capability | What a reviewer can verify |
| --- | --- |
| [Planner interface](specs/planner-interface/spec.md) | Setup, sample entry, progress, recovery, booking tasks and keyboard navigation |
| [Trip setup](specs/trip-setup/spec.md) | Normalized members, dates, inbound/outbound choices and stays by night |
| [Agent runtime](specs/agent-runtime/spec.md) | Provider selection, search/model tiers, readiness, error handling and streamed results |
| [Group choices](specs/ask-mode-candidates/spec.md) | Question limits, candidate IDs, photo enrichment and transfer of member choices |
| [Itinerary planning](specs/itinerary-planning/spec.md) | Design, split-day scheduling, transport, stay anchoring and repair |
| [Constraint checks](specs/constraint-checks/spec.md) | Per-member budgets, diet, walking, wishes, meal windows, days, buffers and driving |
| [Mapping and routing](specs/map-and-routing/spec.md) | POI resolution, route geometry, travel modes, caching and map display |
| [Place research](specs/place-research/spec.md) | Sourced venue details, photo provenance, currency conversion and confidence |
| [Replanning](specs/replanning/spec.md) | Minimal edits, before/after checks, votes, reservation follow-up and undo |
| [Weather triggers](specs/weather-trigger/spec.md) | Outdoor-stop exposure, hourly precipitation, data freshness and explicit replanning |
| [Transport search](specs/transport-search/spec.md) | Web estimates, Duffel-backed offers, chosen directions and recovery |
| [Flight booking](specs/flight-booking/spec.md) | Offer refresh, passenger review, hold or instant order, price changes and cancellation |
| [LINE messaging](specs/line-messaging/spec.md) | Signed events, group linking, LIFF identity, votes, push limits and deletion |
| [Operational state](specs/operational-state/spec.md) | Trip retention, conditional writes, retry behavior, audit data and local fallback |
| [AWS deployment](specs/aws-deployment/spec.md) | Edge routing, streaming API, packaged handler, release identity and post-deploy checks |

## Interpreting proposals

The reference implements OpenAI service-account access, Duffel offer/order/cancel routes and LINE group voting. The older proposal checkboxes are not sufficient evidence of delivery. For example, a selected web fare and a supplier-backed Duffel offer have different booking capabilities.

Google Places and Google Routes, flight-status monitoring, hotel reservations, third-party activity booking and retail payment processing remain proposals in the reference snapshot. The implemented alternatives include OSM-based routing, place research with web sources, booked-stay input, and delay scenarios. Supplying a provider credential alone does not activate a proposed integration. A test-mode supplier order is separate from accepting a real customer payment.

## Verification

Run `openspec validate --all --strict` to validate this baseline. For behavior, each capability identifies reference source and, where present, a matching regression suite. In the pinned reference, `npm test` exercises the planner rules, mocked weather and Duffel, LINE, runtime, state, Lambda and infrastructure declarations. Supplier production acceptance, cloud provisioning and end-user authorization require separate evidence.
