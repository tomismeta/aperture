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

`@tomismeta/aperture` is the live attention surface for humans working with
agents like Claude Code, OpenCode, and opt-in experimental Codex sessions.

It runs as a local CLI/TUI product. Start it with `aperture`, connect your
agent surfaces, and keep approvals, follow-up questions, failures, and blocked
work in one place.

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

The hello message reports the installed Aperture package version and supported
surface capabilities. The initial capability set emits snapshots and does not
accept responses or engagement; later package releases can extend those
capabilities without renaming the command or protocol. Arbitrary frame metadata,
runtime URLs, token paths, and bearer tokens never cross the boundary.

Start an Aperture runtime first, then run:

```bash
aperture surface --stdio --label omarchy-attention
```

The process stays alive and reports an honest disconnected state while no local
runtime is available.

Desktop-shell integrations that own `ApertureCore` state use a separate
bidirectional notification-worker contract rather than attach to an existing
runtime. The dependency-free `dist/aperture-attention-engine.cjs` bundle targets
Node 22 and is intended to run on the Node runtime supplied by the host
platform. Its canonical schemas are exported as:

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


The staged payload also includes
`integrations/omp/aperture-omp-extension.mjs`, a first-class OMP extension. When
the worker owns `$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`, the extension
sends bounded typed session events directly and suppresses the duplicate native
notification only after worker acknowledgement. The worker alone feeds those
facts into `ApertureCore`; Core remains the lane authority. If the socket is
unavailable, the extension fails open to the existing `aperture-omp`
notification transport, whose projection remains Ambient-only and non-navigable.
Shipping the extension does not automatically activate it in OMP.

The direct cutover uses notification input schema `2`, notification output
schema `3`, surface protocol `3`, OMP attention event schema `2`, and private
worker direct protocol `4`. OMP attention events remain OMP-specific; generic
`focus.register` and `focus.revoke` messages carry bounded volatile focus control.
Navigable frames carry only `{ "kind": "opaque-focus", "handle": "…" }`;
activation returns only `focused`, `stale`, or `missing`. Session identity
remains a private event fact and is never executable navigation.

Upgrade from the v0.2 worker migrates unresolved OMP direct state schema `1`
to schema `2` atomically with mode `0600`, preserving session, interaction,
revision, and event order while dropping executable session navigation and all
focus-private facts. Migrated attention restores non-navigable until a live
focus capability registers. Rolling a schema-2 state directory back to v0.2 is
unsupported and fail-visible: the legacy worker reports corrupt-state recovery
before removing the unsupported file. Do not start v0.2 against a migrated
state directory; take an operator backup before rollback, then restore it and
roll forward to the next fully accepted signed worker release. v0.4.0 remains dogfood evidence.

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
