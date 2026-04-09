# Capture Review Quickstart

This is the shortest path from a real Aperture session to an inspectable
offline-review artifact.

Use this when you want to answer:

- why did Aperture surface this item?
- what did the semantic read look like?
- where should I inspect or disagree with the current behavior?

This is a repo-level workflow.
It is intentionally **not** part of the shipped `@tomismeta/aperture` product
command surface.

## Inputs You Can Start From

You can start from either of these:

1. an existing session bundle
   - from `aperture --capture`
   - from `pnpm session:export`
2. a live Aperture runtime
   - useful when you want a fresh bundle and review artifact in one step

## Path A: Start From An Existing Bundle

If you already have a bundle JSON:

```bash
pnpm session:review --bundle /absolute/path/to/session-bundle.json
```

This writes an offline-review artifact and prints the next reviewer command.

Useful flags:

```bash
pnpm session:review \
  --bundle /absolute/path/to/session-bundle.json \
  --out /absolute/path/to/offline-review-artifact.json \
  --focus-area status \
  --focus-area blocking \
  --focus-area confidence
```

## Path B: Start From A Live Runtime

If Aperture is already running locally:

```bash
pnpm session:review
```

Or against an explicit runtime:

```bash
pnpm session:review --runtime http://127.0.0.1:4546/runtime
```

This does two things:

1. writes a replayable session bundle
2. writes the derived offline-review artifact

Useful flags:

```bash
pnpm session:review \
  --session-id live-smoke-review \
  --title "Live approval smoke review" \
  --tag captured \
  --tag review \
  --bundle-out /absolute/path/to/session-bundle.json \
  --out /absolute/path/to/offline-review-artifact.json
```

## What You Get

`pnpm session:review` prepares a review artifact that already carries:

- compact source excerpts
- Aperture's normalized semantic read
- decision/lane snapshots
- the current explanation headline and routing authority when available

That means the offline reviewer sees both:

- what happened
- what Aperture thought was important about it

## Next Step: Run A Reviewer

Once you have an artifact, run a reviewer command against it:

```bash
pnpm lab:fstop:review-run \
  --artifact /absolute/path/to/offline-review-artifact.json \
  --reviewer-command "<command>"
```

That writes:

- the rendered prompt
- raw reviewer output
- the completed reviewed artifact
- disagreement and recommendation reports

## When To Use Which Tool

- `aperture --capture`
  - easiest product path when you are already using the TUI
- `pnpm session:export`
  - export a clean session bundle from a live runtime
- `pnpm session:review`
  - cheapest bridge from live bundle/runtime into offline review
- `pnpm lab:fstop:review-run`
  - run the actual reviewer

## Related Docs

- [Aperture Lab](./aperture-lab.md)
- [Offline AI Review Loop](./offline-ai-review-loop.md)
- [Examples](../../examples/README.md)
