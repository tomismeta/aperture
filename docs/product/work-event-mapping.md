# Work Event Mapping

This document defines the current mapping from the public neutral
`WorkEvent` contract into Aperture's internal `SourceEvent` ingress
DTO.

This is the operational companion to
[Host-Neutral Ingestion Contract](./host-neutral-ingestion-contract.md).

The boundary is:

- `WorkEvent` is the external/public contract
- `SourceEvent` is the internal Aperture ingress contract
- this mapping is where external work facts become Aperture input

The runtime also supports a simpler producer shape:

- a plain string posted to `/work`

That string path is intentionally minimal and maps to one standalone
`SourceEvent` with a generated id.

This document focuses on the structured `WorkEvent` path, which is the stable
formal contract.

## Mapping Principles

- keep external ingestion factual
- preserve explicit facts separately from hints
- fail only when required structure is missing
- ignore unknown soft classifications instead of inventing new internal meaning
- keep the mapping small enough that adapters can reason about it directly

## Event Metadata Mapping

| `WorkEvent` field  | `SourceEvent` field | Notes                                                                                                             |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `specVersion`      | n/a                 | Optional on ingress. Aperture defaults it to `1.0` when omitted and rejects versions other than `1.0`.            |
| `id`               | `id`                | Passed through unchanged when present. Aperture generates one when omitted.                                       |
| `source`           | `source.kind`       | Optional on ingress. Aperture defaults it to `urn:aperture:work` when omitted.                                    |
| `type`             | n/a                 | Optional interoperability field. Aperture routes on `kind` and derives `io.agent.<kind>.v1` when this is omitted. |
| `time`             | `timestamp`         | If absent, runtime uses receive-time as the timestamp.                                                            |
| `source` + `actor` | `source`            | `source.id = actor.id ?? event.source`, `source.kind = event.source`, `source.label = actor.label` when present.  |
| `work.id`          | `taskId`            | Passed through unchanged.                                                                                         |

`kind` is the routing field Aperture actually uses.
`type` is for interoperability and external event metadata, not internal routing.

## Kind Mapping

| `WorkEvent.kind`  | `SourceEvent.type`      | Required fields                        | Notes                                                                       |
| ----------------- | ----------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `work.started`    | `task.started`          | `work.id`                              | `title` falls back to `work.title`, then `work.summary`, then `work.id`.    |
| `work.updated`    | `task.updated`          | `work.id`, `work.status`               | `status` must be `running`, `waiting`, `blocked`, `failed`, or `completed`. |
| `work.completed`  | `task.completed`        | `work.id`                              | `summary` is preserved when present.                                        |
| `work.cancelled`  | `task.cancelled`        | `work.id`                              | `reason` prefers `work.reason`, then falls back to `work.summary`.          |
| `input.requested` | `human.input.requested` | `work.id`, `interaction.id`, `request` | This is the operator-facing input path.                                     |

## Facts And Hints

| External field           | Internal field                            | Behavior                                                                                                                                                                       |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `facts.capabilityFamily` | `toolFamily`                              | Treated as an explicit source fact.                                                                                                                                            |
| `facts.activityCategory` | `activityClass`                           | Mapped only when the category matches a known alias. Unknown values are ignored.                                                                                               |
| `hints.capabilityFamily` | `semanticHints.toolFamily`                | Treated as a suggestion, not an explicit fact.                                                                                                                                 |
| `hints.activityCategory` | `semanticHints.activityClass`             | Mapped only when the category matches a known alias. Unknown values are ignored.                                                                                               |
| `hints.requestKind`      | `semanticHints.intentFrame`               | `approval -> approval_request`, `choice -> question_request`, `form -> form_request`. Useful even on `work.updated` when the host is signaling the likely next request family. |
| `hints.consequence`      | `riskHint` or `semanticHints.consequence` | For `input.requested`, it becomes `riskHint`. For other kinds, it becomes `semanticHints.consequence`.                                                                         |

This is the main reason the external contract stays useful:

- facts can stay explicit
- hints can stay soft
- Aperture still owns final semantic interpretation

## Automation, Execution, Governance, And Usage

These optional objects are preserved as factual metadata rather than translated
into new routing rules.

| External field | Internal field                    | Behavior                                                                      |
| -------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| `automation`   | `SourceEvent.metadata.automation` | Preserved for audit, background-work review, and capture/export.              |
| `execution`    | `SourceEvent.metadata.execution`  | Preserved so review surfaces can inspect where and how the work ran.          |
| `governance`   | `SourceEvent.metadata.governance` | Preserved for policy and approval lineage without forcing new core semantics. |
| `usage`        | `SourceEvent.metadata.usage`      | Preserved for model-routing, token, and cost visibility.                      |

For surfaced `task.started`, `task.updated`, and `input.requested` frames, this
metadata is also carried into `AttentionFrame.metadata`.

For `task.completed` and `task.cancelled`, the current runtime preserves the
metadata in published source events and traces, but those events clear work
rather than producing a new visible frame.

## Request Mapping

`input.requested` maps structured requests into Aperture's existing human-input
request families.

| External request | Internal request |
| ---------------- | ---------------- |
| `approval`       | `approval`       |
| `choice`         | `choice`         |
| `form`           | `form`           |

Important details:

- `choice.options[].summary` is preserved
- `form.fields[].options` are preserved when present
- `request.title` and `request.summary` take precedence over `work.title` and `work.summary`

For `input.requested`, title and summary resolve in this order:

- `title = request.title ?? work.title ?? "Input requested for <work.id>"`
- `summary = request.summary ?? work.summary ?? "Input requested for <work.id>."`

## Context Mapping

For `work.updated` and `input.requested` events:

- `work.progress` maps to `context.progress`
- `context.items[]` maps to `context.items[]`
- non-string context item values are stringified

For `input.requested`, that context is used directly for the operator-facing
frame.

For `work.updated`, that context remains diagnostic and continuity-facing:

- it helps preserve durable anchors like issue ids, file paths, and commands
- it does not override status authority for routing

If neither progress nor context items are present, no internal `context` object
is created.

## Plain-Text Mapping

Plain text is the lowest-friction path:

- `POST /work` with a raw string

The runtime maps it into one standalone `SourceEvent` with:

- a generated `id`
- the same generated id reused as `taskId`
- a deterministic `task.updated` shape
- `status: "running"`

This path is intentionally conservative.
If a producer needs stable cross-update identity, explicit request types, or
portable metadata, it should move up to structured `WorkEvent`.

## Supported Activity Category Aliases

The current mapper recognizes these external `activityCategory` values:

- `permission_request`
- `approval_request`
- `question_request`
- `follow_up`
- `result_ready`
- `tool_completion`
- `completion`
- `tool_failure`
- `failure`
- `session_status`
- `status_update`
- `status`

These map into Aperture's existing `activityClass` vocabulary.

## Representative Host Fits

These are the main host shapes the current contract is designed to fit.

| Host shape                                 | Example                                                                                                          | Why it fits                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| coding-agent status stream                 | [coding-agent-status-waiting.json](../../schemas/examples/work-event/coding-agent-status-waiting.json)           | Represents a durable task moving through running/waiting/blocked state without inventing judgment.                                                            |
| coding-agent approval gate                 | [coding-agent-approval-request.json](../../schemas/examples/work-event/coding-agent-approval-request.json)       | Fits hosts like Claude Code or Codex when they need an explicit human approval.                                                                               |
| remote review or plan selection            | [remote-review-choice-request.json](../../schemas/examples/work-event/remote-review-choice-request.json)         | Fits remote agent surfaces that need the operator to choose between structured options.                                                                       |
| scheduled background run awaiting approval | [scheduled-background-maintenance.json](../../schemas/examples/work-event/scheduled-background-maintenance.json) | Fits always-on or scheduled agents that need portable automation, execution, governance, and usage metadata without becoming a host-specific workflow format. |
| subagent or tool runner failure            | [subagent-failure-update.json](../../schemas/examples/work-event/subagent-failure-update.json)                   | Fits delegated or child execution without forcing the host to publish raw logs.                                                                               |
| workflow or task runner completion         | [workflow-completed.json](../../schemas/examples/work-event/workflow-completed.json)                             | Fits CI, deploy, or automation systems reporting durable work completion with optional scheduling, execution, and usage metadata.                             |

These examples are intentionally scenario-based rather than vendor-branded.
They should be reusable across hosts with similar shapes.

## Canonical Example Suite

The current example suite lives in:

- [coding-agent-status-waiting.json](../../schemas/examples/work-event/coding-agent-status-waiting.json)
- [coding-agent-approval-request.json](../../schemas/examples/work-event/coding-agent-approval-request.json)
- [remote-review-choice-request.json](../../schemas/examples/work-event/remote-review-choice-request.json)
- [scheduled-background-maintenance.json](../../schemas/examples/work-event/scheduled-background-maintenance.json)
- [subagent-failure-update.json](../../schemas/examples/work-event/subagent-failure-update.json)
- [workflow-completed.json](../../schemas/examples/work-event/workflow-completed.json)

The runtime test suite consumes these examples directly. That gives us a small
contract corpus instead of relying only on prose.

## Current Runtime Path

The shared runtime accepts this contract at:

- `POST /work`
- `GET /work`
- `GET /work/response/{interactionId}`
- `DELETE /work/response/{interactionId}`

That endpoint accepts:

- plain text
- one `WorkEvent`
- or `WorkEvent[]`

All non-health runtime routes require `Authorization: Bearer <runtime-token>`.

The runtime then maps the submission into `SourceEvent` and publishes it
through the existing core path.

`GET /work` returns a compact contract description for producers that want the
endpoint itself to explain:

- the accepted modes
- the intended use of each mode
- example payloads
- the next richer structured options available

For structured `input.requested` work:

- the `POST /work` receipt includes `interactionId`
- the receipt also includes `responsePath`
- the receipt may also include `responseUrl`
- producers can poll `GET /work/response/{interactionId}` until the human answer is ready
- producers can `DELETE /work/response/{interactionId}` to cancel a stale pending request
- response state moves through `pending`, `answered`, `expired`, or `cancelled`

The runtime path is:

`string | WorkEvent | WorkEvent[] -> SourceEvent -> ApertureEvent -> EnrichedApertureEvent -> judgment`

For round-trip operator input:

`WorkEvent(kind=input.requested) -> SourceEvent(human.input.requested) -> frame -> human response -> GET /work/response/{interactionId}`

## Recommendation

Treat this mapping as the stable bridge between:

- neutral host-facing ingestion
- Aperture's deterministic internal judgment contracts

That means:

- evolve `WorkEvent` carefully
- keep `SourceEvent` internal for now
- add new example payloads before widening the contract
- pressure-test new host shapes against this mapping before changing core
