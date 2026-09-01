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

When the Aperture worker owns
`$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`, the Omarchy extension sends
bounded typed OMP attention facts over that same-user Unix socket. The worker
feeds those facts into `ApertureCore`; neither the adapter nor the downstream
panel chooses a lane. Acknowledged direct delivery suppresses the corresponding
native `aperture-omp` notification. Socket failure falls back to the existing
Ambient-only native notification path without blocking OMP.

Navigable worker frames expose only:

```json
{ "navigation": { "kind": "omp-session", "sessionId": "<opaque-native-id>" } }
```

The downstream argv-only resume contract is exactly:

```text
["omp", "--resume", "<full sessionId>"]
```

`sessionId` is the full native OMP session-manager ID, not a file path or text
inferred from a prompt, title, working directory, or notification. It is passed
as one argv value with no shell interpolation. Navigation does not approve,
dismiss, complete, engage, or otherwise mutate the Aperture frame.

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
