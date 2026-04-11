# Adapter Contract

This document is the current cross-adapter contract for Aperture.

Its job is simple:

- keep the adapter architecture consistent
- record what is actually verified today
- separate `live`, `experimental`, and `not yet proven` clearly
- give us one place to check before changing adapter or TUI behavior

## Adapter Role In The Product Direction

Aperture's direction is to be a host-neutral control plane across agent hosts,
not another host runtime competing feature-for-feature with each native tool.

That means adapter discipline matters a lot:

- adapters should make host-native work legible to Aperture
- adapters should not drag host-native semantics directly into core
- adapters should preserve explicit facts, identity, and return paths
- core should remain the place where cross-host judgment becomes consistent

## Generalized Ingestion Schema

Inside the Aperture codebase, the generalized host-neutral ingress DTO is
`SourceEvent`.

That is the contract in-repo adapters should target when they want to feed work
into Aperture in a source-agnostic way.

For external or industry-facing ingestion APIs, the better long-term contract
is:

- `POST /work` with:
  - a plain string for the simplest producer path
  - a neutral `WorkEvent` when structured identity or request metadata matters
- authenticated with the same local runtime bearer token that Aperture clients
  discover from runtime registration state

that maps into internal `SourceEvent`.

The event layers are:

1. raw host event
2. `SourceEvent`
3. `ApertureEvent`
4. `EnrichedApertureEvent`

In practical terms:

- raw host event = source-native payload
- `SourceEvent` = factual host-neutral ingress inside Aperture
- `ApertureEvent` = canonical core event
- `EnrichedApertureEvent` = finalized runtime event ready for evaluation

This distinction is important:

- internal adapters should usually publish `SourceEvent`
- external ingest APIs should accept the published neutral ingestion contract
  and map it into `SourceEvent`
- direct engine callers can publish `ApertureEvent` when they already own the
  canonical shape
- adapters should not skip straight to richer canonical meaning unless they are
  intentionally acting as a trusted canonical producer

For the broader industry-facing direction of that contract, including standards
alignment and the proposed neutral event contract, see
[Host-Neutral Ingestion Contract](./host-neutral-ingestion-contract.md).
For the explicit field translation into Aperture's internal contracts, see
[Work Event Mapping](./work-event-mapping.md).

## Shared Adapter Contract

Every Aperture adapter should have the same high-level shape:

```text
source-native transport
-> source-native client or host seam
-> adapter mapping
-> @aperture/runtime
-> @tomismeta/aperture-core
-> AttentionResponse
-> adapter response mapping
-> source-native reply path
```

The important rule is:

- adapters own source-native transport, mapping, and response routing
- runtime owns shared hosting
- core owns attention judgment
- TUI stays source-agnostic

The more precise version is:

- adapters provide `SourceEvent`
- core turns `SourceEvent` into canonical meaning
- responses come back out as `AttentionResponse`

## Adapter Checklist

This is the current standard we should hold all adapters to.

### 1. Boundary

- source-specific protocol or hook details stay inside the adapter package
- no source-native types leak into `@tomismeta/aperture-core`
- adapters publish `SourceEvent`
- adapters consume `AttentionResponse`
- adapters should treat `SourceEvent` as the generalized host-neutral ingress
  schema, not invent one-off per-host core contracts

### 2. Structure

- one explicit mapping layer
- one explicit host, transport, or bridge layer
- one explicit return-path mapping back into the source
- startup wiring kept outside core
- shared Aperture contract fields and reusable context item ids should keep the same naming style across adapters instead of mirroring source-native casing

### 3. Safety

- unsupported source requests fail clearly
- disconnects and reconnects are handled where the source requires them
- pending human-request state is cleaned up conservatively
- shutdown behavior is deliberate, not best-effort by accident

### 4. Verification

- unit tests cover request or event mapping
- unit tests cover response mapping
- bridge or host behavior is tested where applicable
- live-verified request families are documented separately from repo-tested behavior

### 5. Product discipline

- explicit source requests become focused Aperture work
- coarse lifecycle stays ambient unless there is a strong reason otherwise
- adapters should prefer explicit semantics over heuristic inference

## Current Matrix

| Adapter | Status | Source seam | Internal shape | Response path | Hardening | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| `@aperture/claude-code` | live | Claude hook payloads via local hook server | mapping + hook server | Claude hook response payload | held approval timeout, explicit fallback-to-ask | repo-tested, product-supported |
| `@aperture/opencode` | live | OpenCode server APIs and event stream | mapping + client + bridge | permission/question reply APIs | reconnect, heartbeat timeout, bootstrap of pending work | repo-tested, product-supported |
| `@aperture/codex` | experimental | Codex App Server | transport + client + mapping + bridge | App Server server-request responses | reconnect, request timeout, request cleanup, controlled shutdown | repo-tested, partially live-verified |

## Current Read

### Claude Code

What is strong:

- clean hook-to-`SourceEvent` mapping
- clear held approval loop
- explicit fallback behavior when Aperture is not attached or does not answer
- now structurally split into:
  - mapping
  - hook server

What is true today:

- this is a live supported path
- it is the most mature adapter in terms of product fit
- the public integration seam is hook configuration, not a server transport

Current verification level:

- repo-tested
- product-supported on the documented local path

### OpenCode

What is strong:

- clear separation between mapping and bridge responsibilities
- good reconnect and heartbeat behavior
- adapter bootstraps pending permissions and questions from the server
- response loop is explicit and source-native

What is true today:

- this is a live supported path
- OpenCode remains the runtime; Aperture remains the external attention plane
- the public integration seam is the OpenCode server and event stream

Current verification level:

- repo-tested
- product-supported on the documented server plus terminal path

### Codex

What is strong:

- best transport and bridge structure of the current adapters
- generated protocol is the compatibility contract
- transport seam is pluggable
- approval round trip is proven end to end

What is true today:

- this is still experimental
- the adapter boundary is correct
- the limiting factor is usually what Codex App Server externalizes as a request, not the basic Aperture path

Current verification level:

- repo-tested
- live-verified for:
  - `item/commandExecution/requestApproval`
- not yet broadly live-verified across all request families

## Current Gaps

These are the important gaps to keep in mind before any larger TUI push.

### Shared

- we do not yet maintain named golden scenarios across all adapters as a routine release check
- the TUI has not yet been reviewed as one shared operator experience across all adapters after the latest adapter cleanup

### Claude Code

- no recent push to broaden session or subagent lifecycle semantics
- still intentionally centered on hook events rather than transcript or session introspection

### OpenCode

- freeform text-entry support in the TUI is still limited relative to some OpenCode question shapes
- native desktop parity is still weaker than the server plus terminal path

### Codex

- only part of the App Server request surface has been live-verified
- many Codex events remain informational notifications without stronger interruption semantics
- this should stay out of the main live path until the request surface matures further

## What This Means For The TUI Pass

The next TUI pass should assume:

- adapters are clean enough to build on
- the operator surface should remain source-agnostic
- source-specific affordances should only appear when they are grounded in real adapter semantics
- Codex should be treated as an experimental input path, not as a driver of the mainline operator model

The TUI question now is no longer "can these adapters fit?"

It is:

- what is the cleanest shared operator experience across the adapters we already have?
