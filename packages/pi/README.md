# @aperture/pi

Pi adapter package for Aperture.

This package keeps Pi-specific session, tool, and lifecycle events at the
adapter boundary and normalizes them into Aperture `SourceEvent` objects. It
does not change `@tomismeta/aperture-core`.

The Pi SDK is treated as an optional peer dependency. That lets Pi load the
adapter as a native extension without bundling Pi into Aperture itself.

Import `@aperture/pi/extension` for the no-config default extension, or use
`createAperturePiExtension()` when a host needs custom runtime settings.
