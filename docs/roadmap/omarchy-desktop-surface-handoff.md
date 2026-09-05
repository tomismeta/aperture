# Omarchy Self-Contained Attention Worker Handoff

## Decision

Ship one self-contained Aperture-for-Omarchy plugin containing:

```text
native Omarchy QML
  + signed, dependency-free aperture-attention-engine.cjs
  + signed, dependency-free aperture-omp-extension.mjs
  + canonical schemas, fixtures, BUILDINFO, and provenance
```

The plugin is a focused OMP delivery channel. It does not install, discover, or
attach to the Aperture CLI or HTTP runtime. The worker owns `ApertureCore`, its
persisted state, and `$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`. Omarchy
supplies Node 22 or newer; the payload supplies every non-host runtime
dependency.

The upstream Aperture product remains Claude-first. This plugin is not a claim
that Omarchy is the general Aperture product surface.

## Current architecture

```text
OMP ExtensionAPI
  -> private bounded OMP attention event v2
  -> acknowledged worker-direct protocol v4 over the canonical Unix socket
  -> stateful ApertureCore
  -> private notification-worker output v4
  -> native Omarchy panel
```

The OMP extension sends typed events directly. The worker, not QML and not the
extension, decides Now, Next, and Ambient. QML treats every snapshot as an
atomic replacement and never ranks, promotes, deduplicates, or reconciles.

A native OMP notification is a fail-open, outside-surface fallback. It is shown
only when direct delivery was definitely not accepted. It is not observed back
into the worker and cannot create an Ambient duplicate. Acceptance-unknown
failures do not send a duplicate native notification.

## Protocol boundaries

The public companion surface and private worker output intentionally differ:

- Public surface protocol is exact v4. Its hello requires
  `protocolVersion: 4`. Its frame schema has no navigation property, and its
  projection has no focus input.
- Notification-worker input remains exact schema v2.
- Private notification-worker output is exact v4. Its hello independently
  requires `protocolVersion: 4`.
- Private worker frames alone may carry navigation, and only as
  `{ "kind": "opaque-focus", "handle": "<32 base64url characters>" }`.
- OMP attention events are exact schema v2.
- Worker-direct messages and acknowledgements are exact protocol v4.

Package semver is independent from these wire versions. BUILDINFO records
`aperturePackageVersion`, `apertureCoreVersion`, and `ompPackageVersion`
separately. The private OMP manifest for this plugin release is
`@tomismeta/aperture-omp@0.1.0`; it does not equal the Aperture product
candidate version.

Common display semantics are implemented through the public display projection,
then the private worker projection adds a validated volatile focus capability.
The public serializer therefore cannot emit a focus handle. Session IDs,
backend targets, socket paths, pane IDs, compositor identities, worker
generations, and recovery markers never enter either surface frame.

Snapshot totals describe the complete view. The visible source list and frame
lists may be ordered prefixes after count or byte clipping, so
`totals.sources >= sources.length` is valid and expected.

## JSONL framing

Both the private worker and public stdio surface use newline-delimited JSON.
Each hello independently advertises protocol v4. Both output serializers:

- emit every non-ASCII UTF-16 code unit as a JSON `\uXXXX` escape
- preserve surrogate pairs as two escapes
- cap each final encoded line, including its newline, at 256 KiB
- never treat partial or unterminated output as a valid frame

The downstream Quickshell reader consumes only the private worker stream. It
uses raw chunks, keeps its own bounded ASCII line buffer, rejects a line
immediately past 256 KiB, and rejects trailing unterminated data when the
process exits. Diagnostics stay on stderr and must not disclose paths, UIDs,
device numbers, inode numbers, or focus material.

## Focus boundary

Focus is live capability routing, not persisted navigation. A registration is
bounded, same-user, lease-controlled, and tied to volatile worker ownership.
Activation returns only `focused`, `stale`, or `missing`. Native fallback and
restored persisted attention are non-navigable until a fresh live registration
exists. The renderer receives no executable command or backend coordinates.

## Worker lifecycle and cleanup

One shell-owned service owns one worker across monitors. Service destruction
must close stdin and terminate the child within the bounded shutdown policy.
After destruction, the shell may launch a bounded cleanup capsule:

```text
aperture-attention-engine.cjs --config <plugin-identities> --cleanup-owned-socket
```

Cleanup mode ignores the config path, loads no config, and starts no Core,
engine, or server. It resolves only the canonical XDG socket path. Startup,
normal shutdown, and cleanup serialize every cooperating socket-path mutation
through an atomic hard-link owner lock. The runtime root and package
directories must be same-UID mode `0700`; lock and socket must be same-UID mode
`0600`. A stale lock is reclaimed only after its recorded process no longer
exists.

While holding the lifecycle lock, cleanup proves the endpoint is inactive, a
same-UID socket rather than a symlink, and unchanged by device/inode across the
probe. The complete operation, including lock acquisition, has a hard 1,500 ms
deadline. A cooperating rapid re-enable cannot replace the pathname until
cleanup releases the lock, so cleanup can never unlink the replacement.

Cleanup exit codes are part of the host contract:

- `0`: endpoint absent, or the safely owned stale endpoint was removed
- `75`: lifecycle lock or endpoint remained transient through the deadline;
  safe retry outcome with no unsafe unlink
- `74`: invalid path, unsafe parent/lock metadata, symlink, non-socket, foreign
  owner, or unsafe probe failure; nonretryable

The shell must not replace this mode with an unconditional `rm`.

## Artifact and release contract

Production payloads come only from the `Aperture Worker Release` workflow for
an authorized signed source tag whose commit is on protected `main`. The tag
workflow requires a successful exact-commit Release Check, builds once on Node
22, and smokes the exact worker, direct transport, and OMP extension before
finalizing the payload. Broader compatibility matrices remain protected-main CI
evidence rather than release payload members.
Required staged files include the worker, OMP extension, private OMP manifest,
canonical schemas and fixtures, import audits, BUILDINFO, and evidence. Both
executable text artifacts are minified and each must be at most 524,288 bytes.
BUILDINFO pins `artifactLimits.maximumTextArtifactBytes: 524288`, records the
private OMP version both as top-level `ompPackageVersion` and
`integrations.omp.packageVersion`, and identifies the exact tag-workflow run.
Its sorted manifest covers the exact 30 payload files and their SHA-256 hashes,
byte counts, and modes.

The workflow creates a deterministic tag-named tarball plus
`<tag>.tar.gz.sha256` and `BUILDINFO.sha256`. Those are the release's only three
assets. Publication runs in the protected `aperture-worker-release` environment
and succeeds only when GitHub reports the published release immutable.

Downstream production vendoring is mechanical, not a manual copy:
`.github/scripts/vendor-aperture-worker-release.mjs` pins the authorized SSH tag
signer, authenticates protected-main Release Check and the exact release
workflow run, validates the checksums and every safe archive member, then
installs the exact bytes and policy.

## Ownership

### Aperture repository

Owns worker/Core composition, typed OMP and worker-direct contracts, public and
private projections, focus coordination, state migration, canonical socket
lifecycle, strict schemas and fixtures, minified artifacts, BUILDINFO, and
trusted-CI release verification.

### Aperture-for-Omarchy repository

Owns plugin lifecycle, one worker across monitors, bounded stdin/stdout handling,
native panel rendering, artifact vendoring and signature/provenance verification,
explicit OMP activation, visual proof, and removal.
It consumes the upstream contract without renderer-local aliases.

### OMP

Owns its typed `ExtensionAPI` events, plugin loading, and bounded native
fail-open alert. No hidden mutation of OMP configuration is allowed; activation
is explicit and user-initiated.

## Acceptance

- installation requires only the plugin and the Node runtime already supplied by
  supported Omarchy
- the exact signed worker and extension fit the marketplace size ceiling
- approval, input, failure, completion, resolution, shutdown, replay, and focus
  are exercised through typed direct delivery
- native fallback remains outside the Aperture surface and cannot duplicate an
  accepted or acceptance-unknown direct event
- public surface fixtures reject navigation; private worker fixtures accept only
  opaque-focus navigation
- stdout framing is ASCII-only, bounded, and fail-closed on partial data
- disable, restart, replacement, and removal prove bounded worker teardown and
  safe socket cleanup outcomes
- no separate Aperture runtime, CLI install, downloader, or package-manager
  action is required

## Historical evidence

Earlier observation and external-runtime prototypes are historical reference
designs, not current architecture. `aperture-worker-v0.6.0` at
`5e8a78f6cb94730c7748236b6c8585b047c83a4f` is immutable evidence for the
previous stock contract, but its worker exceeds the current marketplace cap
and it predates the public/private protocol-v4 split. It is not the current
production payload. `aperture-worker-v0.5.2` remains rejected audit evidence,
never a candidate or rollback. A replacement signed release and current stock
proof remain mandatory.
