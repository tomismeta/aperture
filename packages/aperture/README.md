<div align="center">

# Aperture

**The attention surface for agent work.**

[![npm version](https://img.shields.io/npm/v/%40tomismeta%2Faperture?label=npm&color=2563eb)](https://www.npmjs.com/package/@tomismeta/aperture)
[![npm aperture core](https://img.shields.io/npm/v/%40tomismeta%2Faperture-core?label=aperture%20core&color=0f766e)](https://www.npmjs.com/package/@tomismeta/aperture-core)
[![license](https://img.shields.io/badge/license-MIT-6f42c1)](https://github.com/tomismeta/aperture/blob/main/LICENSE)
[![github](https://img.shields.io/badge/github-tomismeta%2Faperture-18181b)](https://github.com/tomismeta/aperture)

<img src="https://raw.githubusercontent.com/tomismeta/aperture/main/docs/assets/demo.gif" alt="Aperture demo" width="1100">
<p></p>

</div>

`@tomismeta/aperture` is the Claude-first live attention surface, with OpenCode
supported and Codex available as an opt-in experimental product path.

It runs as a local CLI/TUI product. Start it with `aperture`, connect your
agent surfaces, and keep approvals, follow-up questions, failures, and blocked
work in one place.

The latest npm release is `0.5.0`. This `main` README describes the `0.10.0`
release candidate and can lead the published package until that candidate ships.

## Start Here

Most people should start with `@tomismeta/aperture`.

Use this package when you want:

- the local CLI/TUI product
- one shared attention surface for agent work
- built-in Claude Code and OpenCode integration
- opt-in experimental Codex hooks from the local product CLI
- one place to review approvals, follow-ups, failures, and blocked work

If you want to embed Aperture's judgment engine inside your own host or
workflow instead, use `@tomismeta/aperture-core`.

## Install

```bash
npm install -g @tomismeta/aperture
```

## Quick Start

Launch Aperture:

```bash
aperture
```

If you use Claude Code, Aperture prepares Claude on first launch. Restart
Claude Code after the first run and confirm `/hooks` loaded.

If you want OpenCode, run:

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
```

Then launch Aperture:

```bash
aperture
```

Codex support is experimental and opt-in. A normal `aperture` launch does
not install Codex hooks or start the Codex hook bridge; use both commands
below when you want Codex live in Aperture:

```bash
aperture codex connect --global
aperture --codex
```

Codex hook entries capture the active hook bridge URL when they are
installed. If you customize `APERTURE_CODEX_HOOK_HOST`,
`APERTURE_CODEX_HOOK_PORT`, `APERTURE_CODEX_HOOK_PATH`, or
`APERTURE_CODEX_HOOK_URL`, run `aperture codex connect` with the same
environment and restart Codex so it reloads the updated command. Codex
requires user hook trust, so review and trust the entries in `/hooks` before
expecting them to run.

## What You Get

- a local CLI/TUI product, not just an SDK
- one shared attention surface for Claude Code and OpenCode, plus opt-in Codex hooks
- `now`, `next`, and `ambient` lanes for human attention
- approvals, follow-ups, failures, and blocked work in one place
- doctor, config, debug, completion, and uninstall commands
- replayable capture bundles for troubleshooting real sessions

## Optional Local Integration

Running Aperture also exposes a local product ingress path for advanced
integrations. If you need to send external work into a running Aperture
instance, see the host-neutral `/work` contract in
[docs/product/host-neutral-ingestion-contract.md](https://github.com/tomismeta/aperture/blob/main/docs/product/host-neutral-ingestion-contract.md).

For a supported programmatic integration, import `@tomismeta/aperture/work`.
It exposes the current Work `1.0` types, schemas, local-runtime discovery, and
bounded publish/response client without exposing the private Runtime package.

```ts
import { connectWork } from "@tomismeta/aperture/work";

const authToken = process.env.APERTURE_RUNTIME_TOKEN;
if (!authToken) throw new Error("Set APERTURE_RUNTIME_TOKEN before connecting.");

const work = await connectWork({
  baseUrl: "http://127.0.0.1:4546",
  authToken,
});

await work.publish({
  kind: "work.updated",
  work: { id: "task:deploy-42", status: "waiting", summary: "Waiting for approval." },
});
```

`readResponse` returns a state-discriminated `WorkResponse`. Narrow on
`state === "answered"` before reading `response`; pending, expired, and
cancelled responses expose only the fields valid for those states.

If you are troubleshooting a real session from the repo, the quickest bridge
from a captured bundle into offline review is documented in
[docs/lab/capture-review-quickstart.md](https://github.com/tomismeta/aperture/blob/main/docs/lab/capture-review-quickstart.md).

## The Loop

```text
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+
|  Arrive   | -> |  Translate  | -> |    Judge    | -> |    Show     | -> |   Respond   |
|  events   |    |    facts    |    |  attention  |    |   surface   |    |   action    |
+-----------+    +-------------+    +-------------+    +-------------+    +-------------+

agent hooks       explicit facts      does this         what the          operator decision
and server        from raw payloads   deserve           operator          carried back
events                                attention now?    actually sees     to the tool
```

If you only remember one thing, remember this:

`agent events in -> attention surface out -> human response back`

## Common Commands

```bash
aperture
aperture --capture
aperture doctor
aperture config
aperture debug
aperture completion zsh
aperture surface --stdio --label desktop-attention
aperture --version
aperture help
aperture help opencode
aperture help codex
aperture help uninstall
```

## External Surfaces

`aperture surface --stdio` exposes a bounded JSONL surface protocol for local
companion renderers such as desktop bars. Aperture owns runtime discovery,
authentication, companion attachment, reconnection, and the projection from its
internal `AttentionView`.

The public surface hello reports `protocolVersion: 4` independently from the
installed package semver. Surface protocol v4 emits snapshots but accepts no
responses or engagement, and its frame schema contains no navigation property.
Any contract change requires a new exact protocol version. Arbitrary frame
metadata, focus handles, runtime URLs, token paths, and bearer tokens never
cross this public boundary.

Start an Aperture runtime first, then run:

```bash
aperture surface --stdio --label omarchy-attention
```

The process stays alive and reports an honest disconnected state while no local
runtime is available.

The self-contained Omarchy integration uses a separate bidirectional worker
contract. It does not attach to, discover, or require an Aperture runtime. The
dependency-free `dist/aperture-attention-engine.cjs` owns `ApertureCore`, state,
and the canonical XDG socket and targets the Node 22 runtime supplied by
Omarchy. Its canonical schemas are exported as:

- `@tomismeta/aperture/notification-worker-input.schema.json`
- `@tomismeta/aperture/notification-worker-output.schema.json`
- `@tomismeta/aperture/surface-protocol.schema.json`
- `@tomismeta/aperture/omp-attention-event.schema.json`
- `@tomismeta/aperture/worker-direct-message.schema.json`

`pnpm --dir packages/aperture build:attention-worker -- --output-dir <path>`
stages the bundle, schemas, hashes, and BUILDINFO for a host integration. The
worker is integration build input, not a user-facing Aperture command, and
requires no npm install or `node_modules` on the target machine.
For an unsigned local development payload, use
`pnpm --dir packages/aperture build:attention-worker:development -- --output-dir <path>`.
Its BUILDINFO records `payloadProfile: "development"` and the exact volatile
focus-coordinator contract.

The staged payload also includes a private `@tomismeta/aperture-omp@0.1.0`
manifest and `integrations/omp/aperture-omp-extension.mjs`, a first-class OMP
extension. When
the worker owns `$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`, the extension
sends bounded typed OMP events directly and suppresses the corresponding native
notification only after worker acknowledgement. The worker alone feeds those
facts into `ApertureCore`; Core remains the lane authority. If direct delivery
is unavailable, OMP falls back to its native notification outside the Aperture
surface. Shipping the extension does not automatically activate it in OMP.

The production bundle is fixed to `artifactMode: "omp-only"`. Its hello reports
`notificationInput: false`; generic notification inputs are rejected, legacy
notification state is removed without restore, and native fallback remains
outside the Aperture surface. The payload retains notification input schema `2`
only as a canonical protocol artifact. It uses private notification-worker
output schema `4`, public surface protocol `4`, OMP attention event schema `2`,
and private worker-direct protocol `4`. Both hello frames require
`protocolVersion: 4` independently from package semver. Only private worker
snapshots may carry navigation, and the exact shape is
`{ "kind": "opaque-focus", "handle": "…" }`; public surface frames cannot carry
focus handles. Activation returns only `focused`, `stale`, or `missing`.
Session identity remains a private event fact and is never executable
navigation.

Upgrade from older direct workers migrates unresolved OMP direct state schemas
`1` and `2` to schema `3` atomically with mode `0600`, while dropping executable
session navigation and all persisted focus-private facts. Migrated attention
restores non-navigable until a live focus capability registers.

Worker stdout is ASCII-only JSONL with non-ASCII JSON code units escaped and a
256 KiB encoded-line limit. Production worker and OMP extension artifacts are
minified and each must fit the 524,288-byte marketplace limit. BUILDINFO pins
this as `artifactLimits.maximumTextArtifactBytes: 524288` and records the
private version both at `ompPackageVersion` and
`integrations.omp.packageVersion`.

A host can run
`aperture-attention-engine.cjs --cleanup-owned-socket` after service teardown;
the mode starts no Core, engine, or server, retries active/replaced transient
states for at most 1,500 ms, and touches only an inactive, same-UID, unchanged
socket at the canonical XDG path.

## Product State

Aperture stores product-owned local state under:

```text
~/.aperture
```

That includes:

- OpenCode connection profiles
- launcher captures
- runtime discovery state
- learning state for the opinionated local runtime

Use `aperture config` to inspect the active `APERTURE.md`, learned
`MEMORY.md`, diagnostics, and suggested policy snippets. Suggestions are
read-only and human-applied; Aperture does not rewrite your preferences for you.

## Clean Uninstall

Before uninstalling the npm package, remove Aperture-owned local state and
installed hook entries:

```bash
aperture uninstall --yes
```

If you also installed project-local hooks, remove those too:

```bash
aperture uninstall --yes --project /path/to/project
```

Then remove the package itself:

```bash
npm uninstall -g @tomismeta/aperture
```

## Links

- npm package: [`@tomismeta/aperture`](https://www.npmjs.com/package/@tomismeta/aperture)
- SDK package: [`@tomismeta/aperture-core`](https://www.npmjs.com/package/@tomismeta/aperture-core)
- Release notes: [Aperture v0.5.0](https://github.com/tomismeta/aperture/blob/main/docs/releases/aperture-v0.5.0.md)
- GitHub repo: [tomismeta/aperture](https://github.com/tomismeta/aperture)
- Architecture overview: [docs/product/architecture-overview.md](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md)
