# OMP Adapter and Omarchy Delivery Handoff

## Decision

`@aperture/omp` remains the OMP-specific mapping package. The production
Aperture-for-Omarchy path is a focused, self-contained OMP channel made from two
signed artifacts built from one reviewed Aperture commit:

```text
lib/aperture-attention-engine.cjs
integrations/omp/aperture-omp-extension.mjs
```

The extension is imported by OMP and default-exports an `ExtensionAPI` factory.
The worker is a Node 22 CommonJS JSONL process that owns `ApertureCore`, state,
and the canonical XDG socket. Neither artifact requires `node_modules`, npm,
pnpm, a downloader, or a separately installed Aperture CLI/runtime.

## Delivery architecture

```text
OMP ExtensionAPI
  -> deterministic @aperture/omp mapping
  -> OMP attention event schema v2
  -> worker-direct protocol v4
  -> $XDG_RUNTIME_DIR/omarchy/aperture/attention.sock
  -> stateful ApertureCore
  -> private notification-worker output v4
  -> Omarchy panel
```

This path does not publish through an external runtime adapter and does not
attach to an Aperture runtime. The extension sends bounded typed facts directly
to the worker. The worker alone makes lane decisions.

The generic runtime route remains useful to the upstream Aperture product,
but it is not shipped or used by the self-contained Omarchy plugin. Aperture's
upstream product remains Claude-first; Omarchy is this deliberately narrow OMP
channel.

## Exact live contracts

- OMP attention events: exact schema version `2`
- worker-direct messages and acknowledgements: exact protocol version `4`
- notification-worker input: exact schema version `2`
- private notification-worker output: exact version `4`
- public companion surface: exact protocol version `4`

Both output hello frames carry `protocolVersion: 4` independently from package
semver. Public surface frames contain no navigation field. Private worker frames
may carry only the bounded volatile capability:

```json
{ "kind": "opaque-focus", "handle": "A23456789_-bcdefghijklmnopqrstuv" }
```

No session ID, transcript path, executable argv, socket path, host generation,
backend target, pane ID, compositor address, or recovery marker may be projected
as navigation or persisted as focus state.

## OMP extension manifest

The staged private manifest is independently versioned:

```json
{
  "name": "@tomismeta/aperture-omp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "omp": {
    "extensions": ["./aperture-omp-extension.mjs"]
  }
}
```

BUILDINFO records `ompPackageVersion: "0.1.0"` separately from the Aperture
product and Core versions, and repeats it at
`integrations.omp.packageVersion`. Build and release checks compare the staged
manifest to both fields and must not assume the OMP and product versions are
equal.

## Mapping contract

Typed OMP lifecycle events map deterministically to the narrow attention event
DTO. Required families are:

- approval requested and resolved
- ask/input requested and resolved
- terminal tool or provider failure
- terminal completion
- session stop failure and shutdown
- bounded status updates used by the worker's state machine

Stable identity comes only from typed OMP session, turn, tool-call, request, and
interaction fields. The adapter never parses terminal text, notification prose,
transcripts, or private session files. Prompt text, raw tool input/output,
approval reasons, credentials, private paths, and executable commands are
forbidden from the direct event.

## Delivery and fallback

Direct delivery is acknowledged and bounded. An accepted event suppresses its
corresponding native notification. A definitely-pre-write failure may use the
native OMP notification as a fail-open fallback outside the Aperture surface.
An acceptance-unknown failure must not send a duplicate. The native fallback is
non-navigable and is never looped through notification observation into the
worker.

Transport failure never aborts, blocks, or corrupts the OMP session. Delivery
queues, connection and acknowledgement deadlines, retry counts, and receipt
records remain bounded. Resolution and shutdown tombstones dominate delayed
replay.

## Focus contract

`focus.register` and `focus.revoke` are private worker-direct v4 messages. A
registration carries one 32-character public handle and validated worker-private
backend data. Handles are leased, volatile, capacity-bounded, and invalidated on
revoke, expiry, backend loss, or worker replacement.

Private snapshots receive navigation only after a live registration. Activation
accepts a handle and returns exactly `focused`, `stale`, or `missing`. Persisted
or native-fallback frames restore without navigation. The panel never receives
an executable focus command.

## JSONL framing

Both the private worker output and public stdio surface are ASCII-only JSONL.
Each serializer escapes every non-ASCII UTF-16 code unit as `\uXXXX`, including
both code units of a surrogate pair, then enforces the 256 KiB limit on the
final encoded line including its newline. The private Quickshell consumer owns
a bounded raw-chunk line buffer and rejects overflow or unterminated trailing
data. Public output uses the same byte-safe framing but can never carry
navigation.

## Socket lifecycle

The extension and worker use only
`$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`. Startup, normal shutdown,
and cleanup serialize every cooperating pathname mutation with an atomic
hard-link owner lock. Runtime/package directories are same-UID mode `0700`;
lock and socket are same-UID mode `0600`. Startup refuses active or unsafe
endpoints and reclaims only a fully validated stale lock whose recorded process
no longer exists.

After service destruction the Omarchy shell may run:

```text
aperture-attention-engine.cjs --config <plugin-identities> --cleanup-owned-socket
```

Cleanup mode accepts but ignores the launcher-owned config argument and starts
no Core, engine, or server. While holding the lifecycle lock, it proves the
endpoint inactive, same-UID, a socket rather than a symlink, and unchanged by
device/inode before unlink. The complete operation has a 1,500 ms deadline.
Exit `0` means absent or removed, `75` means a safe transient timeout, and `74`
means unsafe/nonretryable. A cooperating rapid re-enable waits for the lock, so
the old cleanup invocation cannot unlink the replacement. Diagnostics contain
no path or file metadata.

## Artifact contract

Trusted CI stages the worker, extension, manifest, schemas, canonical fixtures,
runtime-import audits, compatibility evidence, and BUILDINFO. Production builds
minify both text artifacts. Each staged artifact independently must be no larger
than 524,288 bytes, and BUILDINFO pins that ceiling at
`artifactLimits.maximumTextArtifactBytes: 524288`.

`Aperture Worker Release` is the sole production release workflow. It accepts
only an authorized signed tag on protected `main`, requires successful
exact-commit Release Check, and re-smokes the exact worker, direct transport,
and OMP extension on Node 22. Broader compatibility matrices remain
protected-main CI evidence rather than release payload members. The final
BUILDINFO records the release workflow's exact run identity and a sorted
30-file manifest without attestation or provenance fields.

The deterministic archive, its SHA-256 sidecar, and `BUILDINFO.sha256` are the
release's only assets. The workflow verifies that exact draft asset set before
publishing and requires GitHub to report the published release immutable. Both
runtime artifacts remain dependency-free except for audited `node:` builtins.
Downstream production vendoring runs only through the downstream-pinned tag
signer and authenticated release tool; locally built or manually copied bytes
are never eligible.

## Activation and removal

Shipping the manifest does not silently activate it. OMP activation is an
explicit user action against the verified installed integration directory. The
handoff does not prescribe a historical plugin ID or hard-coded checkout path.
No shell startup hook or worker process may mutate OMP configuration.

Removal first stops the worker and runs bounded owned-socket cleanup, then
disables and unlinks the exact verified OMP integration. It must not depend on
Bun, invoke a package installer, or delete an unverified symlink or lock entry.

## Ownership

### Aperture repository

Owns OMP types and mapping, direct transport, worker/Core implementation,
private focus routing, protocols and schemas, fixtures and tests, minified
artifact builds, BUILDINFO, evidence, and release verification.

### Aperture-for-Omarchy repository

Owns authenticated vendoring, explicit OMP activation, service/process
lifecycle, bounded stdout consumption, panel behavior, focus requests, visual
proof, and safe removal. Native fallback presentation remains owned by OMP and
outside the Aperture surface.

### OMP upstream

Owns the typed extension event API and plugin loader. Aperture does not require
OMP changes or hidden user-configuration mutation for this release.

## Acceptance

- actual OMP loader imports the signed extension with no runtime package install
- typed approval, input, failure, completion, resolution, and shutdown events
  reach the worker through protocol v4
- accepted direct events suppress duplicates; fallback stays outside the
  Aperture surface
- Core remains the sole lane authority
- only private worker frames can carry a valid opaque-focus handle
- public projection and schema reject navigation
- state and focus privacy canaries do not reach persisted or projected output
- stdout is ASCII-only and bounded after escaping
- active, replaced, symlinked, non-socket, foreign, and invalid socket cleanup
  cases fail with the specified codes and no unsafe unlink
- worker and extension each fit the 524,288-byte marketplace ceiling
- BUILDINFO records independent product, Core, and OMP package versions
- no separate Aperture runtime, installer, downloader, or `node_modules` is
  present

## Historical evidence

Earlier runtime and observation routes remain historical engineering evidence,
not the current Omarchy architecture. `aperture-worker-v0.6.0` at
`5e8a78f6cb94730c7748236b6c8585b047c83a4f` is immutable evidence for the
previous stock contract, but exceeds the current worker cap and predates the
public/private protocol-v4 split. It is not the current production payload.
`aperture-worker-v0.5.2` remains rejected and is neither a candidate nor a
rollback. A replacement signed release and current stock proof are pending.
