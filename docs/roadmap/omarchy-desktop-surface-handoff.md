# Omarchy Self-Contained Attention Worker Handoff

## Decision

Ship one self-contained Omarchy plugin containing:

```text
native Omarchy QML
  + bundled aperture-attention-engine
  + canonical worker schemas and fixtures
  + machine-readable build provenance
```

The user installs only the plugin:

```bash
omarchy plugin add <omarchy-aperture-repo> --enable
```

The plugin must not require a separately installed Aperture CLI/runtime, Node,
npm, Docker, first-run downloader, or harness adapters. It uses Node 22 or newer
from a supported standard Omarchy installation.

The bundled worker uses the real stateful `@tomismeta/aperture-core`. It is an
isolated child process, not a QML reimplementation and not merely the stateless
`@tomismeta/aperture-core/kernel` subpath.

## Product scope

V1 is notification-native attention:

```text
Omarchy notification observer
  -> bounded worker input
  -> stateful ApertureCore
  -> complete Now / Next / Ambient snapshots
  -> native Omarchy panel
```

It is intentionally lower fidelity than direct harness adapters. It may support
completion, needs-attention notifications, failures, review-ready work, and
informational status. It cannot guarantee continuous agent lifecycle, stable
native task identity, progress, typed approvals, response routing, or underlying
resolution.

Do not hide this limitation in product copy.

## Why this is good for Aperture

This creates two reusable host-neutral assets:

1. a bounded desktop-notification ingestion contract
2. a self-contained stateful ApertureCore worker contract

Other desktop shells can implement the same worker boundary without importing
Aperture source or running the generic HTTP runtime.

Do not overload the existing `aperture surface --stdio` contract. That command
is an output-only companion to an external runtime. The new worker is
bidirectional and owns Core state. It gets its own package capability and
schemas while reusing the existing bounded public snapshot/frame projection
where shapes are identical.

## Current baselines

- Aperture repository: `/Users/tom/dev/aperture`
- Aperture commit: `ee92470`
- `@tomismeta/aperture-core@0.9.0`
- Omarchy renderer repository: `/Users/tom/dev/omarchy-aperture`
- Omarchy architecture commit: `242be35`
- Omarchy source: `omacom/omarchy@quattro`

The previous external-runtime bridge baseline `df1640f` remains reference
material only.

## Ownership

### Aperture repository owns

- worker source and Core composition
- notification input DTO and adapter
- worker output DTO and snapshot projection
- strict schemas and generated fixtures
- privacy/redaction and admission policy
- persistence, replay, and corrupt-state behavior
- dependency-free CommonJS worker build and trusted-CI provenance
- artifact signing, attestation, and checksums
- Core-to-worker conformance

### Omarchy upstream owns

- generic copied notification observations before DND suppression
- replacement/update identity
- close reasons
- bounded allowlisted notification fields
- non-mutating observer semantics

No Aperture-specific field or judgment belongs in Omarchy.

### `omarchy-aperture` owns

- QML observer integration
- exactly one worker across monitors
- bounded stdin forwarding and coalescing
- stdout parsing and visible worker states
- native panel rendering
- vendored worker and BUILDINFO verification
- real Omarchy lifecycle and visual proof

The plugin must not define worker fields independently.

## Evidence gate

Do not implement stronger-than-Ambient semantic mapping before receiving
sanitized real notification samples from Claude, Codex, OpenCode, OMP, and Pi
on Omarchy.

For each source, record:

- application name
- desktop-entry/category fields
- summary/body shape
- urgency
- replacement/update identity
- DND behavior
- close reason
- structured hints

Required outputs:

- reviewed fixture corpus
- exact known-agent identity allowlist
- normalization precedence
- evidence for every stronger-than-Ambient mapping
- privacy review

Unknown applications are ignored. Urgency alone never creates blocking work.
Allowlisted prose without structured semantics is Ambient at most. If current
notifications cannot produce trustworthy Now/Next decisions, stop and choose
structured emitter hints, reviewed exact classifiers, an Ambient-only product,
or a different integration source.

## Canonical worker input

The V1 contract is canonical in
`packages/aperture/src/notification-worker-input.schema.json`:

```ts
type DesktopNotificationInput =
  | {
      type: "notification.observed" | "notification.updated";
      key: string;
      occurredAt: string;
      application: {
        name: string;
        desktopEntry?: string;
        category?: string;
      };
      summary: string;
      body?: string;
      urgency: "low" | "normal" | "critical";
    }
  | {
      type: "notification.closed";
      key: string;
      occurredAt: string;
      reason: "expired" | "dismissed" | "actioned" | "closed" | "unknown";
    }
  | {
      type: "shutdown";
    };
```

Requirements:

- copied plain data, never live notification objects
- bounded UTF-8 lines
- strict validation before mutation
- stable replacement identity
- no executable actions
- bodies are accepted only as bounded transient input and are never persisted
- exact duplicate worker updates are suppressed; QML owns replacement
  coalescing under backpressure

The notification adapter maps accepted inputs to `SourceEvent` outside Core.
Core remains host-neutral.

## Worker output

The worker emits:

- hello/package/capabilities
- restoring/ready/degraded engine state
- complete bounded attention snapshots
- recoverable/fatal errors

Reuse the existing public surface frame/view projection for:

- one nullable `now`
- ordered `next`
- ordered `ambient`
- bounded source/application identity
- bounded title, summary, context, and why-now
- honest totals when clipping

Snapshots are atomic replacements, not patches. QML never ranks, deduplicates,
promotes, or reconciles.

Worker and QML ship atomically, so compatibility follows the plugin artifact,
worker capabilities, BUILDINFO, schemas, and fixtures. Do not create
renderer-local aliases.

## Privacy and persistence

- unknown applications are dropped before Core
- raw notification bodies are bounded to 8 KiB before processing
- raw bodies are never persisted
- persist only minimum normalized/redacted events
- redact credential-like values, tokens, URL query/fragment data, control
  characters, and private paths
- omit a field when safe minimization is uncertain
- state directory mode: `0700`
- state file mode: `0600`
- maximum ledger age: 24 hours
- maximum records: 1,024
- maximum encoded size: 4 MiB
- oldest-first eviction when any limit is reached
- atomic replacement and visible corrupt-state recovery

Required tests include redaction canaries and proof that no raw body substring
reaches persisted state.

## Worker composition

The worker contains:

- stateful `ApertureCore`
- notification adapter
- bounded ledger
- deterministic replay
- stdin parser
- output projection
- diagnostics

It excludes:

- generic Aperture HTTP runtime
- runtime discovery/registry/auth
- generic CLI and TUI
- harness hook installers
- provider adapters

The implementation is a dedicated build target in the Aperture product package
and reuses Core directly. Do not fork Core.

## Host-Node worker artifact

Omarchy already installs Node through mise and exposes its shims to the
UWSM/Quickshell environment. The plugin therefore ships the worker, not another
copy of Node:

```text
TypeScript source
  -> esbuild target node22
  -> dependency-free aperture-attention-engine.cjs
  -> Omarchy-provided Node >=22
```

The plugin invokes the bundle through a small plugin-relative launcher. The
launcher may locate and version-check Node, but it must never install, download,
or update it. CI exercises the bundle under Node 22, Node 24, and current Node.

Required BUILDINFO:

- artifact type `node-commonjs-bundle`
- minimum Node version
- Aperture commit and signed source tag
- Aperture and ApertureCore versions
- exact esbuild and build-Node versions
- worker/schema contract versions
- SHA-256, byte size, and file mode for every payload file
- CI workflow/run identity
- provenance attestation requirement
- build timestamp

The Omarchy repository accepts only a trusted-CI bundle tied to the reviewed
source tag. No local/manual production artifact, runtime compilation, downloader,
Git LFS, `node_modules`, source map, or first-use mutation of the plugin checkout
is permitted.

Artifact review limits:

- maximum worker bundle: 2 MiB
- maximum plugin checkout: 25 MiB
- one current worker bundle
- cumulative Git-history growth reviewed each release

## Worker lifecycle

- one Omarchy service owns one worker across monitors
- state lives outside the plugin checkout under XDG paths
- shell restart reconstructs state deterministically
- disabling/removing the plugin stops the worker
- no worker survives plugin removal
- restart uses bounded stable-uptime backoff
- malformed input cannot crash Quickshell
- worker failure cannot crash Quickshell
- Aperture-generated desktop notifications remain disabled

## Aperture implementation status — 2026-08-31

Landed in this repository:

- strict input/output schemas and runtime validators
- exact allowlist admission with unknown-source rejection
- semantic/display separation that prevents notification prose from influencing judgment
- Ambient-only notification decisions through stateful `ApertureCore`
- bounded JSONL, complete surface snapshots, and duplicate suppression
- redaction plus private, atomic, bounded, deterministic persistence/replay
- dependency-free CommonJS worker targeting Node 22
- clean-room host-Node smoke and Node 22/24/current compatibility gates
- atomic artifact staging with schema hashes and BUILDINFO
- signed-tag trusted-CI artifact workflow with build-provenance attestation
- package export and packed-install smoke coverage
- first-class OMP adapter with runtime and Omarchy notification transports
- dependency-free OMP extension bundle and artifact provenance fields

Observed locally:

- a 909,269-byte worker bundle ran outside the repository without `node_modules`
- the exact bundle passed on Node 22.23.2, Node 24.13.0, and Node 26.4.0
- eight adversarial failure/approval/blocking/permission/urgency cases stayed Ambient and low
- observed and replacement-update history replayed byte-for-byte equivalent public views
- an actioned close cleared Ambient and persisted only normalized feedback
- body/credential/private-path canaries did not reach state
- staged BUILDINFO SHA-256 matched the bundle and schemas
- state directory/file modes were `0700`/`0600`
- a 12,712-byte OMP extension loaded from a clean directory and registered 17
  events
- private OMP 18.0.11 proof on Omarchy passed exact identity, lifecycle,
  fail-open fallback, replacement, privacy, replay, and Bun-free removal

This is not a releasable Omarchy artifact yet. The upstream observer, supported
identity corpus, signed CI artifact, target QML singleton lifecycle, and final
vendored visual proof remain gated.

## Work packets

### A. Evidence and admission

- land generic Omarchy observer in a local upstream branch
- capture sanitized real agent notifications
- decide identity and semantic mapping
- approve or stop notification-native V1

### B. Canonical worker contracts

- define input/output schemas
- define lifecycle and capabilities
- generate fixtures
- define privacy/persistence contract

### C. Core worker

- compose `ApertureCore`
- implement notification adapter
- implement replay/persistence
- implement bounded JSONL and errors

### D. Host-Node worker artifact

- build and test the CommonJS bundle under Node 22/24/current
- produce attestation and BUILDINFO from a signed source tag
- prove clean-directory execution without npm or `node_modules`

### E. Omarchy integration

- vendor artifact and BUILDINFO
- add singleton notification forwarding
- replace preserved bridge in one clean cutover
- verify worker teardown and multi-monitor behavior

### F. Release proof

- clean installation with explicit OMP activation and verified pre-removal
- native notifications unchanged under DND/replacement/close
- deterministic Now/Next/Ambient
- privacy and retention tests
- theme/scale/keyboard/pointer/overflow checks
- atomic update and rollback

## Release gates

Do not release until:

- notification observer is available in a supported standard Omarchy
- identity corpus supports trustworthy judgment
- worker schemas and conformance fixtures are canonical
- attested host-Node bundle from a signed source tag exists
- QML and worker are tested together
- no separately installed runtime or toolchain; the approved explicit OMP
  registration is the only additional activation action
- persistence/replay and removal are proven
- actual Omarchy dogfood is quiet and useful

## Stop conditions

Stop rather than weakening boundaries if:

- complete notification observation is unavailable
- real notifications cannot support trustworthy judgment
- supported Omarchy cannot guarantee a compatible Node runtime
- state cannot be bounded safely
- a downloader or separately installed runtime becomes necessary
- typed approval responses become a V1 requirement

## OMP adapter workstream

Reliable OMP events require a first-class OMP extension adapter rather than
depending on terminal notifications. The adapter follows the Claude Code,
OpenCode, and Pi boundary pattern while keeping OMP-specific behavior out of
Core.

The canonical architecture, event mapping, artifact layout, activation gate,
ownership, and acceptance plan are defined in
[`omp-adapter-handoff.md`](./omp-adapter-handoff.md).

The worker and OMP extension are separate runtime entry points shipped in one
trusted payload. Production activation is an explicit, user-initiated
`omp plugin link` of that payload, paired with verified Bun-free pre-removal.
Never perform the link from shell startup or mutate OMP state without the
activation action.

## Coordination

The Omarchy agent may prepare and test the generic upstream observer patch in an
isolated Omarchy branch/fork, but public plugin release waits for upstream
acceptance in a supported Omarchy version.

The Aperture agent owns worker implementation. The plugin agent consumes only
released schemas, fixtures, artifacts, and provenance.

No private Omarchy fork may become a production dependency.
