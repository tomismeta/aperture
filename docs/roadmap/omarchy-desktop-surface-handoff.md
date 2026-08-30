# Omarchy Desktop Surface Handoff

## Decision

Develop the desktop surface through two coordinated repositories:

- Aperture runtime/protocol: `/Users/tom/dev/aperture`
- Omarchy renderer: `/Users/tom/dev/omarchy-aperture`

Aperture owns the secure host-neutral interface. The Omarchy repository owns only QML rendering and shell lifecycle.

The initial package capability set emits snapshots only. Do not couple responses, engagement, or inline approvals to the first distribution proof.

## Product goal

> Aperture tells a person which agent needs them now, regardless of where that agent is running.

The reference client is an Omarchy bar plugin. The durable product asset is the public external-surface protocol that can later support other desktop shells and editors.

## Current baseline

- Aperture commit: `92a14f40f40776bd49ad9a15a3768af7e85db0ce`
- `@tomismeta/aperture@0.5.0`
- `@tomismeta/aperture-core@0.9.0`
- Omarchy branch inspected: `omacom/omarchy@quattro`
- Concept source: <https://gist.github.com/tomismeta/d926469e3693dc55ffea45a536eddc89>
- Plugin handoff: `/Users/tom/dev/omarchy-aperture/HANDOFF.md`
- Coordination log: `/Users/tom/dev/omarchy-aperture/COORDINATION.md`
- Draft protocol fixtures: `/Users/tom/dev/omarchy-aperture/fixtures/surface-protocol-draft`

## Ownership

### Aperture workstream

Own:

- public `aperture surface --stdio` command
- bounded surface DTO and JSON Schema
- bounded projection from internal `AttentionView`
- companion attachment semantics
- runtime discovery, authentication, heartbeat, polling, close, and reconnection
- connected adapter/source summary
- complete snapshot sequencing
- durable runtime lifecycle before public plugin distribution
- canonical generated protocol fixtures

### Omarchy workstream

Own:

- manifest and QML
- process spawning and missing-binary state
- JSONL parsing and protocol-version checks
- bar posture and panel rendering
- Omarchy theme, keyboard, mouse, scaling, and overflow behavior
- Open Aperture shell handoff
- plugin validation and marketplace packaging

The Omarchy agent must not edit Aperture protocol fields. The Aperture agent must not implement QML in this repository.

## Aperture changes required

### `packages/aperture`

Add:

```text
packages/aperture/src/cli/surface.ts
packages/aperture/src/surface/protocol.ts
packages/aperture/src/surface/projection.ts
packages/aperture/src/surface/runtime-session.ts
packages/aperture/src/surface/stdio.ts
packages/aperture/test/surface-protocol.test.ts
packages/aperture/test/surface-lifecycle.test.ts
packages/aperture/test/surface-projection.test.ts
packages/aperture/test/surface-smoke.test.ts
```

Wire `surface` as a public root command in `packages/aperture/src/cli.ts` and CLI help.

The package build must include any public protocol schema artifact in `dist`.

### `packages/runtime`

Add the smallest host-neutral changes needed for:

- companion surface attachment that does not participate in global capability intersection
- a bounded runtime snapshot/source summary getter for the product surface process
- clean client close and error propagation usable by the reconnect owner

Do not expose private runtime URLs, token paths, or auth tokens through the public surface protocol.

### `packages/core`

No initial Core change is expected. Core already owns `AttentionView` and lane judgment.

Do not expose raw internal frame metadata merely to simplify the renderer projection.

### Deferred runtime-host work

Current launcher-owned runtimes close when the launcher/TUI exits. The initial prototype may require Aperture to remain running.

Public marketplace distribution is blocked until Aperture has a supported runtime/adapter host independent of the TUI, including restart and sleep/wake behavior.

Do not let the Omarchy bar process accidentally own this host lifecycle.

## Surface protocol

The canonical protocol will be owned here. The plugin repository's current files are provisional fixtures for parallel renderer work.

Output messages:

- `hello`
- `connection`
- `snapshot`
- `error`

The initial package capabilities do not advertise responses or engagement.

The surface protocol must:

- use UTF-8 JSON Lines
- keep stdout machine-clean
- emit diagnostics on stderr
- send complete snapshots, not patches
- include a protocol version
- use monotonic snapshot sequence within one process generation
- publish bounded source summaries
- publish a bounded surface frame DTO
- omit arbitrary metadata, private paths, control URLs, and secrets
- recover from malformed internal data without emitting false calm
- reconnect after runtime replacement and token rotation

## Surface projection

The renderer needs a public projection, not raw internal `AttentionFrame` serialization.

Allow only explicit fields required by the initial snapshot capability:

- stable frame/task/interaction identity
- version
- mode, tone, consequence
- title and summary
- bounded source kind/label
- bounded context items
- why-now copy
- timing

Do not include `metadata` or `responseSpec` in the initial snapshot capability.

The projection uses `now`, `next`, and `ambient`. UI copy should retain Ambient rather than rename it Later.

## Companion surface semantics

The desktop surface is a companion. Attaching it must not narrow global Core planning for the TUI or another richer surface.

Do not declare unsupported capabilities as true merely because the panel can launch the TUI.

The runtime contract distinguishes a companion from a planning participant. Companion surfaces may gain response and engagement capabilities in later package releases. This is a release gate, not optional polish.

## Runtime connection state machine

The surface process owns one serialized state machine:

```text
discover
  -> connect
  -> attach companion
  -> emit complete snapshot
  -> poll/heartbeat
  -> report failure
  -> close old client
  -> rediscover
  -> reattach
```

Prevent overlapping reconnect loops from heartbeat and poll failures.

Start and remain alive when no runtime exists. Emit honest disconnected state and bounded retry behavior.

## CLI shape

Target:

```bash
aperture surface --stdio --label omarchy-attention
```

This is a public product command, not `aperture internal ...`.

The process does not start a second runtime automatically in the initial surface workstream.

## Work packets

### Packet A: protocol and projection

- define TypeScript DTOs
- define runtime validators and JSON Schema
- build bounded projection
- add canonical fixtures
- prove no metadata/secrets cross the boundary

### Packet B: companion runtime attachment

- add companion role
- exclude companions from capability intersection
- expose bounded source summary
- characterize attach/heartbeat/detach behavior

### Packet C: stdio lifecycle

- add CLI command
- implement discovery and reconnect state machine
- emit hello/connection/snapshot/error
- guard stdout and stderr
- handle EOF, signals, and EPIPE

### Packet D: tests and package proof

- protocol ordering and version
- disconnected startup
- unchanged-view suppression
- runtime replacement and token change
- malformed projection behavior
- clean close
- npm package smoke and CLI help

### Packet E: durable host, after prototype

- define supported always-on runtime/adapter ownership
- provide install/start/stop/status behavior
- verify sleep/wake and restart
- keep TUI as a client rather than lifecycle owner

## Coordination rules

Aperture protocol changes are canonical only after they land in this repository.

When the Omarchy agent requests a change:

1. Read `/Users/tom/dev/omarchy-aperture/COORDINATION.md`.
2. Accept or reject the smallest requested contract addition.
3. Update schema and canonical fixtures here.
4. Record protocol-version impact.
5. Give the plugin agent the Aperture commit.
6. The plugin agent updates `PROTOCOL_BASELINE` and replaces draft fixtures.

Never support drift with renderer-local aliases.

## Initial capability non-goals

- no inline actions
- no awaitable submit/engage refactor
- no form/choice/approval capability claims
- no provider-specific QML
- no arbitrary metadata
- no automatic runtime startup owned by the QML process
- no remote/cloud transport
- no project dashboard or orchestration

## Aperture acceptance criteria

- `aperture surface --stdio` is public and documented
- hello is first
- disconnected startup remains alive
- companion attach leaves aggregate planning capabilities unchanged
- snapshots are complete, bounded, ordered, and schema-valid
- source summary is sufficient for the panel header
- unchanged views are not emitted repeatedly without reconnect/refresh cause
- runtime replacement rediscovery refreshes token and URL internally
- stdout is JSONL only
- stderr and messages contain no token or private control path
- internal metadata never crosses the surface DTO
- close detaches and exits cleanly
- external package smoke exercises the shipped CLI artifact

## Public distribution gates

The Omarchy plugin should not be listed publicly until:

- this protocol is released in `@tomismeta/aperture`
- the plugin is verified against the released artifact, not a workspace link
- companion capability behavior is proven
- a durable Aperture host exists
- install/PATH guidance is tested on Omarchy
- real Now decisions are quiet enough for an always-visible bar surface

## References

- [Aperture architecture overview](../product/architecture-overview.md)
- [Aperture host-neutral ingestion contract](../product/host-neutral-ingestion-contract.md)
- [Aperture TUI lane semantics](../product/tui.md)
- [Aperture Core SDK](../../packages/core/README.md)
- [Omarchy shell plugins](https://omarchy.org/manual/shell-plugins/)
- [Omarchy Agents plugin](https://github.com/omacom/omarchy/tree/quattro/shell/plugins/agents)
- [Quickshell Process](https://quickshell.org/docs/v0.3.0/types/Quickshell.Io/Process/)
