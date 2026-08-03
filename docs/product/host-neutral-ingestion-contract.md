# Host-Neutral Ingestion Contract

This document defines the shape Aperture should prefer for a generalized,
industry-friendly ingestion contract.

It is intentionally broader than the current internal `SourceEvent` type.

The goal is not to rename internal fields for style.
The goal is to make sure Aperture can accept events in a form that:

- is understandable outside Aperture
- is transport-neutral
- is judgment-neutral
- fits existing industry standards
- can be published as a machine-readable contract

The important boundary is:

- the external industry-facing contract should be neutral
- the internal Aperture ingress DTO can stay optimized for Aperture core

So the recommendation here is not "publish `SourceEvent` as-is."
It is "publish a neutral external contract that maps cleanly into
`SourceEvent`."

## The Core Recommendation

Use one clean public path with progressive sophistication:

1. send a plain string to `/work`
2. send a structured `WorkEvent` when you need stable ids or richer fields
3. send a `WorkEvent[]` batch when you need throughput

That gives us:

- the absolute simplest possible producer path
- a readable structured contract when producers are ready for it
- one endpoint instead of multiple ingress shapes
- a direct mapping into Aperture's internal `SourceEvent`

## Standards To Reuse

These are the strongest neutral standards anchors for this contract.

### 1. CloudEvents as the compatibility target for event metadata

CloudEvents exists specifically to describe event data in a common way across
services and platforms.

Why it matters:

- it is vendor-neutral
- it already has broad platform adoption
- it keeps transport metadata separate from business payload

Use it for:

- `id`
- `source`
- `type`
- `time`
- `subject`
- `dataschema`
- `datacontenttype`

Important nuance:

- the public contract does not have to be named `CloudEvent`
- but it should stay easily serializable into CloudEvents 1.0 where that helps
  interoperability

### 2. JSON Schema 2020-12 for payload validation

This is the right base for a machine-readable schema contract.

Why it matters:

- mature and widely implemented
- language-neutral
- works well for generated validators and examples

### 3. AsyncAPI for publishing the ingestion API

AsyncAPI is the best fit for describing event-driven APIs in a protocol-agnostic
way.

Why it matters:

- describes message-driven APIs cleanly
- supports message headers, payloads, examples, and correlation ids
- can describe Kafka, WebSocket, HTTP, and other transports

### 4. W3C Trace Context for correlation

If a host already has distributed tracing, Aperture should not invent a second
trace-correlation mechanism.

Use it for:

- `traceparent`
- `tracestate`

### 5. OpenTelemetry / OpenInference for observability mapping

The ingestion contract should not copy tracing spans into the payload.
But it should be easy to map ingested events into:

- OpenTelemetry event semantics
- GenAI agent spans
- OpenInference trace/span conventions

### 6. MCP session and method identifiers where relevant

When a source host is MCP-based, fields like session identity and transport
metadata should map cleanly from MCP instead of being reinvented.

## Contract Design Rules

These are the main design rules for the payload itself.

### 1. Keep ingestion factual

The ingestion contract should describe what happened, not what Aperture thinks
should happen.

It should not carry:

- final `tone`
- final priority
- final blocking judgment
- final lane (`now` / `next` / `ambient`)

### 2. Separate facts from hints

Facts and hints should not be mixed casually.

- **facts** are explicit source-known data
- **hints** are source-provided suggestions that core may use but does not have
  to trust completely

### 3. Keep metadata generic and readable

Transport and routing metadata should stay standard-friendly, but it does not
need its own public wrapper object.

### 4. Keep the event low-cardinality and readable

The contract should use a small set of event kinds and simple nested objects.

### 5. Prefer durable names over local implementation names

For a public contract, choose names that are readable outside Aperture:

- prefer `consequence` inside `hints` over `riskHint`
- prefer `activityCategory` over `activityClass`
- prefer `capabilityFamily` over `toolFamily`

The current internal names may remain as implementation details if needed.

## Simplest External Shape

The simplest external shape is just a string:

```text
"Waiting for approval before continuing with the deploy."
```

That is the lowest-friction producer path.

The runtime treats it as:

- one standalone work item
- with a generated id
- and a deterministic `task.updated` event with `status: "running"`

This mode is intentionally lightweight.
If producers need stable work identity, batching, structured requests, or
portable metadata, they should move up to `WorkEvent`.

## Structured External Shape

The formal structured shape is:

```text
WorkEvent
```

That keeps the public contract neutral and readable while still allowing:

- easy transport over HTTP, queues, or SDKs
- clean mapping into Aperture's internal `SourceEvent` seam
- lossless serialization into CloudEvents when needed
- a very small first structured step, because Aperture can default the
  transport-style metadata fields when producers omit them

Beyond the minimum, `WorkEvent` can also carry four optional metadata families
that matter more as hosts move toward background, governed, and cost-aware
agent work:

- `automation`
  - run mode, trigger, recurrence, and schedule identity
- `execution`
  - surface, placement, runner, and environment
- `governance`
  - policy and approval lineage
- `usage`
  - model, model-routing, token, and cost metadata

These stay optional so the first structured event remains small and readable.

## Why `SourceEvent` Should Stay Internal For Now

`SourceEvent` is already a good internal host-neutral DTO.

But it is not yet the best public industry-facing standard because it still
shows a few Aperture-local choices:

- it uses Aperture-shaped names like `toolFamily`, `activityClass`, and
  `riskHint`
- it mixes explicit facts and source hints in a more code-centric than
  API-centric way

That is fine internally.
It is just not the cleanest public contract if the goal is broad adoption.

## SDK Kernel Evaluation

For embedded SDK consumers, `@tomismeta/aperture-core/kernel` exposes an opt-in
kernel helper:

```ts
evaluateApertureKernelEvent(event);
```

That path is not the product `/work` ingestion API. It is a package-level,
kernel-owned event DTO for hosts that already have an in-process event and want
the minimal deterministic path:

`kernel event -> bounded finalized event -> observation document -> judgment contract -> explanation codes`

Hosts with a source-native event envelope can keep that mapping in adapter code
and call the kernel only after mapping to the neutral DTO:

```ts
const event = adapter(hostEvent);
if (event !== null) {
  evaluateApertureKernelEvent(event);
}
```

The kernel projection accepts capability authority only from
`facts.capabilityFamily`. `context.items` and `metadata` remain descriptive
payloads and do not promote capability facts. Product ingestion should still
prefer `WorkEvent.facts` with `capabilityFamily`, then map it into Aperture's internal
`SourceEvent` shape.

## Structured Event: `WorkEvent`

This is the host-neutral event Aperture should be able to consume.
At minimum, producers only need:

```json
{
  "kind": "work.updated",
  "work": {
    "id": "task:deploy-42",
    "status": "waiting",
    "summary": "Waiting for approval before continuing."
  }
}
```

Aperture fills these metadata fields when they are omitted:

- `specVersion = "1.0"`
- generated `id`
- `source = "urn:aperture:work"`
- `type = "io.agent.<kind>.v1"`

Richer producers can still send the fuller shape below.

```json
{
  "specVersion": "1.0",
  "id": "evt_01JQY7VJ0Y2P2G4R2CJ6Q8J9Y5",
  "source": "urn:github:copilot-cloud-agent",
  "type": "io.agent.input.requested.v1",
  "time": "2026-04-07T14:20:00Z",
  "subject": "task:deploy-42",
  "contentType": "application/json",
  "schema": "https://schema.example.org/work-event.v1.json",
  "trace": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  },
  "kind": "input.requested",
  "work": {
    "id": "task:deploy-42",
    "title": "Deploy service",
    "summary": "Waiting for approval before continuing."
  },
  "actor": {
    "id": "codex",
    "kind": "agent",
    "label": "Codex"
  },
  "automation": {
    "runMode": "scheduled",
    "trigger": "schedule",
    "recurrence": "recurring",
    "scheduleId": "schedule:nightly-maintenance"
  },
  "execution": {
    "surface": "slack",
    "placement": "cloud",
    "runner": "github-actions-large",
    "environment": "production"
  },
  "governance": {
    "policyId": "policy:production-rollout",
    "approvalState": "pending",
    "approvalId": "approval:deploy-42"
  },
  "usage": {
    "model": "gpt-5.4",
    "modelRouting": "host-auto",
    "inputTokens": 1200,
    "cachedInputTokens": 800,
    "outputTokens": 320,
    "costUsd": 0.14
  },
  "interaction": {
    "id": "interaction:approval:1"
  },
  "request": {
    "kind": "approval",
    "title": "Approve production deploy",
    "summary": "Deploy the service to production.",
    "requireReason": false
  },
  "facts": {
    "capabilityFamily": "deploy",
    "activityCategory": "permission_request"
  },
  "hints": {
    "consequence": "high"
  },
  "context": {
    "items": [{ "id": "branch", "label": "Branch", "value": "release/42" }]
  }
}
```

## Readable External Example

This is the full recommended external event shape.

```json
{
  "specVersion": "1.0",
  "id": "evt_01JQY7VJ0Y2P2G4R2CJ6Q8J9Y5",
  "source": "urn:github:copilot-cloud-agent",
  "type": "io.agent.input.requested.v1",
  "time": "2026-04-07T14:20:00Z",
  "subject": "task:deploy-42",
  "contentType": "application/json",
  "schema": "https://schema.example.org/work-event.v1.json",
  "trace": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  },
  "kind": "input.requested",
  "work": {
    "id": "task:deploy-42",
    "title": "Deploy service",
    "summary": "Waiting for approval before continuing."
  },
  "actor": {
    "id": "codex",
    "kind": "agent",
    "label": "Codex"
  },
  "automation": {
    "runMode": "scheduled",
    "trigger": "schedule",
    "recurrence": "recurring",
    "scheduleId": "schedule:nightly-maintenance"
  },
  "execution": {
    "surface": "slack",
    "placement": "cloud",
    "runner": "github-actions-large",
    "environment": "production"
  },
  "governance": {
    "policyId": "policy:production-rollout",
    "approvalState": "pending",
    "approvalId": "approval:deploy-42"
  },
  "usage": {
    "model": "gpt-5.4",
    "modelRouting": "host-auto",
    "inputTokens": 1200,
    "cachedInputTokens": 800,
    "outputTokens": 320,
    "costUsd": 0.14
  },
  "interaction": {
    "id": "interaction:approval:1"
  },
  "request": {
    "kind": "approval",
    "title": "Approve production deploy",
    "summary": "Deploy the service to production.",
    "requireReason": false
  },
  "facts": {
    "capabilityFamily": "deploy",
    "activityCategory": "permission_request"
  },
  "hints": {
    "consequence": "high"
  },
  "context": {
    "items": [{ "id": "branch", "label": "Branch", "value": "release/42" }]
  }
}
```

## Event Field Model

### Event Metadata

Required top-level fields:

- `kind`
- `work`

Optional metadata fields that Aperture can default on ingress:

- `specVersion`
- `id`
- `source`
- `type`

Recommended optional metadata fields:

- `time`
- `subject`
- `schema`
- `contentType`

Recommended nested metadata fields:

- `trace.traceparent`
- `trace.tracestate`
- `run.sessionId`
- `run.runId`

Recommended optional workflow metadata fields:

- `automation.runMode`
- `automation.trigger`
- `automation.recurrence`
- `automation.scheduleId`
- `execution.surface`
- `execution.placement`
- `execution.runner`
- `execution.environment`
- `governance.policyId`
- `governance.approvalState`
- `governance.approvalId`
- `governance.decisionId`
- `usage.model`
- `usage.modelRouting`
- `usage.inputTokens`
- `usage.cachedInputTokens`
- `usage.outputTokens`
- `usage.costUsd`

Recommended transport mapping:

- a `WorkEvent` should be directly serializable into CloudEvents-compatible
  metadata and payload fields
  without losing information
- the naming stays more readable for product and API consumers

`kind` is the field Aperture uses for routing.
`type` is for interoperability and external event metadata.

### `kind`

The low-cardinality payload kind.

Recommended initial set:

- `work.started`
- `work.updated`
- `work.completed`
- `work.cancelled`
- `input.requested`

This should stay small.

### `work`

The primary work item Aperture is reasoning about.

Recommended fields:

- `id` required
- `title` optional but strongly recommended for visible work
- `summary` optional
- `status` optional
- `progress` optional

Recommended `status` values for the initial contract:

- `running`
- `waiting`
- `blocked`
- `failed`
- `completed`
- `cancelled`

### `actor`

Who emitted or owns the event.

Recommended fields:

- `id` required
- `kind` optional
- `label` optional

Recommended `kind` values:

- `agent`
- `subagent`
- `host`
- `system`
- `human`

### `interaction`

The current operator-facing interaction, if any.

Recommended fields:

- `id` optional but required for `input.requested`

### `request`

Structured human-input requests.

Recommended initial kinds:

- `approval`
- `choice`
- `form`

This is intentionally close to today’s Aperture request families, because those
are already general enough to apply across hosts.

For freeform text collection, prefer:

- `request.kind: "form"`
- one text or textarea field

### `facts`

Explicit source-known facts that are useful to core, but still belong to the
ingestion side.

Recommended initial fields:

- `capabilityFamily`
- `activityCategory`

These correspond closely to Aperture's current internal `toolFamily` and
`activityClass`, but the external names are more neutral.

### `hints`

Optional bounded source-side guidance.

Recommended initial fields:

- `consequence`
- `capabilityFamily`
- `activityCategory`
- `requestKind`

The important rule is:

- hints are suggestions, not canonical judgment
- richer host-specific classifications should live under `extensions` until
  they are proven generic enough to standardize

### `context`

Structured extra context that the host wants to preserve.

Recommended shape:

```json
{
  "items": [{ "id": "branch", "label": "Branch", "value": "release/42" }]
}
```

This keeps the payload open enough for practical integrations without becoming
an untyped dump of source-native JSON.

## Mapping To Current Aperture Contracts

This is how the proposed public contract maps to current internals.

| Proposed external field   | Current Aperture field                                                      |
| ------------------------- | --------------------------------------------------------------------------- |
| `kind: "work.started"`    | `type: "task.started"`                                                      |
| `kind: "work.updated"`    | `type: "task.updated"`                                                      |
| `kind: "input.requested"` | `type: "human.input.requested"`                                             |
| `facts.capabilityFamily`  | `toolFamily`                                                                |
| `facts.activityCategory`  | `activityClass`                                                             |
| `hints.consequence`       | `riskHint` for `input.requested`; otherwise `semanticHints.consequence`     |
| `hints.capabilityFamily`  | `toolFamily` when source-suggested rather than explicit                     |
| `hints.activityCategory`  | `activityClass` when source-suggested rather than explicit                  |
| `hints.requestKind`       | `semanticHints.intentFrame` or request-family mapping when source-suggested |

This is why the right short-term move is:

- keep the current internal `SourceEvent`
- treat it as the internal Aperture ingress DTO
- evolve the external/public ingestion contract toward this more neutral shape

## What To Change In `SourceEvent` Later

If we choose to align the internal `SourceEvent` more closely with the external
contract, the highest-value refinements would be:

1. rename `riskHint` to `consequence`
2. consider `toolFamily` -> `capabilityFamily`
3. consider `activityClass` -> `activityCategory`
4. make fact-versus-hint grouping more explicit
5. support lossless CloudEvents serialization for external transport

I would **not** do all of those immediately.

The public contract can stabilize before the internal TypeScript types move.

## Schemas In This Repo

The first machine-readable versions of this contract live in:

- [work-event.schema.json](../../schemas/work-event.schema.json)
- [work-event-batch.schema.json](../../schemas/work-event-batch.schema.json)

They are generated from
[`packages/runtime/src/work-contract.ts`](../../packages/runtime/src/work-contract.ts)
with:

- `pnpm contract:generate`
- `pnpm contract:check`

For the explicit field mapping and canonical example suite, see:

- [Work Event Mapping](./work-event-mapping.md)

## Current Runtime HTTP Ingest Path

The current shared runtime can ingest this contract directly over HTTP at:

- `POST /work`
- `GET /work`
- `POST /v1/work`
- `GET /v1/work`

This is intentionally the producer-facing ingress path.
The deeper `/runtime/*` control routes still exist for the Aperture product and
local runtime operations, but they are internal plumbing rather than part of
the external producer contract.

Accepted request shapes:

- a raw plain-text string
- a raw `WorkEvent`
- a raw `WorkEvent[]` batch

Current scope:

- `/work` is the public ingress contract
- `/v1/work` is the explicit compatibility alias for the current major version
- every non-health route requires `Authorization: Bearer <runtime-token>`
- plain text stays one-way, lowest-friction, and always maps to a running status update
- structured `input.requested` events create a public response loop
- poll `GET /work/response/{interactionId}` until the human answer is ready
- `DELETE /work/response/{interactionId}` lets the producer cancel an obsolete pending request
- `/runtime/*` remains internal runtime plumbing rather than the public response path

If you start the local runtime directly with `aperture internal runtime`, it
prints the local token path so raw HTTP producers can use the same bearer token
the SDK clients discover automatically.

Self-describing help:

```bash
TOKEN="$(cat /path/to/runtime-token)"
curl http://127.0.0.1:4546/work \
  -H "Authorization: Bearer $TOKEN"
```

That returns a small JSON description of:

- the accepted modes
- when to use each one
- example payloads
- the next richer options available
- response retention and cancellation behavior

Simplest example:

```bash
TOKEN="$(cat /path/to/runtime-token)"
curl -X POST http://127.0.0.1:4546/work \
  -H 'Content-Type: text/plain' \
  -H "Authorization: Bearer $TOKEN" \
  --data 'Waiting for approval before continuing with the deploy.'
```

Structured example:

```bash
TOKEN="$(cat /path/to/runtime-token)"
curl -X POST http://127.0.0.1:4546/work \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "kind": "input.requested",
    "work": {
      "id": "task:deploy-42",
      "title": "Deploy service",
      "summary": "Production deploy is waiting for approval."
    },
    "actor": {
      "id": "agent-1",
      "kind": "agent",
      "label": "Custom Agent"
    },
    "interaction": {
      "id": "interaction:deploy-42:approval"
    },
    "request": {
      "kind": "approval",
      "title": "Approve deploy",
      "summary": "Approve production deployment."
    },
    "facts": {
      "capabilityFamily": "deploy",
      "activityCategory": "permission_request"
    },
    "hints": {
      "consequence": "high"
    }
  }'
```

Runtime ingest is intentionally simple:

- `POST /work`
- body: `string`, `WorkEvent`, or `WorkEvent[]`
- `Content-Type: text/plain` is always treated as text
- `Content-Type: application/json` is always treated as JSON
- when content type is omitted, Aperture only sniffs JSON objects and arrays

The response is intentionally informative too:

- `ok`
- `apiVersion`
- `accepted`
- `receivedAs`
- `published`
- optional `retention`
- optional `next` steps for richer structured usage

For structured `input.requested` submissions, each published item also includes:

- `interactionId`
- `responsePath`
- `responseUrl` when the runtime knows its base URL

Plain-text ingress is intentionally conservative:

- plain text always becomes one standalone `task.updated`
- the generated event always uses `status: "running"`
- richer lifecycle state should be sent through structured `WorkEvent`

Example follow-up:

```bash
TOKEN="$(cat /path/to/runtime-token)"
curl http://127.0.0.1:4546/work/response/interaction%3Adeploy-42%3Aapproval \
  -H "Authorization: Bearer $TOKEN"
```

That returns:

- `state: "pending"` while Aperture is still waiting on a human answer
- `state: "answered"` once the TUI or another Aperture surface has submitted the response
- `state: "expired"` once the response window times out
- `state: "cancelled"` if the producer retracts the pending request
- the final `response` object when available
- expiry and retention timestamps when relevant

## Recommendation

The best next step is:

1. keep current internal `SourceEvent` unchanged for now
2. define a formal external ingestion contract as:
   - `WorkEvent`
   - JSON Schema 2020-12 payload
   - CloudEvents-compatible transport mapping
3. publish it through AsyncAPI when we expose it over runtime or API transport
4. only then decide how far internal `SourceEvent` should converge toward the
   external shape

That gives Aperture:

- a cleaner industry-facing schema
- a transport-neutral contract
- less Aperture-specific naming bias
- a path toward adoption beyond the current repo

## Standards References

- CloudEvents: <https://cloudevents.io/>
- CloudEvents JSON schema: <https://raw.githubusercontent.com/cloudevents/spec/v1.0.2/cloudevents/formats/cloudevents.json>
- AsyncAPI 3.0: <https://www.asyncapi.com/docs/reference/specification/v3.0.0>
- JSON Schema 2020-12: <https://json-schema.org/draft/2020-12>
- W3C Trace Context: <https://www.w3.org/TR/trace-context/>
- OpenTelemetry event semantics: <https://opentelemetry.io/docs/specs/semconv/general/events/>
- OpenTelemetry GenAI agent spans: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/>
- OpenTelemetry MCP semantics: <https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/>
- OpenInference specification: <https://arize-ai.github.io/openinference/spec/>
