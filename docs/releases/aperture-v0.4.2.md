# Aperture v0.4.2

`@tomismeta/aperture@0.4.2` is a product trust, preference-inspection,
experimental Codex opt-in, and Codex hook reliability patch release.

It keeps the `0.4.x` runtime shape, `/work` ingress contract, bundled
`@tomismeta/aperture-core@0.7.0` judgment engine, and dependency-free product
package posture intact while making Aperture's local preference state easier to
inspect and trust.

## Highlights

- adds `aperture config`, a read-only report for active `APERTURE.md`
  preferences, policy rules, learned `MEMORY.md` behavior, diagnostics, and
  suggested policy snippets
- surfaces control-mode influence in TUI why-mode so preference effects are
  easier to understand during live review
- keeps suggested policy learning human-owned: Aperture prints copy-paste
  snippets, but does not rewrite `APERTURE.md`
- adds an experimental, explicit Codex hook path to the packaged product while
  keeping the Codex App Server bridge source-only
- installs Codex hook commands with an explicit Aperture bridge URL, so live
  Codex sessions do not depend on Codex inheriting Aperture's hook-port
  environment
- documents the Codex `/hooks` review-and-trust step required before Codex
  runs user hook entries
- expands product/TUI formatting coverage so future changes stay consistent
- keeps the new config and why-mode surfaces under module-budget checks

## Why This Matters

This release tightens the operator trust loop.

In practice that means:

- users can see what Aperture thinks their preferences and policy are
- ignored or invalid preference lines are easier to spot
- learned suggestions are visible without becoming automatic hidden mutation
- why-mode explains when control mode changed the attention decision
- opt-in Codex hooks can be tested from the packaged product without hidden
  dependency or environment coupling

## What Did Not Change

This release does **not** change:

- the public `@tomismeta/aperture-core` SDK surface
- the host-neutral `/work` contract
- the normal launch path: Codex remains inactive unless the user opts in
- the dependency-free product package stance
- the source-only Codex App Server bridge stance
- the product stance that explicit preferences remain human-owned

## Validation

Validated with:

```bash
pnpm release:check
```

That includes typecheck, lint, formatting, dependency audit, contract/schema
checks, boundary and architecture checks, the full test suite, judgment battle,
SDK proof, and product smoke.

The final Codex hook path was also live-smoked from an installed product
tarball with `@openai/codex@0.133.0`, a non-default hook port, trusted Codex
hooks, and no Aperture hook environment variables in the Codex process.

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.4.1](./aperture-v0.4.1.md)
- [Aperture Core SDK v0.7.0](./aperture-core-v0.7.0.md)
