# @aperture/pi

Pi adapter package for Aperture.

This is a private, source-only workspace integration. It is not a separately
published npm package and is not wired into the `@tomismeta/aperture` launcher.

This package keeps Pi-specific session, tool, and lifecycle events at the
adapter boundary and normalizes them into Aperture `SourceEvent` objects. It
does not change `@tomismeta/aperture-core`.

The Pi SDK is treated as an optional peer dependency. That lets Pi load the
adapter as a native extension without bundling Pi into Aperture itself.

Import `@aperture/pi/extension` for the no-config default extension, or use
`createAperturePiExtension()` when a host needs custom runtime settings.

Command approvals preserve the command summary for core-owned generic risk
inference: ordinary shell commands start at medium consequence, while destructive
commands can escalate to high. Pi's read-like tools retain low source risk hints,
and edit/write policy retains high hints. Native Pi response translation is unchanged.
