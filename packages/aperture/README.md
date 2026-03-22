# Aperture

The attention surface for agent work.

`@tomismeta/aperture` is the live attention surface for humans working with
agents like Claude Code and OpenCode.

Install it, run `aperture`, and keep the agent work that needs you in one
place.

## What Aperture Does

Aperture ships the `aperture` CLI as the opinionated local product:

- boot the shared runtime
- connect Claude Code and OpenCode
- open the Aperture TUI
- route what needs you into `now`, `next`, and `ambient`
- capture replayable sessions from real work

## Quick start

Requires Node 18 or newer.

```bash
npm install -g @tomismeta/aperture
aperture
```

If you want Claude Code, connect it once:

```bash
aperture claude connect --global
```

Then restart Claude Code and confirm `/hooks` loaded.

If you want OpenCode, run:

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
```

Then launch Aperture:

```bash
aperture
```

If you are looking for the embeddable SDK instead of the product, install
`@tomismeta/aperture-core`.

## Common commands

```bash
aperture
aperture --capture
aperture doctor
aperture debug
aperture completion zsh
aperture --version
aperture help
aperture help claude
aperture help uninstall
```

## Why start here

Most people should start with `@tomismeta/aperture`, not the SDK.

Use this package if you want:

- a local CLI/TUI product
- one attention surface for Claude Code and OpenCode
- approvals, follow-ups, failures, and blocked work in one place
- bundle capture for troubleshooting real sessions

Use `@tomismeta/aperture-core` if you want to build your own runtime, adapter,
or surface around the judgment engine.

## Product state

Aperture stores its product-owned local state under:

```text
~/.aperture
```

That includes:

- OpenCode connection profiles
- launcher captures
- runtime discovery state
- learning state for the opinionated product runtime

## Clean uninstall

Before uninstalling the npm package, remove Aperture-owned local state and Claude hook entries:

```bash
aperture uninstall --yes
```

If you also installed project-local Claude hooks, remove those too:

```bash
aperture uninstall --yes --project /path/to/project
```

That project-targeted cleanup also removes the project's local `.aperture` state.

Then remove the package itself:

```bash
npm uninstall -g @tomismeta/aperture
```
