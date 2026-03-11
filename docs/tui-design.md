# TUI Design

This document defines the design direction for Aperture's terminal surface.

It is not a source-specific UI.

It is a source-agnostic attention surface above `@aperture/core`.

## Purpose

The TUI should make Aperture feel like:

- a calm operator surface
- a terminal-native attention companion
- a place where one human can manage many agent demands without switching contexts

It should not feel like:

- a chat transcript
- a dashboard stuffed into a terminal
- a log viewer
- a clone of any one upstream tool

## Reference Influences

The right design direction borrows from three families of terminal products:

### Claude Code

Borrow:

- minimal ceremony
- one thing that matters now
- immediate approval flow
- low-friction keyboard interaction

Do not borrow:

- single-source assumptions
- chat-centric layout

### OpenClaw

Borrow:

- operator-console posture
- persistent context
- stable status and footer areas
- overlays or progressive disclosure instead of permanent clutter

Do not borrow:

- source-heavy mental model
- full agent-console density as the default state

### Codex

Borrow:

- terminal-native density
- strong statusline and footer discipline
- compact review ergonomics
- inspection on demand instead of always-expanded detail

Do not borrow:

- source-specific workflow assumptions
- developer-tool chrome that competes with the attention model

## Core Attention Principles

These principles should drive the TUI more than visual taste.

### 1. Stable focal placement

The active frame should always occupy the same privileged location.

Why:

- attention is easier to sustain when the most important item appears in a stable place
- the operator should not have to visually search for the current demand

Implication:

- one persistent focus pane
- never scatter equivalent attention across multiple large panes

### 2. Peripheral awareness without competition

Queued and ambient work should remain visible, but should not compete equally with the active frame.

Why:

- the engine is trying to reduce switching cost, not just show everything
- visibility should support orientation, not steal attention

Implication:

- queued work should be compact
- ambient work should be even quieter
- both should feel peripheral

### 3. Stacking over spreading

When there are many pending items, prefer vertical stacking and ranking over broad horizontal spread.

Why:

- terminals are better at list density than dashboard grids
- ranking matters more than simultaneous expansion

Implication:

- use a compact queue rail or stack
- avoid many equal-sized “cards” in parallel

### 4. Progressive disclosure

Context, rationale, provenance, and detailed signal explanations should be inspectable, not always expanded.

Why:

- the operator needs calm by default
- explanation matters, but too much explanation becomes noise

Implication:

- default view: title, source, tone/consequence, summary, score
- reveal on demand: context items, rationale, provenance, signal/trend notes

### 5. Quiet ambient state

Ambient work should feel deliberately quiet.

Why:

- ambient items are “available,” not “demanding”
- the TUI should preserve trust that active means active

Implication:

- muted styling
- one-line or two-line summaries
- no large visual treatment for ambient items

## Screen Model

The TUI should converge toward this structure:

### Top statusline

Shows:

- active count
- queued count
- ambient count
- current global attention state
- maybe current source/session summary

Purpose:

- orient quickly
- no scrolling required

### Focus pane

Shows exactly one active frame.

Default visible:

- title
- source
- mode
- tone
- consequence
- summary
- important context items
- score and score offset
- primary actions

Optional:

- rationale
- provenance
- richer context

Purpose:

- this is the main decision surface

### Queue rail

Shows ranked queued items.

Default visible:

- title
- source
- score
- one-line summary

Purpose:

- preserve awareness of what is next
- avoid making the operator inspect everything at once

### Ambient strip

Shows low-demand work.

Default visible:

- title
- source
- maybe severity marker

Purpose:

- “still happening, not worth interrupting”

### Footer

Shows:

- keybindings
- transient status
- mode-specific hints

Purpose:

- reduce command recall cost
- preserve keyboard-first flow

## Visual Hierarchy

### Primary emphasis

Use emphasis for:

- the active frame
- primary action
- critical tone

### Secondary emphasis

Use moderate emphasis for:

- queued ranking
- selected queue item if browsing is added

### Muted emphasis

Use muted treatment for:

- ambient work
- supporting metadata
- rationale that is not expanded

### Density target

The TUI should be denser than the current prototype.

That means:

- less empty space
- fewer large boxes
- more list-like scanning
- more stable line rhythm

It should feel closer to a serious terminal tool than a browser card layout moved into a terminal.

## Aesthetic Analysis

The most useful terminal references converge on a shared idea:

- the terminal should feel authored, not merely rendered
- the layout should make one thing feel primary without flooding the screen
- ornament should clarify posture, not compete with work

### Claude Code

Claude Code's strongest aesthetic move is restraint.

It uses a calm neutral substrate and keeps the chrome disciplined enough that action lines feel immediate.

The lesson for Aperture:

- keep the global frame quiet
- spend emphasis on the current demand
- make approvals and input flows feel frictionless

### Codex

Codex feels denser and more operational.

Its strength is not decoration but control surfaces: status, footer discipline, and a feeling that inspection is always nearby without being fully expanded.

The lesson for Aperture:

- preserve compact status and control rails
- avoid chat-style sprawl
- let detail appear inside a strong operator frame

### OpenClaw

OpenClaw points toward the "agent console" family of TUIs: persistent context, stable boundaries, and an overall operator posture.

The lesson for Aperture:

- maintain a persistent console identity
- keep the frame stable even as content changes
- imply system continuity, not transient chat turns

### Lazygit and K9s

These tools show why popular TUIs remain readable under pressure.

They use strong pane borders, consistent scanlines, aggressive keyboard affordance, and a queue-like sense of rank and locality.

The lesson for Aperture:

- hierarchy should come from structure before color
- queue items should read in one fast pass
- the footer should lower recall cost

### btop and Glow

btop proves that terminals can carry ornament when the ornament is systematic. Glow proves that text surfaces can feel beautiful through rhythm, spacing, and typography alone.

The lesson for Aperture:

- add a recognizable brand layer
- keep color rules limited and semantic
- let whitespace and line rhythm do more than extra boxes

### Obsidian

Obsidian is not a TUI, but it is useful as an aesthetic reference because it makes knowledge feel spatial, moody, and personal instead of purely utilitarian.

The lesson for Aperture:

- give the surface identity
- let the product feel like an environment, not just a widget
- preserve a slight sense of mystique around the system as a whole while keeping the current task explicit

## New Aesthetic Read

The linked "New Aesthetics" note argues that modern interfaces are moving toward a neutral comfort substrate while expression becomes more ambient, individualized, and layered on top.

That is the right model for Aperture.

The TUI should not become a maximalist sci-fi cockpit.

It should become:

- a neutral operator substrate
- with a distinct branded masthead
- with just enough surface character to feel intentional
- while the active frame carries the strongest authored treatment

In other words:

- the shell is calm
- the focal pane is expressive
- queued and ambient work stay present but peripheral

This is the aesthetic target for the next pass.

## Visual Direction

The immediate visual target is a calm observatory.

That means:

- a neutral shell with a cool purple/blue accent family
- a compact aperture mark (`/·\` `\·/`) and wordmark, not a noisy logo block
- rounded borders only where the active frame deserves extra presence
- one accent color (bright purple) for brand, keys, scores, and ranks
- focused tone in blue, critical tone in bright purple, ambient in gray
- progressively dimmer treatment from active to queued to ambient
- footer pinned to terminal bottom, masthead pinned to top

The desired emotional effect is:

- active feels illuminated
- queued feels nearby
- ambient feels safely out of focus

## Interaction Model

The TUI should be keyboard-first and compact.

### Global controls

- `q` quit
- `?` help
- `tab` switch sections or disclosure state

### Approval controls

- `a` approve
- `r` reject
- `x` dismiss/defer if supported

### Choice controls

- number keys to select

### Form controls

- `i` begin input
- `enter` advance / submit
- `esc` cancel

### Inspection controls

Potential later additions:

- `space` expand rationale/context
- `p` toggle provenance
- `j/k` browse queued items in a richer rail

## What the TUI Should Communicate

The operator should always be able to answer:

- what needs my attention now
- what is next
- what is safe to ignore for the moment
- why Aperture chose this

The operator should not have to infer:

- whether the source matters
- whether the queue is ordered
- whether the current item is blocking
- whether the quiet items are truly low-demand or just hidden by accident

## Relationship To The Engine

The TUI is a surface, not a decision layer.

It should consume:

- `AttentionView`
- `Frame`
- `FrameResponse`

It should not:

- rescore items
- reorder items independently
- apply source-specific logic
- invent alternate attention semantics

The TUI can choose how to *express*:

- active
- queued
- ambient

But it should not reinterpret what those mean.

## Current Gaps In The Prototype

The current TUI prototype proves the basic loop, but it is not yet the intended design.

Current weaknesses:

- too much card-like structure
- too much whitespace
- queue and ambient work are too visually similar
- rationale and context are not yet progressive enough
- top-level status/orientation is too weak

## Near-Term TUI Direction

The next TUI pass should do this:

1. add a real statusline
2. replace the current multi-block layout with:
   - one focus pane
   - one compact queue rail
   - one thin ambient strip
3. make explanation collapsible
4. reduce whitespace and visual chrome
5. preserve full source agnosticism

## Standard For Good

A good Aperture TUI should feel:

- calm
- precise
- dense without being noisy
- terminal-native
- trustworthy

The user should feel:

- “I know what to handle now”
- not “I am looking at another dashboard”
