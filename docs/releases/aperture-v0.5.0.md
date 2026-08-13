# Aperture v0.5.0

## Work Contract Consumer Surface

This release makes the host-neutral Work contract a supported product surface:

- `@tomismeta/aperture/work` exposes Work `1.0` types, schema documents, version
  constants, and a bounded client for publishing work and polling responses.
- The client can use explicit `baseUrl` and `authToken` values or discover one
  local Aperture runtime from its registration directory.
- Unsupported Work versions return `unsupported_work_spec_version` with the
  received version, supported version, and batch index when applicable.
- Work publication is fail-closed: rejected batches publish zero events.
- `/work` and `/work/response/{interactionId}` are the canonical live routes.
  The unreleased `/v1/work` aliases are removed.
- Invalid, malformed, or future-version persisted work-response state aborts
  startup without rewriting the original file.

## Compatibility

The live Work contract now accepts exactly `specVersion = "1.0"` or an omitted
`specVersion` that Aperture fills with `1.0`. Producers that previously sent
another `1.x` value must migrate before upgrading.

The public package remains independent of the private `@aperture/runtime`
package. Runtime and Core internals are not part of this release surface.

## Proof

The release gate includes a packed-tarball consumer proof that installs the
product in a clean temporary Node project, imports `@tomismeta/aperture/work`,
checks the public declarations for private references, compiles a TypeScript
consumer against the packed declarations, and publishes a Work payload
through the bounded client.
