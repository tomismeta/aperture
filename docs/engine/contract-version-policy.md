# Contract Version Policy

Aperture keeps one current version at each live contract boundary.

## Rule

Every runtime or public package contract has exactly one accepted current
version. A new version requires an intentional migration decision, a fixture
for the old format, and an explicit compatibility boundary. Adding a permissive
version pattern or silently accepting the next version is not allowed.

Historical Lab readers may retain old formats for replay and auditability, but
they must be isolated from live ingestion and named as archival behavior.

## Current Boundaries

- Core state and Markdown persistence: version `1`
- Attention decision records: version `1`
- Work event API: version `1.0`
- Work-response persistence: version `1`
- OpenCode connection config: version `1`
- Session bundles: version `1`
- Current Lab decision projection: version `2`
- Public surface protocol: exact version `4`; hello requires
  `protocolVersion: 4`, and public frames contain no navigation
- Notification-worker input: exact schema version `2`
- Private notification-worker output: exact version `4`; hello requires
  `protocolVersion: 4`, and only private frames may carry the exact
  `{ kind: "opaque-focus", handle }` navigation capability
- OMP attention event: exact schema version `2`
- Private worker-direct message and acknowledgement protocol: exact version `4`
- OMP direct persisted state: exact version `3`, with explicit migration from
  versions `1` and `2`

The kernel explanation is an ephemeral result, not a persisted compatibility
boundary; package semver governs changes to it.

Package semver does not stand in for a protocol version. In particular, the
private `@tomismeta/aperture-omp` manifest has its own release version and need
not equal the `@tomismeta/aperture` product version; BUILDINFO records both.
Artifact BUILDINFO independently pins
`artifactLimits.maximumTextArtifactBytes: 524288` and repeats the private
version at `integrations.omp.packageVersion`.

## Enforcement

- Each live boundary owns one version constant.
- Validators compare against that constant exactly.
- A compatibility contraction is a release-level contract change: Work ingress
  previously accepted `1.x`, and now accepts only `1.0`.
- Generated schemas are checked with `pnpm contract:check`.
- `packages/runtime/test/contract-version-policy.test.ts` locks the Work and
  Core state rules and rejects `1.1` and `2.0` Work ingress.
- Historical projection v1 remains readable only in Lab migration/replay code.

Before introducing a new live version, update this policy, add the migration
and compatibility fixture, and have the release review explicitly approve the
additional supported version.
