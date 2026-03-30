# F-Stop Session Format

The canonical trace/session input file for F-Stop is a **F-Stop Session**
JSON document.

This is the standard landing shape for imported outside traces before they
become replayable session files for deterministic execution.

The pipeline should be:

1. raw export
2. F-Stop Session JSON
3. replayable session file
4. offline review / proposal / optimizer loop

## Why This Exists

Raw exports from DataClaw, OpenAgentSessions, SWE-smith, or future sources all
have different shapes.

F-Stop needs one stable, inspectable, versioned file format that:

- preserves enough message/tool/session structure to audit imports
- preserves provenance back to the raw source
- keeps deterministic replay separate from raw capture noise
- can be handed directly to `pnpm lab:fstop:run --file ...`

## Inspirations

F-Stop Session borrows ideas from:

- OpenTelemetry trace/span structure:
  - trace/session identifiers
  - ordered event timelines
  - correlation rather than model-specific formatting
- OpenInference semantic conventions:
  - explicit message roles
  - tool call / tool result structure
  - session-level metadata rather than flattened chat-only rows

But F-Stop Session is intentionally much simpler than either one. It is a
single replay-oriented JSON file, not a telemetry backend protocol.

## File Naming

Recommended extension:

- `*.fstop-session.json`

Recommended runtime location:

- `.aperture/lab/sessions/...`

## Top-Level Shape

Required fields:

- `schemaVersion`
- `sessionId`
- `title`
- `importedAt`
- `entries`

Optional fields:

- `traceId`
- `description`
- `doctrineTags`
- `source`

## Entry Shape

Each `entries[]` item is an ordered timeline record.

Required fields:

- `index`
- `timestamp`
- `role`
- `kind`
- `significance`

Optional fields:

- `entryId`
- `parentEntryId`
- `toolCallId`
- `label`
- `text`
- `excerpt`
- `toolName`
- `toolFamily`
- `rawRef`
- `sourceEvent`

## Core Enums

Roles:

- `system`
- `user`
- `assistant`
- `tool`

Kinds:

- `message`
- `tool_call`
- `tool_result`
- `completion`
- `boundary`

Significance:

- `context`
- `attention`

## Replay Rule

F-Stop does **not** replay the whole session transcript directly.

It only compiles `entries` that contain a valid `sourceEvent` into replayable
`publishSource` steps. The rest of the session file remains important context
for auditability and future importer improvements.

## Example

```json
{
  "schemaVersion": 1,
  "sessionId": "fstop:demo-session",
  "traceId": "trace-demo-session",
  "title": "Demo canonical session",
  "importedAt": "2026-03-29T00:00:00.000Z",
  "entries": [
    {
      "index": 0,
      "timestamp": "2026-03-29T00:00:00.000Z",
      "entryId": "entry-0",
      "role": "user",
      "kind": "message",
      "significance": "attention",
      "text": "Check the runtime shape.",
      "sourceEvent": {
        "id": "fstop:demo-session:start",
        "type": "task.started",
        "taskId": "fstop:demo-session",
        "timestamp": "2026-03-29T00:00:00.000Z",
        "title": "Check the runtime shape"
      }
    }
  ]
}
```

## Operational Rule

If you have a new external trace format:

- first normalize it into F-Stop Session JSON
- then let F-Stop compile it into a replayable session file

Do not add new raw-format logic directly to the replay or review layers unless
that source truly cannot be normalized first.
