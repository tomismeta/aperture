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
agents like Claude Code and OpenCode.

It runs as a local CLI/TUI product. Start it with `aperture`, connect your
agent surfaces, and keep approvals, follow-up questions, failures, and blocked
work in one place.

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

## What You Get

- a local CLI/TUI product, not just an SDK
- one shared attention surface for Claude Code and OpenCode
- `now`, `next`, and `ambient` lanes for human attention
- approvals, follow-ups, failures, and blocked work in one place
- doctor, debug, completion, and uninstall commands
- replayable capture bundles for troubleshooting real sessions

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
aperture debug
aperture completion zsh
aperture --version
aperture help
aperture help opencode
aperture help uninstall
```

## Start Here

Most people should start with `@tomismeta/aperture`, not the SDK.

Use this package if you want:

- the local product
- the TUI
- Claude Code and OpenCode integration
- one place for the agent work that needs you

Use `@tomismeta/aperture-core` if you want to build your own runtime, adapter,
or surface around Aperture's judgment engine.

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

## Clean Uninstall

Before uninstalling the npm package, remove Aperture-owned local state and
Claude hook entries:

```bash
aperture uninstall --yes
```

If you also installed project-local Claude hooks, remove those too:

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
- Release notes: [Aperture v0.1.1](https://github.com/tomismeta/aperture/blob/main/docs/releases/aperture-v0.1.1.md)
- GitHub repo: [tomismeta/aperture](https://github.com/tomismeta/aperture)
- Architecture overview: [docs/product/architecture-overview.md](https://github.com/tomismeta/aperture/blob/main/docs/product/architecture-overview.md)
