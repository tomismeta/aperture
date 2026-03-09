# Frame

## Purpose

A `Frame` is the atomic interaction contract emitted by `Aperture Core`.

It is intentionally small:

- enough to describe what the human should understand now
- enough to describe how the human can respond
- not a UI component tree
- not a cross-task grouping object

Grouped attention state lives in `TaskView` and `AttentionView`.

## Current Contract

```ts
type FrameMode = "status" | "approval" | "choice" | "form";

type FrameTone = "ambient" | "focused" | "critical";

type ConsequenceLevel = "low" | "medium" | "high";

type Frame = {
  id: string;
  taskId: string;
  interactionId: string;
  version: number;
  mode: FrameMode;
  tone: FrameTone;
  consequence: ConsequenceLevel;
  title: string;
  summary?: string;
  context?: FrameContext;
  responseSpec?: FrameResponseSpec;
  provenance?: FrameProvenance;
  timing: FrameTiming;
  metadata?: Record<string, unknown>;
};
```

## Design Constraints

- `Frame` carries semantics, not presentation.
- `Frame` should be stable across CLI and other host surfaces.
- `Frame` should stay small enough that developers can reason about it quickly.
- `Frame` should only represent one bounded human moment.

## Supporting Types

```ts
type FrameContext = {
  stage?: string;
  progress?: number;
  items?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};

type FrameResponseSpec =
  | { kind: "none" }
  | {
      kind: "approval";
      actions: FrameAction[];
      requireReason?: boolean;
    }
  | {
      kind: "choice";
      selectionMode: "single" | "multiple";
      options: FrameOption[];
      actions: FrameAction[];
    }
  | {
      kind: "form";
      fields: FrameField[];
      actions: FrameAction[];
    };

type FrameAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss";
  emphasis: "primary" | "secondary" | "danger";
};
```

```ts
type FrameOption = {
  id: string;
  label: string;
  summary?: string;
};

type FrameField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};

type FrameProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};

type FrameTiming = {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};
```

## Response Contract

`FrameResponse` is the return path back into the engine:

```ts
type FrameResponse = {
  taskId: string;
  interactionId: string;
  response:
    | { kind: "approved"; reason?: string }
    | { kind: "rejected"; reason?: string }
    | { kind: "option_selected"; optionIds: string[] }
    | { kind: "form_submitted"; values: Record<string, unknown> }
    | { kind: "dismissed" };
};
```

## Grouped Views

`Frame` is not the whole host-facing model.

```ts
type TaskView = {
  active: Frame | null;
  queued: Frame[];
  ambient: Frame[];
};

type AttentionView = {
  active: Frame | null;
  queued: Frame[];
  ambient: Frame[];
};
```

Use them like this:

- `Frame`: one interaction
- `TaskView`: one task's local coordination state
- `AttentionView`: cross-task attention state
