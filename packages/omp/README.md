# @aperture/omp

First-class Oh My Pi adapter for Aperture.

The package binds OMP `ExtensionAPI` lifecycle events, maps OMP-owned facts to
canonical Aperture `SourceEvent` values, and keeps OMP-specific behavior outside
`ApertureCore`.

Exports:

- `@aperture/omp/extension` connects OMP to a normal Aperture runtime.
- `@aperture/omp/omarchy-extension` sends bounded typed facts to the
  self-contained Omarchy worker, with native notification as outside-surface fallback.

The Omarchy extension emits only approval, input, terminal failure, provisional
completion, and resolution transitions. A successful `session_stop` means that
a result may now be ready for review; subsequent same-session activity
self-corrects that provisional completion. The extension never includes prompt
transcripts, tool results, credentials, private paths, or executable
notification actions.

When the Aperture worker owns
`$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`, the Omarchy extension sends
bounded typed OMP attention facts over that same-user Unix socket. The worker
feeds those facts into `ApertureCore`; neither the adapter nor the downstream
panel chooses a lane. Acknowledged direct delivery suppresses the corresponding
native `aperture-omp` notification. A definite pre-write socket failure falls
back to a native notification outside the Aperture surface without blocking
OMP; acceptance-unknown failures do not duplicate the event.

Only private notification-worker v4 frames may expose a bounded opaque focus capability:

```json
{ "navigation": { "kind": "opaque-focus", "handle": "<32-character opaque handle>" } }
```

The handle is available only for a validated Herdr, direct Foot, or tmux
interactive context. Activation is focus-only and returns `focused`, `stale`,
or `missing`; it never approves, answers, dismisses, completes, engages,
resumes, or attaches a session. Native notification fallbacks and unsupported
contexts remain non-navigable. Socket, pane, marker, host-generation,
compositor, tmux option, and toplevel address facts are volatile worker-private
state and are never projected or persisted.
Herdr pane IDs are bounded opaque identifiers, including base-style IDs such
as `wA:p1`; Aperture never derives numeric workspace or pane semantics.
The focus backends are deliberately limited to Herdr, direct Foot, and tmux.
Kitty, WezTerm, Zellij, Ghostty, Alacritty, and generic terminal contexts are
unsupported and remain non-navigable; there are no heuristic probes or aliases.

When `omarchy-notification-send` is executable, the Omarchy extension disables
OMP's built-in notifications process-locally to avoid duplicates. It restores
the prior setting and disables adapter delivery for the rest of the session on
delivery failure; shutdown also restores it. If the sender is unavailable,
built-in notifications remain enabled.

The staged private OMP manifest is version `0.1.0`, independently from the
Aperture product package version.

BUILDINFO records that version both at `ompPackageVersion` and
`integrations.omp.packageVersion`; it pins the worker/extension text ceiling as
`artifactLimits.maximumTextArtifactBytes: 524288`.

The trusted Omarchy payload vendors the compiled extension as:

```text
integrations/omp/aperture-omp-extension.mjs
```

OMP must explicitly load the extension package. Shipping the file inside an
Omarchy plugin does not itself activate it in OMP.
