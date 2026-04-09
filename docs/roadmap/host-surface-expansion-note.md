# Host Surface Expansion Note

This note captures one near-term SDK opportunity that sits beyond the
opinionated local TUI: hosts that are conversational, audio-friendly,
chat-based, mobile, remote, or otherwise not shaped like the default Aperture
terminal surface.

Examples include:

- a tui-native coding agent with a conversational shell interface
- a TTS/STT notification path for terminal agents
- a chat or plugin host that binds to an existing agent session

This is not a different product direction from core Aperture.

It is one expression of the broader direction that Aperture should operate as a
host-neutral attention and control plane across many host and surface shapes.

## Why This Matters

Aperture already has the right core loop for alternate hosts:

- neutral ingestion event or `SourceEvent` in
- `AttentionFrame` or `AttentionView` out
- `AttentionResponse` back in

For generalized host ingestion:

- external hosts or APIs should ideally publish a neutral ingestion event
- internal adapters should map into `SourceEvent`
- then the core path is:
  - raw host event -> neutral ingestion event -> `SourceEvent` -> canonical
    core meaning -> judgment

That is the seam that should let many future hosts integrate without each
inventing a different core-facing protocol.

That loop is small enough to embed in:

- conversational terminal hosts
- audio-first notification surfaces
- chat or plugin surfaces
- remote check-in workflows

The main gap is not that the engine cannot support these hosts.

The gap is that the engine still assumes a richer attention surface than some
alternate hosts can actually render or accept.

## What Additional Capabilities Would Help

### 1. Surface capability modeling

This is the highest-leverage next step.

The host should be able to declare constraints such as:

- whether it can render ambient items at all
- whether it can only present one active item at a time
- whether it supports structured choices
- whether it supports forms or only short replies
- how much summary/detail it can reasonably present

The planner should respect those constraints rather than assuming the default
TUI surface.

### 2. Response affordance hints

Some hosts need more guidance about how to ask the human for a response.

Examples:

- yes/no confirmation
- choose one option
- short spoken summary first
- ask for freeform text only as a fallback

These hints should help the host render or speak the right affordance without
putting TTS/STT-specific logic into core.

### 3. Session continuity helpers

Alternate hosts care a lot about continuity:

- which task or thread is this for
- what changed since the human last checked in
- whether the interruption is still actionable

The SDK should make that continuity easier to surface cleanly.

### 4. Subagent and multi-actor awareness

As agent frameworks expose more subagents and delegated work, Aperture should be
careful not to flood a lightweight host with child-level noise.

The engine should eventually understand:

- parent versus child work
- grouped waiting states
- when a higher-level summary is better than many separate interruptions

## What Should Not Go Into Core

The SDK should stay disciplined.

Do not add host-specific integrations such as:

- Discord or Telegram logic
- TTS provider implementations
- STT provider implementations
- transport servers for every host type

Those belong in adapters, plugins, or examples.

Core should own the judgment loop and the host-capability seam, not every host.

## Recommended Order

1. add surface capability modeling
2. add one non-default host example
3. add lightweight response/render hints
4. deepen continuity and subagent handling after real usage

## Suggested First Proof

The best first proof is not a new product package.

It is one example host that keeps its own interface while delegating attention
planning to `@tomismeta/aperture-core`.

The example should prove:

- a host can publish events into Aperture
- the host can render `now`, `next`, or `ambient` in its own style
- the host can submit human responses back into the same loop
- the host can stay useful even when it is more constrained than the default TUI

## Recommendation

Treat this as a medium-priority SDK maturation path.

It should follow the current flagship live-source work, but it is a strong next
step once the team is ready to prove Aperture in a second host shape beyond the
opinionated TUI.
