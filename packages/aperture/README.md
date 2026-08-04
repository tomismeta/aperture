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
aperture --version
aperture help
aperture help opencode
aperture help codex
aperture help uninstall
```

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
- Release notes: [Aperture v0.4.3](https://github.com/tomismeta/aperture/blob/main/docs/releases/aperture-v0.4.3.md)
- GitHub repo: [tomismeta/aperture](https://github.com/tomismeta/aperture)
- Architecture overview: [docs/product/architecture-overview.md](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md)
