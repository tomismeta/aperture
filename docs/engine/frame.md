# Attention Frame

## Purpose

An `AttentionFrame` is the atomic interaction contract emitted by `Aperture Core`.

It is intentionally small:

- enough to describe what the human should understand now
- enough to describe how the human can respond
- not a UI component tree
- not a cross-task grouping object

Grouped attention state lives in `AttentionTaskView` and `AttentionView`.

## Current Contract

```ts
type AttentionFrameMode = "status" | "approval" | "choice" | "form";

type AttentionTone = "ambient" | "focused" | "critical";

type AttentionConsequenceLevel = "low" | "medium" | "high";

type AttentionFrame = {
  id: string;
  taskId: string;
  interactionId: string;
  version: number;
  mode: AttentionFrameMode;
  tone: AttentionTone;
  consequence: AttentionConsequenceLevel;
  title: string;
  summary?: string;
  context?: AttentionContext;
  responseSpec?: AttentionResponseSpec;
  provenance?: AttentionProvenance;
  timing: AttentionTiming;
  metadata?: Record<string, unknown>;
};
```

## Design Constraints

- `AttentionFrame` carries semantics, not presentation.
- `AttentionFrame` should be stable across CLI and other host surfaces.
- `AttentionFrame` should stay small enough that developers can reason about it quickly.
- `AttentionFrame` should only represent one bounded human moment.

## Supporting Types

```ts
type AttentionContext = {
  stage?: string;
  progress?: number;
  items?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};

type AttentionResponseSpec =
  | { kind: "none" }
  | {
      kind: "acknowledge";
      actions: AttentionAction[];
    }
  | {
      kind: "approval";
      actions: AttentionAction[];
      requireReason?: boolean;
    }
  | {
      kind: "choice";
      selectionMode: "single" | "multiple";
      options: AttentionOption[];
      actions: AttentionAction[];
    }
  | {
      kind: "form";
      fields: AttentionField[];
      actions: AttentionAction[];
    };

type AttentionAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss" | "acknowledge";
  emphasis: "primary" | "secondary" | "danger";
};
```

```ts
type AttentionOption = {
  id: string;
  label: string;
  summary?: string;
};

type AttentionField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};

type AttentionProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};

type AttentionTiming = {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};
```

## Response Contract

`AttentionResponse` is the return path back into the engine:

```ts
type AttentionResponse = {
  taskId: string;
  interactionId: string;
  response:
    | { kind: "acknowledged" }
    | { kind: "approved"; reason?: string }
    | { kind: "rejected"; reason?: string }
    | { kind: "option_selected"; optionIds: string[] }
    | { kind: "form_submitted"; values: Record<string, unknown> }
    | { kind: "dismissed" };
};
```

## Grouped Views

`AttentionFrame` is not the whole host-facing model.

```ts
type AttentionTaskView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};

type AttentionView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};
```

Use them like this:

- `AttentionFrame`: one interaction
- `AttentionTaskView`: one task's local coordination state
- `AttentionView`: cross-task attention state
