# Aperture v0.5.0

## Work Contract Consumer Surface

This release makes the host-neutral Work contract a supported product surface
and carries the current deterministic semantic and judgment hardening into the
installable product bundle:

- `@tomismeta/aperture/work` exposes Work `1.0` types, schema documents, version
  constants, and a bounded client for publishing work and polling responses.
- The client can use explicit `baseUrl` and `authToken` values or discover one
  local Aperture runtime from its registration directory.
- Unsupported Work versions return `unsupported_work_spec_version` with the
  received version, supported version, and batch index when applicable.
- Work publication is fail-closed: rejected batches publish zero events.
- `/work` and `/work/response/{interactionId}` are the canonical live routes;
  `/v1/work` aliases are not part of the supported surface.
- Invalid, malformed, or future-version persisted work-response state aborts
  startup without rewriting the original file.

## Compatibility

The live Work contract now accepts exactly `specVersion = "1.0"` or an omitted
`specVersion` that Aperture fills with `1.0`. Producers that previously sent
another `1.x` value must migrate before upgrading.

The public package remains independent of the private `@aperture/runtime`
package. Runtime and Core internals are not published as package dependencies or
new public entry points by this release.

The product bundle includes the current Core semantic and judgment behavior,
but this product cut does not independently publish the Core SDK candidate.
Consumers embedding Core should continue to treat the Core `0.9.0` notes as
pre-release until its separate release gate is complete.

## Bundled Engine Behavior

The product bundle also carries the current Core hardening work:

- host-native `SourceEvidence` facts are authoritative over contradictory prose
  and flow through the same Observation and judgment path as text fallback
- recurring task-failure payloads use one structural observation grammar rather
  than provider-specific template detectors
- reliable truncation is represented as bounded evidence loss with a recovery
  hint instead of being promoted to a generic critical failure
- semantic quality gates and host-neutral kernel proofs remain part of build
  validation, while the product continues to ship with no runtime package
  dependency

## Proof

The release gate includes a packed-tarball consumer proof that installs the
product in a clean temporary Node project, imports `@tomismeta/aperture/work`,
checks the public declarations for private references, compiles a TypeScript
consumer against the packed declarations, and publishes a Work payload
through the bounded client.
