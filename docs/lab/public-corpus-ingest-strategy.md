# Public Corpus Ingest Strategy

This note defines how Aperture Lab should bring public agent-session corpora
into the replay, review, and calibration loop.

It is a Lab ingestion note, not a product-surface note.

## Main Rule

Import public corpora to strengthen the semantic layer and the Aperture Lab
F-Stop review loop.

Do not treat public corpora as direct benchmark truth.

The goal is to:

- widen semantic coverage
- expose Aperture to outside wording and workflow styles
- generate candidate disagreement artifacts for agent-backed review
- promote only the strongest cases into the frozen calibration corpus

## Priority Order

The first public corpus to bring in should be:

1. `woctordho/dataclaw`
2. `OpenAgentSessions`
3. `peteromallet/dataclaw-peteromallet`
4. `di-zhang-fdu/ShareDataClaw`

## Why DataClaw Comes First

Now that Lab has a canonical `ImportedSession` layer, `woctordho/dataclaw`
is the best next import target because it gives us much more volume while
still preserving the structure F-Stop actually needs.

It gives us:

- ordered user and assistant turns
- structured tool uses with outputs
- timestamps and model metadata
- enough diversity to produce meaningful disagreement batches immediately

It is the best first backbone corpus for F-Stop discovery after the canonical
import layer exists.

## Why OpenAgentSessions Still Matters

`OpenAgentSessions` remains highly aligned with Aperture Lab, but it is now
better treated as a smaller high-fidelity fixture lane than the main first
corpus.

It is the right source for:

- carefully inspected importer hardening
- fixture-quality replay cases
- early acceptance-style review cases

## Canonical Import Layer

All external corpora should first normalize into the same Lab-owned canonical
import shape before they become replay bundles.

The canonical import shape is the internal `ImportedSession` timeline in
`packages/lab/src/imported-session.ts`.

This is the consistent F-Stop ingest layer for:

- public benchmark trajectories
- public agent-session corpora
- future host-specific exports

Every source-specific importer should target that canonical imported-session
shape first, and only then compile it into replay bundles.

## What To Do With OpenAgentSessions

Bring it into Lab in four layers.

### 1. Raw Mirror Layer

Mirror the approved session artifacts locally without treating them as replay
truth.

Recommended landing path:

- `.aperture/lab/imported/open-agent-sessions/raw`

This raw mirror should be:

- local-first
- ignored by git
- inspectable
- disposable once better replay bundles exist

The raw mirror should preserve:

- original JSONL lines
- gist URL
- file name
- contributor/source metadata
- approval/publication metadata

### 2. Canonical Import Layer

Normalize each raw session into the shared `ImportedSession` shape.

That canonical timeline should preserve:

- source ordering
- role boundaries
- tool-call vs tool-result distinctions
- source provenance
- replay-significant excerpts
- derived `SourceEvent` boundaries only where they are needed for replay

The goal is to give every external corpus the same F-Stop ingest contract,
instead of building a different replay mapper for every source.

### 3. Replay Bundle Layer

Convert each raw session into a replayable Lab bundle.

Recommended landing path:

- `packages/lab/bundles/public/open-agent-sessions`

These bundles should be deterministic imports, not copies of the raw session.

The importer should:

- preserve source provenance
- preserve step ordering
- preserve source excerpts that matter for review
- synthesize stable replay timestamps
- drop non-replayable or unsafe fields

The bundle should be shaped for:

- `pnpm lab:fstop:prepare`
- `pnpm lab:fstop:review:run`
- `pnpm lab:fstop:promote`

### 4. Promotion Layer

Only a small subset of imported bundles should become durable fixtures.

Promotion targets should stay the same:

- `packages/lab/harvested`
- `packages/lab/calibration/train`
- `packages/lab/calibration/validation`
- `packages/lab/calibration/heldout`

The promotion bar should be:

- repeated disagreement signal
- high semantic usefulness
- clear remediation direction
- stable enough to survive replay over time

## What To Keep

The importer should keep the fields that help Aperture understand attention and
meaning.

Keep:

- session/source provenance
- original role boundaries
- tool names
- tool arguments when they matter for semantic review
- tool results when they change the meaning of later steps
- timing order
- model/provider metadata
- short source excerpts for reviewer evidence
- explicit redaction markers when present

## What To Drop Or Quarantine

The importer should not turn raw public sessions into a raw execution archive.

Drop or quarantine:

- chain-of-thought
- encrypted reasoning payloads
- opaque signatures
- giant raw patches unless they are the thing under review
- token accounting not needed for judgment analysis
- irrelevant long-form chatter that never influenced attention

For OpenAgentSessions specifically, `thinking` or reasoning blocks can stay in
the raw local mirror, but they should not enter the replay bundle or promoted
fixtures.

## How To Normalize OpenAgentSessions

The importer should map OpenAgentSessions into the same replay and review shape
Lab already uses for public trajectory imports.

Recommended conversion model:

1. Parse the JSONL into a typed session timeline.
2. Identify attention-significant boundaries.
3. Emit `publishSource` replay steps only for those boundaries.
4. Run the resulting scenario through Lab to produce a bundle.

### Attention-Significant Boundaries

Good first boundaries are:

- session start
- first user request
- assistant tool call
- tool result
- explicit failure or blocked execution
- assistant completion or stop
- later user follow-up turns that materially change obligation

### First Replay Mapping

The first importer should stay simple and deterministic.

- user request -> `task.started`
- assistant planning/status text -> `task.updated`
- assistant tool call -> `task.updated` with `toolFamily`
- tool result -> `task.updated` with outcome-bearing summary
- explicit stop/completion -> `task.completed` or `task.cancelled`

This is intentionally conservative.

The first goal is not perfect host reconstruction.

The first goal is to pressure-test:

- semantic interpretation
- attention-worthiness
- ambiguity handling
- continuity hints

## Why This Helps The Semantic Layer

OpenAgentSessions is especially good for semantic work because it preserves:

- the user ask
- the assistant response
- the tool choice
- the tool result
- the next assistant reaction

That gives Lab a better substrate for evaluating:

- title extraction
- summary extraction
- tool-family inference
- consequence banding
- waiting vs failure vs passive status
- implied asks and obligation cues
- follow-up or continuation semantics

This is exactly the part of Aperture we want public corpora to stress first.

## How Agent Review Fits

Once an OpenAgentSessions import lands as a replay bundle, it should flow
through the existing agent-backed review loop unchanged:

1. `pnpm lab:fstop:prepare`
2. `pnpm lab:fstop:review:run --reviewer-command "pnpm lab:fstop:reviewer --provider <provider>"`
3. disagreement report
4. selective promotion into calibration

The reviewer runtime should review Aperture's read of the imported bundle.

The reviewer runtime should not review the raw JSONL directly as the primary
interface.

That keeps the comparison centered on:

- Aperture's deterministic interpretation
- Aperture's deterministic decision
- the bounded replay artifact we are willing to preserve

## Recommended Next Build

The first implementation slice should be:

1. add `dataclaw` as a public trajectory dataset id
2. fetch rows from `woctordho/dataclaw`
3. normalize each session into the canonical `ImportedSession` shape
4. write deterministic bundles under `packages/lab/bundles/public/dataclaw`
5. run those bundles through `pnpm lab:fstop:review`
6. promote only repeated high-confidence disagreements

## After DataClaw

The next corpus priorities should be:

### `OpenAgentSessions`

Second priority because it is still the highest-fidelity raw publication model,
and it is especially good for:

- importer hardening
- fixture-quality replay cases
- small, carefully reviewed semantic calibration seeds

### `peteromallet/dataclaw-peteromallet`

Third priority because it is clean and broad, but weaker than
`woctordho/dataclaw` for outcome-sensitive replay because it does not preserve
tool outputs.

### `di-zhang-fdu/ShareDataClaw`

Fourth priority because it is large and useful for pattern mining, but the
ShareGPT-style transformation makes it less faithful as a first replay source.

## Success Criteria

This ingest work is successful when:

- imported public-corpus bundles replay deterministically
- the configured reviewer runtime can review them through the normal Lab path
- we start discovering semantic disagreements that do not already appear in
  golden scenarios
- promoted cases improve the frozen calibration corpus without dragging raw
  public-session noise into committed fixtures
