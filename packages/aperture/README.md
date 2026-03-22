# Aperture

The live attention surface for humans supervising agents.

`@tomismeta/aperture` ships the `aperture` CLI as the opinionated local product:

- boot the shared runtime
- connect Claude Code and OpenCode
- open the Aperture TUI
- capture replayable sessions from real work

## Quick start

Requires Node 18 or newer.

```bash
npm install -g @tomismeta/aperture
aperture
```

For the default OpenCode path, run:

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
```

Then launch Aperture:

```bash
aperture
```

## Useful commands

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
