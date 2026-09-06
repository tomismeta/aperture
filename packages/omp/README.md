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
completion, resolution, and shutdown transitions. A successful `session_stop`
means that a result may now be ready for review; subsequent same-session
activity self-corrects that provisional completion. Keyed callbacks derive
identity from stable OMP session/agent-run/turn/interaction facts, not callback
time or presentation. OMP restarts its numeric `turn_id` at every `agent_start`.
The binding therefore owns an opaque agent-run identity that changes at that
boundary; replay keeps the original mapped identity. Fresh runs and resumed
processes cannot collide with already-resolved completions, while duplicate
facts still retry the same event ID. Direct callers of
`mapOmpDirectAttentionEvents` must supply `context.agentRunId` for `session_stop`;
the bound extensions provide it automatically. The extension never includes prompt transcripts,
tool results, credentials, private paths, or executable notification actions.

When the Aperture worker owns
`$XDG_RUNTIME_DIR/omarchy/aperture/attention.sock`, the Omarchy extension sends
bounded typed OMP attention facts over that same-user Unix socket. The worker
feeds those facts into `ApertureCore`; neither the adapter nor the downstream
panel chooses a lane. A native `aperture-omp` fallback is permitted only for a
definite failure before any socket write. Acceptance-unknown and post-write
outcomes retry the same event ID and never emit native fallback. A
`processing_timeout` acknowledgement is treated as acceptance-unknown rather
than a durable rejection. Requests accepted by the direct worker establish
direct authority for their resolutions and session shutdown: those closure
facts retry directly and are cleared only by acknowledgement or worker-side
session lease expiry. After a worker restart, a heartbeat renews transport
liveness but only a fresh direct attention delivery preserves restored rows past
the reconnect grace. Completion-family resolution fences completions at or
before its occurrence; a genuinely newer turn may create a new completion.
Session shutdown likewise fences attention at or before its occurrence without
blocking genuinely newer work when the same conversation is resumed. Each
shutdown occurrence has its own receipt identity, so a later shutdown cannot
be mistaken for a retry of an earlier one. Session heartbeats keep their regular
cadence even during continuous OMP activity.
Each successful focus registration creates a fresh private receipt episode token.
Replay event IDs include that token, remain stable across transient retries in
the episode, and change after re-registration even when the worker generation
is unchanged.

Only private OMP-worker v4 frames may expose a bounded opaque focus capability:

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
When a registered focus capability expires, navigation is removed immediately.
Unread completions remain until successful activation, explicit completion
resolution, or independent session-liveness expiry; focus loss does not imply
that a result was consumed. A fresh accepted attention delivery can restore
navigation with a valid capability. A stale Herdr recovery claim cannot revoke
other panes while their shared socket and exact marked surface remain healthy.
Herdr pane IDs are bounded opaque identifiers, including base-style IDs such
as `wA:p1`; Aperture never derives numeric workspace or pane semantics.
The focus backends are deliberately limited to Herdr, direct Foot, and tmux.
Kitty, WezTerm, Zellij, Ghostty, Alacritty, and generic terminal contexts are
unsupported and remain non-navigable; there are no heuristic probes or aliases.

When `omarchy-notification-send` is executable, the Omarchy extension disables
OMP's built-in notifications process-locally to avoid duplicates. It restores
the prior setting and disables adapter delivery for the rest of the session only
after a terminal delivery failure; acceptance-unknown retries do not disable
delivery. Shutdown also restores the prior setting. If the sender is
unavailable, built-in notifications remain enabled.

The staged private OMP manifest is version `0.1.1`, independently from the
Aperture product package version.

BUILDINFO schema v2 records that version only at
`integrations.omp.packageVersion`; it pins the worker/extension text ceiling as
`artifactLimits.maximumTextArtifactBytes: 524288`. Release checks compare this
identity with the staged manifest and the source component manifest, rather than
pinning an eternal component version in tooling. Component semver advances for
immutable component releases, not every commit.

The trusted Omarchy payload vendors the compiled extension as:

```text
integrations/omp/aperture-omp-extension.mjs
```

OMP must explicitly load the extension package. Shipping the file inside an
Omarchy plugin does not itself activate it in OMP.
