# Aperture v0.4.2

`@tomismeta/aperture@0.4.2` is a product trust and preference-inspection patch
release.

It keeps the `0.4.x` runtime shape, `/work` ingress contract, bundled
`@tomismeta/aperture-core@0.7.0` judgment engine, and adapter behavior intact
while making Aperture's local preference state easier to inspect and trust.

## Highlights

- adds `aperture config`, a read-only report for active `APERTURE.md`
  preferences, policy rules, learned `MEMORY.md` behavior, diagnostics, and
  suggested policy snippets
- surfaces control-mode influence in TUI why-mode so preference effects are
  easier to understand during live review
- keeps suggested policy learning human-owned: Aperture prints copy-paste
  snippets, but does not rewrite `APERTURE.md`
- expands product/TUI formatting coverage so future changes stay consistent
- keeps the new config and why-mode surfaces under module-budget checks

## Why This Matters

This release tightens the operator trust loop.

In practice that means:

- users can see what Aperture thinks their preferences and policy are
- ignored or invalid preference lines are easier to spot
- learned suggestions are visible without becoming automatic hidden mutation
- why-mode explains when control mode changed the attention decision

## What Did Not Change

This release does **not** change:

- the public `@tomismeta/aperture-core` SDK surface
- the host-neutral `/work` contract
- adapter protocol behavior
- the product stance that explicit preferences remain human-owned

## Validation

Validated with:

```bash
pnpm release:check
```

That includes typecheck, lint, formatting, dependency audit, contract/schema
checks, boundary and architecture checks, the full test suite, judgment battle,
SDK proof, and product smoke.

## Install

```bash
npm install -g @tomismeta/aperture
aperture
```

See:

- [Product README](../../packages/aperture/README.md)
- [Aperture v0.4.1](./aperture-v0.4.1.md)
- [Aperture Core SDK v0.7.0](./aperture-core-v0.7.0.md)
