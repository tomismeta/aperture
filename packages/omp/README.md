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

Navigable worker frames expose only a bounded opaque focus capability:

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

The trusted Omarchy payload vendors the compiled extension as:

```text
integrations/omp/aperture-omp-extension.mjs
```

OMP must explicitly load the extension package. Shipping the file inside an
Omarchy plugin does not itself activate it in OMP.
