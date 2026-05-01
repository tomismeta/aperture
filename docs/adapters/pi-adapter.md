# Pi Adapter

This document describes the Pi source path for Aperture.

`@aperture/pi` translates Pi extension events into `SourceEvent` values and can
optionally hold Pi tool calls while waiting for an Aperture `AttentionResponse`.

## Status

The Pi adapter is experimental and source-only today.

It is intentionally not wired into the published `@tomismeta/aperture` product
launcher yet. That keeps the product package small while we validate the Pi
surface from source.

## Shape

Pi exposes a native extension system and SDK event surface. The adapter uses
that shape directly:

```text
Pi extension events
-> @aperture/pi mapping
-> SourceEvent
-> @aperture/runtime
-> ApertureCore
-> AttentionResponse
-> Pi tool_call result
```

The Pi SDK remains a peer/host dependency. Aperture does not bundle Pi into
core or into the product package.

The package exports a no-config default extension for Pi hosts that load
`./extension` directly. Use `createAperturePiExtension()` when you need a custom
runtime URL, label, timeout, or tool-call policy.

## Covered Events

The initial adapter maps:

- session start and shutdown
- accepted prompts and input events
- agent and turn lifecycle events
- model and thinking-level changes
- tool calls as approval requests
- tool execution start/update/end
- tool results
- user bash commands

## Response Behavior

The extension bridge supports three tool-call policies:

- `observe`: leave tool calls native and rely on execution lifecycle events
- `hold-if-surface`: hold only when an Aperture surface is attached
- `hold`: hold and fail closed if Aperture does not answer before timeout

This keeps the first version safe for observation while still proving the native
Pi response loop when we choose to enable it.

Successful tool-execution end/result events stay `status: "running"` because the
individual tool is done but the parent Pi session is usually still active.
Failures are mapped as failed task updates.

## Boundary Rules

- Pi-specific event names stay inside `@aperture/pi`
- Pi does not add concepts to `@tomismeta/aperture-core`
- the TUI only sees normalized `SourceEvent`/`AttentionFrame` state
- Pi package loading remains a host concern until the adapter is promoted into
  the product launcher
