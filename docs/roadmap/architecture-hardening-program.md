# Architecture Hardening Program

This note turns the current architecture audit into an execution program.

The goal is not to make Aperture "more enterprise" by adding abstraction.

The goal is to make the existing product and SDK:

- cleaner at package seams
- smaller at public surfaces
- easier to change safely
- easier for senior engineers to trust on inspection

This program is intentionally ordered.

Some improvements only make sense after earlier seams are fixed. Doing all of
them at once would create unnecessary blast radius and make regressions harder
to attribute.

## Design Rules

These rules should remain true throughout the work:

1. keep `@tomismeta/aperture-core` transport-free
2. keep `@tomismeta/aperture` the only product package
3. keep `/work` the only public local ingress surface
4. keep `/runtime/*` internal and unstable
5. reduce duplicate execution models instead of adding new ones
6. prefer smaller owned modules over giant "central" files
7. prefer explicit contracts over relative source imports

## Summary

The program is split into four tranches:

1. boundary hardening
2. runtime and client decomposition
3. core and validation decomposition
4. adapter, lab, and artifact modularization

## Tranche 1: Boundary Hardening

This tranche is the foundation. Nothing else matters if package boundaries are
only aspirational.

### Objectives

- eliminate direct `../../core/src/*` imports from non-core packages
- define one sanctioned internal seam for workspace-private contracts
- remove duplicate launcher and repo-only execution paths where a package entry
  already exists
- tighten architecture fitness checks so the boundary is enforced automatically

### Acceptance Criteria

- no non-test package imports from `packages/core/src/*` except one sanctioned
  internal surface
- boundary check covers Lab and runtime-facing packages
- root scripts become thin wrappers around package entrypoints, not alternate
  implementations

## Tranche 2: Runtime And Client Decomposition

Once the boundary is real, split the runtime and client machinery into smaller
owned modules.

### Objectives

- split the runtime server into route modules and shared HTTP primitives
- separate public `/work` handling from internal runtime control routes
- extract duplicated client polling, heartbeat, and fetch logic into shared
  runtime transport/session helpers

### Acceptance Criteria

- `packages/runtime/src/runtime.ts` becomes a small composition root
- runtime routes are grouped by concern rather than by one giant request handler
- adapter and runtime clients share transport/session infrastructure

## Tranche 3: Core And Validation Decomposition

After the runtime edges are cleaner, decompose the core and the validation
story.

### Objectives

- split `ApertureCore` orchestration into smaller internal services
- separate publish pipeline, engagement policy, and response/signal lifecycle
- reduce validation drift across core, runtime, and work ingress

### Acceptance Criteria

- `ApertureCore` remains the public facade, but not the implementation dumping
  ground
- shared validation contracts are reused where possible
- explanation and trace seams stay stable during the split

## Tranche 4: Adapter, Lab, And Artifact Modularization

This tranche turns the largest remaining modules into bounded subsystems.

### Objectives

- split host adapter mapping files by event family
- split F-Stop and offline review into bounded command/domain modules
- formalize capture-to-review artifacts as a first-class versioned contract

### Acceptance Criteria

- adapter mappers are organized by host event family with shared primitives
- Lab CLI files become composition roots rather than giant command registries
- capture/review artifacts are owned in one place and consumed from there

## Improvement Matrix

| Audit Improvement | Tranche |
| --- | --- |
| Real package boundary enforcement | 1 |
| Remove duplicate execution surfaces | 1 |
| Architecture fitness functions | 1 |
| Split runtime server | 2 |
| Unify runtime clients | 2 |
| Decompose `ApertureCore` | 3 |
| Unify validation contracts | 3 |
| Split adapter mappers | 4 |
| Modularize Lab / F-Stop | 4 |
| First-class capture/review contract | 4 |

## Working Rule

Each tranche should be mergeable, testable, and understandable on its own.

This is a hardening program, not a rewrite.
