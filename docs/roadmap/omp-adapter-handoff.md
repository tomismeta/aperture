# OMP Adapter and Omarchy Delivery Handoff

## Decision

Build a first-class `@aperture/omp` adapter as a sibling of the Claude Code,
OpenCode, and Pi adapters.

The adapter owns OMP-specific event normalization. `ApertureCore` remains
host-neutral. The adapter is a separate OMP extension entry point; it is not
embedded inside the notification worker main module.

Two artifacts may ship in one trusted Omarchy payload:

```text
lib/aperture-attention-engine.cjs
integrations/omp/aperture-omp-extension.mjs
```

They share CI provenance and BUILDINFO, but have different process contracts:

- `aperture-attention-engine.cjs` is a Node-executed JSONL worker.
- `aperture-omp-extension.mjs` is imported by OMP and default-exports an
  `ExtensionAPI` factory.

## Why this is required

Notification observation alone is not a reliable OMP event source. OMP's
built-in completion, ask, and error notifications are mode-, configuration-,
and terminal-dependent. Headless and noninteractive runs may emit no
FreeDesktop event. The current Omarchy corpus observed no notification from its
noninteractive OMP scenario.

OMP already exposes typed extension events. A first-class adapter gives Aperture
stable lifecycle, approval, input, execution, failure, and completion facts
without parsing terminal text, logs, or session files.

## Relationship to the notification worker

The reviewed host-Node notification worker remains valid and separate:

```text
Aperture commit bb23e6e5d7a8ddd9c300cfd130dfa1490617b4cf
```

Do not reopen its canonical notification schema merely to carry OMP-native
payloads. The OMP adapter translates at its own boundary.

For normal Aperture, the adapter publishes canonical `SourceEvent` values to an
`ApertureRuntimeAdapterClient`, matching the Claude Code and OpenCode adapter
pattern.

For the self-contained Omarchy V1, the adapter emits deterministic native
Omarchy notifications. The generic Omarchy observer then feeds the existing
Ambient-only notification worker contract.

## Architecture

### Normal Aperture runtime

```text
OMP ExtensionAPI
  -> @aperture/omp mapping
  -> canonical SourceEvent
  -> ApertureRuntimeAdapterClient
  -> Aperture runtime
  -> stateful ApertureCore
```

This path may support typed approval and input responses when a response-capable
Aperture surface is attached.

### Self-contained Omarchy plugin

```text
OMP ExtensionAPI
  -> @aperture/omp mapping
  -> Omarchy notification transport
  -> omarchy.notifications observer
  -> singleton Service.qml
  -> aperture-attention-engine.cjs
  -> stateful ApertureCore
  -> Ambient snapshot
```

Omarchy V1 advertises no response capability. OMP-derived notifications remain
Ambient and observational. QML does not interpret OMP events or prose.

## Aperture package layout

```text
packages/omp/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts
│   ├── omarchy-extension.ts
│   ├── mapping.ts
│   ├── mapping-lifecycle.ts
│   ├── mapping-tools.ts
│   ├── mapping-approvals.ts
│   ├── mapping-shared.ts
│   ├── runtime-transport.ts
│   ├── omarchy-notification-transport.ts
│   └── types.ts
└── test/
    └── omp-adapter.test.ts
```

Pi and OMP remain separate adapters:

```text
@aperture/pi  -> upstream Pi
@aperture/omp -> Oh My Pi
```

Shared pure mapping utilities may be extracted where behavior is genuinely
identical. Do not alias OMP to Pi or silently ignore OMP-only event fields.

## OMP extension manifest

The vendored integration directory contains a manifest that OMP can load:

```json
{
  "name": "@tomismeta/aperture-omp",
  "private": true,
  "type": "module",
  "omp": {
    "extensions": ["./aperture-omp-extension.mjs"]
  }
}
```

The extension bundle contains all non-host dependencies and requires no runtime
`node_modules`, npm, pnpm, or TypeScript compilation.

## Event mapping

| OMP event                                        | Canonical Aperture meaning                                   |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `session_start`                                  | `task.started`                                               |
| `before_agent_start` / `agent_start`             | `task.updated` running                                       |
| `turn_start`                                     | `task.updated` running                                       |
| `tool_execution_start` / `tool_execution_update` | `task.updated` running                                       |
| `tool_execution_end` with `isError`              | typed failed update                                          |
| `tool_approval_requested`                        | approval request or needs-attention status                   |
| `tool_approval_resolved` approved                | running/resumed update                                       |
| `tool_approval_resolved` denied                  | blocked/cancelled update according to observed OMP lifecycle |
| ask/input request                                | question request or needs-input status                       |
| `input`                                          | running/resumed update                                       |
| `agent_end` with `willContinue: true`            | running; never completion                                    |
| terminal `agent_end`                             | settled/completion candidate                                 |
| `session_stop`                                   | authoritative main-session settle                            |
| `session_shutdown`                               | cancelled or completed according to shutdown cause           |

`session_stop` and `agent_end.willContinue` must prevent false completion during
auto-retry, continuation, or pending background work.

Explicit `tool_approval_requested` and `tool_approval_resolved` events take
precedence over inferring approval from every `tool_call`.

## Stable identity

The adapter derives stable identities from OMP-owned facts:

- OMP session ID/file
- turn index
- tool call ID
- approval/request ID
- interaction class

No title substring, fuzzy project matching, or transcript parsing may create
identity.

The normal runtime source kind is `omp`. Pi remains `pi`.

## Omarchy notification transport

The initial Omarchy transport uses the standard `omarchy-notification-send`
command as an argv vector, never a shell command string.

Required behavior:

- fixed exact `appName`: `aperture-omp`
- bounded summary and body
- no executable notification action
- stable replacement IDs using `--print-id` and `--replace-id`
- close or replace an adapter-owned notification when the OMP interaction
  resolves
- transport failure never blocks or fails the OMP session
- no credential, prompt transcript, raw tool result, private path, or secret in
  notification content

Repeated identical upserts are accepted when they reuse the sender-owned native
notification ID. Quickshell is not required to emit `notificationUpdated` when
no observable property changed. A replacement-update assertion is required only
when summary, body, urgency, or another forwarded display field changes.

The Omarchy extension sets process-local `PI_NOTIFICATIONS=off` only after the
configured notification sender resolves to an executable. OMP's built-in
waiting/completion notices therefore do not duplicate adapter-owned
notifications on a healthy transport, while an unavailable sender leaves the
built-ins enabled. Delivery failure restores the prior value and disables
adapter delivery for the rest of that OMP session so the two paths cannot mix;
session shutdown also restores it. The extension never mutates OMP
configuration.

Session shutdown closes persistent approval/input notifications only. Expiring
failure and completion notifications remain owned by the native notification
server and expire normally.

`credential_disabled` is proven with deterministic typed-event injection through
the compiled extension and transport. Real-host acceptance must not invalidate a
working credential merely to trigger this event.

Emit only attention-relevant transitions:

- approval requested
- ask/input requested
- terminal tool or provider failure
- terminal session completion
- resolution/replacement of one of those states

Do not emit every turn or tool lifecycle event as a desktop notification.

The worker admits only the exact reviewed `aperture-omp` identity. OMP-derived
notification text remains Ambient-only under the existing worker ceiling.

## Runtime transport

The normal Aperture transport follows existing adapters:

```text
map OMP event
  -> SourceEvent batch
  -> ApertureRuntimeAdapterClient
```

Adapter delivery is fail-open for OMP: inability to find or publish to an
Aperture runtime may warn, but it must not abort, block, or corrupt the OMP
session.

Typed approval holding is opt-in and may engage only when a response-capable
Aperture surface is attached. Timeout returns control to OMP's native approval
path.

## Trusted artifact layout

The Aperture artifact builder will stage:

```text
lib/aperture-attention-engine.cjs
integrations/omp/package.json
integrations/omp/aperture-omp-extension.mjs
schemas/
evidence/
BUILDINFO.json
```

BUILDINFO adds an OMP integration record containing:

- path and manifest path
- SHA-256 and byte count
- minimum tested OMP version
- adapter proof identity
- runtime import audit
- compatibility results

The provenance attestation covers both the worker bundle and OMP extension
bundle. A local extension build may support private proof but is never a
production vendoring source.

## Extension activation

Shipping the extension file does not make OMP load it.

The approved production activation path is the explicit, user-initiated
equivalent of:

```bash
omp plugin link ~/.config/omarchy/plugins/aperture.attention/integrations/omp
```

Do not run this from the shell launcher or worker startup. The activation action
must identify that it is registering the released Aperture integration with OMP
and must operate on the trusted, attested payload.

Standard Omarchy may not expose `bun` on `PATH`, while `omp plugin uninstall`
currently delegates to Bun. Production pre-removal must therefore:

1. disable `@tomismeta/aperture-omp`
2. resolve exactly one active user plugin root
3. verify that the package path is a symlink to the installed Aperture payload
4. refuse a missing or mismatched owned target unless both link and lock state
   are already absent
5. remove only that verified symlink
6. atomically delete only the plugin and settings entries from
   `omp-plugins.lock.json`
7. verify that a fresh `omp plugin list --json` no longer reports the package

Run pre-removal before deleting the payload. Never invoke a package installer,
mutate `package.json`, or depend on Bun. The private Omarchy proof at `cf63e1a`
validated link, removal, mismatch refusal, absence, and reinstall with Bun
absent.

This selects the explicit second OMP activation action. Automatic one-command
discovery remains future upstream work; it must not be approximated through
hidden `~/.omp` mutation.

## Ownership

### Aperture repository

Owns:

- `packages/omp`
- OMP event types and mapping
- runtime and Omarchy notification transports
- adapter tests and compatibility fixtures
- compiled OMP extension bundle
- artifact hashes, BUILDINFO, and provenance

### Omarchy Aperture repository

Owns:

- vendoring the released integration artifact
- production launcher and QML lifecycle
- development-only OMP link/override proof
- end-to-end OMP notification observation
- plugin installation and removal documentation

### OMP upstream

Owns any future generic discovery or desktop-notification capability required to
make activation automatic without mutating user configuration.

## Aperture implementation sequence

1. Add `packages/omp` with structural OMP event types.
2. Reuse or extract only genuinely shared Pi mapping utilities.
3. Implement `agent_end.willContinue`, `session_stop`, approval, ask/input, and
   execution mappings.
4. Implement normal `ApertureRuntimeAdapterClient` delivery.
5. Implement bounded Omarchy notification delivery with injectable process I/O
   for tests.
6. Add deterministic mapping and fail-open transport tests.
7. Build a dependency-free OMP extension module.
8. Add the extension and manifest to artifact staging and BUILDINFO.
9. Run the extension against a supported OMP 18 release.
10. Hand the local development integration to the Omarchy agent for private
    end-to-end proof.
11. Produce a new signed combined artifact only after that proof.

The reviewed worker commit remains independently usable. The OMP adapter landed
at `b1c92de`; proof-blocker fixes landed at `00e150a`. A production payload
still requires a signed combined artifact built from the reviewed tag.

## Omarchy implementation sequence after delivery

1. Verify adapter manifest, bytes, BUILDINFO, and provenance.
2. Vendor the exact extension and worker payload.
3. Link the extension explicitly in a development-only OMP profile.
4. Exercise approval, ask/input, failure, completion, replacement, and close.
5. Confirm only the exact `aperture-omp` application identity enters the worker.
6. Confirm all notification-derived frames remain Ambient.
7. Confirm adapter failure does not affect OMP.
8. Confirm plugin disable/removal stops the worker and documents OMP unlinking.
9. Decide the production activation mechanism before manifest cutover.

## Acceptance criteria

### OMP adapter

- loads as an OMP extension with no runtime package install
- maps supported events deterministically
- never completes `agent_end.willContinue: true`
- uses explicit approval events
- preserves stable session and interaction identity
- handles failures without crashing OMP
- publishes canonical SourceEvents to a normal Aperture runtime

### Omarchy transport

- emits only attention-worthy notifications
- uses exact fixed identity and bounded text
- preserves replacement and close lifecycle
- exposes no actions, secrets, or raw results
- fails open when Omarchy notification transport is unavailable
- produces Ambient-only worker output

### Artifact

- worker and OMP extension are built from one reviewed source commit/tag
- every runtime file and schema is hashed
- no runtime `node_modules`, npm, pnpm, source map, or downloader
- compatibility and end-to-end evidence are included
- trusted CI provenance covers both bundles

## Stop conditions

Stop rather than weaken the boundary if:

- OMP events cannot provide stable session or interaction identity
- the adapter must parse transcripts or private session files
- transport failure can block or crash OMP
- Omarchy requires hidden mutation of OMP configuration
- unstructured notification prose can exceed Ambient
- typed responses become required before a versioned worker response protocol
- production would require a local/manual adapter artifact

## Current status — 2026-08-31

- Host-Node notification worker: implemented and previously reviewed at `bb23e6e`.
- OMP adapter and proof fixes: implemented at `b1c92de` and `00e150a`.
- Normal Aperture runtime transport: implemented and unit tested.
- Omarchy notification transport: implemented with fixed `aperture-omp` identity,
  replacement IDs, sender-owned close, bounded fixed bodies, and fail-open delivery.
- OMP extension artifact: `integrations/omp/aperture-omp-extension.mjs`.
- Clean extension bytes: `12712`.
- Clean extension SHA-256:
  `4ed0828ece31c1d82c521c304b2670b6b6224359472dd9d2090cd01818c70268`.
- Adapter proof identity: `aperture-omp-adapter-conformance-v1`.
- Clean-directory module load: passed with 17 registered OMP events.
- Runtime import policy: passed; only `node:child_process`, `node:crypto`,
  `node:fs`, `node:fs/promises`, `node:path`, and `node:util` remain external.
- Omarchy private proof: passed at `cf63e1a` on OMP 18.0.11, Arch Linux
  x86_64, and Node 26.7.0 against Aperture `00e150a`.
- The proof passed exact identity, healthy-sender built-in suppression,
  unavailable-sender built-in fallback, approval/input resolution, interactive
  and noninteractive completion expiry, terminal failure survival, replacement,
  credential/provider privacy, deterministic replay, and Ambient projection.
- Omarchy observer `8e13ddaf` passed DND `Unknown`, normal close, and changed
  replacement with exactly-once stable-key observations.
- Bun-free explicit link/removal/reinstall passed, including refusal of a
  deliberately mismatched symlink. The production packaging contract above is
  approved; its Omarchy production implementation remains pending.
- Combined trusted artifact: not tagged, attested, or vendored.
- Production activation mechanism: decided; explicit user-initiated OMP link
  plus verified Bun-free pre-removal.
- Private OMP and observer end-to-end proof: accepted.
