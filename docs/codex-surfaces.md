# Codex Surfaces

This note explains the current Codex integration paths around the new
`@aperture/codex` adapter:

- why a normal `codex` terminal session does not automatically appear in Aperture
- what a terminal-supervised Codex workflow looks like today
- what a macOS-native Codex + Aperture experience would look like
- which path should come next

The goal is to keep Aperture's boundaries clean:

- Codex owns execution
- Aperture owns attention judgment
- core remains unchanged

## Current State

The repo now has a working Codex App Server adapter:

- [packages/codex/src/client.ts](../packages/codex/src/client.ts)
- [packages/codex/src/bridge.ts](../packages/codex/src/bridge.ts)
- [packages/codex/src/mapping.ts](../packages/codex/src/mapping.ts)
- [scripts/codex-adapter.ts](../scripts/codex-adapter.ts)

What works today:

- `codex app-server` can be connected to `@aperture/runtime`
- attention-significant App Server requests can become `SourceEvent`
- Aperture responses can map back into Codex server-request responses
- the adapter can be started with `pnpm codex:start`
- a supervised Codex session runner exists with `pnpm codex:run`
- the full local stack can be started with `pnpm aperture --codex`
- a real approval round trip has been live-verified through the TUI

What does **not** exist yet:

- a way for the stock interactive `codex` terminal UI to automatically route
  through Aperture
- a shared App Server path across Codex clients like macOS app, TUI, and IDEs
- a stronger App Server interruption contract for human-relevant mid-turn hooks
- a macOS-native Codex host that uses the adapter as its event and response
  layer

That is the key distinction:

**we now have the adapter layer and a real terminal-supervised runner, but not
yet a shared Codex client path across product surfaces.**

## Why The Stock Codex Terminal Does Not Show Up In Aperture

The normal `codex` terminal UI is its own product surface.

Even if Aperture's Codex adapter is running, Aperture only sees Codex activity
that goes through this path:

```text
Codex App Server
-> @aperture/codex
-> @aperture/runtime
-> ApertureCore
-> TUI
```

The stock `codex` terminal you launch directly is not yet being run through a
host that forwards those events into Aperture in a way we control.

So the missing piece is not the adapter. The missing pieces are the **shared
Codex client path** above the adapter and the **interruption semantics** that
external clients can reliably build around.

## Two Real Product Paths

There are two credible ways to make Codex feel integrated with Aperture.

### 1. Terminal-Supervised Codex

This path keeps the product terminal-native.

The user launches a new Aperture-aware Codex workflow instead of launching the
stock `codex` UI directly.

#### Shape

```text
Aperture Codex session runner
-> Codex App Server client
-> thread/start
-> turn/start / turn/steer
-> Codex emits requests and notifications
-> @aperture/codex maps them into runtime
-> Aperture TUI becomes the attention surface
```

#### What this product does today

- start or resume Codex threads
- send prompt/input items into a turn
- keep the App Server connection alive while the turn runs
- let Aperture handle:
  - approvals
  - explicit questions when Codex emits them
  - prioritization across multiple Codex threads
  - now / next / ambient supervision

#### Minimal UX

The lightest version is not a full terminal replacement. It is a
**session launcher**:

- `pnpm codex:run`

That launcher now:

1. create or resume a Codex thread
2. start a turn with structured input
3. keep the App Server connection alive
4. send attention-significant requests into Aperture
5. let the TUI act as the human attention surface

#### Why this is attractive

- smallest footprint
- closest to what we already built
- easiest way to get real operator testing
- keeps Aperture in its strongest medium: terminal supervision

#### What is still missing

- a richer prompt/input UX than plain CLI args
- more live-verified request families beyond approval flows
- stronger guarantees around when Codex will emit requestUserInput versus plain
  assistant text
- a decision on how much Codex output to mirror locally versus leave inside
  Codex

### 2. macOS-Native Codex + Aperture

This path treats Aperture as the supervisor above a native desktop Codex
experience.

#### Shape

```text
macOS app
-> @aperture/codex client
-> Codex App Server
-> runtime
-> ApertureCore
-> native desktop attention surfaces
```

#### What this product would do

- run or attach to Codex threads from a native macOS shell
- show:
  - active work
  - waiting approvals
  - queued review requests
  - ambient completions
- open richer detail panes for:
  - file changes
  - command approvals
  - review findings
  - multi-question prompts

#### What makes this interesting

- Codex already has strong machine-readable workflow primitives
- macOS is better than a plain terminal for:
  - thread lists
  - file diffs
  - review results
  - stacked attention surfaces
  - detached inspection panes

#### What makes it more expensive

- more product surface area
- native app state management
- more design work before we learn enough
- bigger risk of building too much host UI before validating the workflow

## Recommended Build Order

I recommend this order:

### First: terminal-supervised Codex

Keep hardening the smallest useful host above the adapter:

- thread start / resume
- turn start / steer
- one clear operator loop through the TUI
- more verified request families and better observed behavior docs

This gets us:

- real Codex supervision
- real Aperture attention routing
- real feedback on whether the workflow is good

without committing us to a large UI investment.

### Second: macOS-native host

Once the session runner proves the operator model, build the desktop layer
around the same adapter and runtime.

That way:

- the adapter stays the source boundary
- Aperture core stays unchanged
- the macOS surface is just a richer host above the same system

## Clean Boundary Rules

These should stay true in both paths.

### Codex owns

- thread lifecycle
- turn lifecycle
- item stream
- execution and sandboxing
- review execution
- native approval semantics

### Aperture owns

- mapping Codex events into `SourceEvent`
- attention judgment
- cross-thread prioritization
- now / next / ambient presentation
- response routing back into matching Codex requests

### Core should not learn about

- thread/start
- turn/start
- turn/steer
- Codex-specific input item types
- App Server JSON-RPC details
- macOS UI concepts

Those stay in:

- [packages/codex/src/client.ts](../packages/codex/src/client.ts)
- [packages/codex/src/bridge.ts](../packages/codex/src/bridge.ts)
- future host/client packages or scripts

## What To Build Next For Terminal

The next concrete milestone should be a minimal Codex host flow.

### Suggested milestone: `codex:run`

Responsibilities:

1. connect to a runtime
2. start or resume a Codex thread
3. send structured input into `turn/start`
4. keep App Server running in the background
5. let the TUI handle all attention-worthy requests

### Suggested CLI shape

```text
pnpm codex:run --cwd /path/to/repo --prompt "Fix the failing test and explain the change"
```

Optional later flags:

- `--resume <thread-id>`
- `--model <name>`
- `--effort <low|medium|high|xhigh>`
- `--review uncommitted`
- `--json-schema <path>`

### What not to do yet

- do not build a full Codex terminal clone
- do not stream every token or delta into Aperture
- do not change `@tomismeta/aperture-core`

## What To Build Later For macOS

Once terminal-supervised Codex is useful, the macOS host can focus on the
surfaces terminals handle poorly.

Good candidates:

- thread list
- approval inbox
- diff and review panes
- persistent "why did this surface?" inspection
- detached review and compare windows

The macOS app should still use:

- `@aperture/codex` for Codex protocol
- `@aperture/runtime` for shared state
- `ApertureCore` as-is

## Short Recommendation

If the goal is to make Codex + Aperture real quickly:

1. keep the new adapter exactly where it is
2. keep using **terminal-supervised Codex** as the main learning path
3. validate more real request families and interruption semantics there
4. only then expand into a macOS-native host

That is the smallest path that:

- keeps boundaries clean
- uses the Codex App Server strengths
- avoids touching core
- gives us a real user path instead of just an adapter foundation
