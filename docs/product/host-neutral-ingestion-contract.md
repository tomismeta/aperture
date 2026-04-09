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
- and best-effort status inference from the text

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

## Structured Event: `WorkEvent`

This is the host-neutral event Aperture should be able to consume.

```json
{
  "specVersion": "1.0",
  "id": "evt_01JQY7VJ0Y2P2G4R2CJ6Q8J9Y5",
  "source": "urn:github:copilot-cloud-agent",
  "type": "io.agent.work.updated.v1",
  "time": "2026-04-07T14:20:00Z",
  "subject": "task:deploy-42",
  "contentType": "application/json",
  "schema": "https://schema.example.org/work-event.v1.json",
  "trace": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  },
  "kind": "work.updated",
  "work": {
    "id": "task:deploy-42",
    "title": "Deploy service",
    "summary": "Waiting for approval before continuing.",
    "status": "waiting",
    "progress": 0.7
  },
  "actor": {
    "id": "codex",
    "kind": "agent",
    "label": "Codex"
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
    "activityCategory": "status_update"
  },
  "hints": {
    "consequence": "high"
  },
  "context": {
    "items": [
      { "id": "branch", "label": "Branch", "value": "release/42" }
    ]
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
  "type": "io.agent.work.updated.v1",
  "time": "2026-04-07T14:20:00Z",
  "subject": "task:deploy-42",
  "contentType": "application/json",
  "schema": "https://schema.example.org/work-event.v1.json",
  "trace": {
    "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  },
  "kind": "work.updated",
  "work": {
    "id": "task:deploy-42",
    "title": "Deploy service",
    "summary": "Waiting for approval before continuing.",
    "status": "waiting",
    "progress": 0.7
  },
  "actor": {
    "id": "codex",
    "kind": "agent",
    "label": "Codex"
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
    "activityCategory": "status_update"
  },
  "hints": {
    "consequence": "high"
  },
  "context": {
    "items": [
      { "id": "branch", "label": "Branch", "value": "release/42" }
    ]
  }
}
```

## Event Field Model

### Event Metadata

Recommended required top-level fields:

- `specVersion`
- `id`
- `source`
- `type`
- `kind`
- `work`

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

Recommended transport mapping:

- a `WorkEvent` should be directly serializable into CloudEvents-compatible
  metadata and payload fields
  without losing information
- the naming stays more readable for product and API consumers

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
  "items": [
    { "id": "branch", "label": "Branch", "value": "release/42" }
  ]
}
```

This keeps the payload open enough for practical integrations without becoming
an untyped dump of source-native JSON.

## Mapping To Current Aperture Contracts

This is how the proposed public contract maps to current internals.

| Proposed external field | Current Aperture field |
| --- | --- |
| `kind: "work.started"` | `type: "task.started"` |
| `kind: "work.updated"` | `type: "task.updated"` |
| `kind: "input.requested"` | `type: "human.input.requested"` |
| `facts.capabilityFamily` | `toolFamily` |
| `facts.activityCategory` | `activityClass` |
| `hints.consequence` | `riskHint` |
| `hints.capabilityFamily` | `toolFamily` when source-suggested rather than explicit |
| `hints.activityCategory` | `activityClass` when source-suggested rather than explicit |
| `hints.requestKind` | `semanticHints.intentFrame` or request-family mapping when source-suggested |

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

- `/Users/tom/dev/aperture/schemas/work-event.schema.json`

For the explicit field mapping and canonical example suite, see:

- [Work Event Mapping](./work-event-mapping.md)

## Current Runtime HTTP Ingest Path

The current shared runtime can ingest this contract directly over HTTP at:

- `POST /work`

Accepted request shapes:

- a raw plain-text string
- a raw `WorkEvent`
- a raw `WorkEvent[]` batch

Simplest example:

```bash
curl -X POST http://127.0.0.1:4546/work \
  -H 'Content-Type: text/plain' \
  --data 'Waiting for approval before continuing with the deploy.'
```

Structured example:

```bash
curl -X POST http://127.0.0.1:4546/work \
  -H 'Content-Type: application/json' \
  -d '{
    "specVersion": "1.0",
    "id": "evt_approval_1",
    "source": "urn:example:custom-agent",
    "type": "io.agent.input.requested.v1",
    "time": "2026-04-09T14:00:00Z",
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
