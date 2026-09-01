# @aperture/omp

First-class Oh My Pi adapter for Aperture.

The package binds OMP `ExtensionAPI` lifecycle events, maps OMP-owned facts to
canonical Aperture `SourceEvent` values, and keeps OMP-specific behavior outside
`ApertureCore`.

Exports:

- `@aperture/omp/extension` connects OMP to a normal Aperture runtime.
- `@aperture/omp/omarchy-extension` emits bounded adapter-owned Omarchy
  notifications for the self-contained Omarchy attention plugin.

The Omarchy extension emits only approval, input, terminal failure, completion,
and resolution transitions. It never includes prompt transcripts, tool results,
credentials, private paths, or executable notification actions.

When `omarchy-notification-send` is executable, the Omarchy extension disables
OMP's built-in notifications process-locally to avoid duplicates. It restores
the prior setting and disables adapter delivery for the rest of the session on
delivery failure; shutdown also restores it. If the sender is unavailable,
built-in notifications remain enabled.

The trusted Omarchy payload vendors the compiled extension as:

```text
integrations/omp/aperture-omp-extension.mjs
```

OMP must explicitly load the extension package. Shipping the file inside an
Omarchy plugin does not itself activate it in OMP.
