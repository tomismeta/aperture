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

## Current Status

As of 2026-04-11, the first major hardening pass is in code:

- sanctioned internal package entrypoints replaced sibling-package source reach-ins
- runtime HTTP handling moved onto a small route table with shared auth, rate-limit, and error helpers
- `/work` now uses one generated contract source for TypeScript, validation, and JSON Schema artifacts
- local runtime routes now require a bearer token on every non-health path
- work-response state is bounded, persisted, expirable, and cancellable
- large adapter mapping files are now split by responsibility so the public mappers stay as composition roots instead of implementation dumps
- core clock handling is now injected through the judgment path instead of relying on raw wall-clock parsing
- markdown reloads are coalesced so runtime state refresh does not race itself
- attention planner routing now lives in its own module so the planner facade focuses on evidence resolution and continuity application
- Codex mapping is now split by request, notification, response, and shared support instead of one central mapper
- Claude Code mapping is now split by request, lifecycle, and shared support instead of one central mapper
- OpenCode mapping is now split by request, lifecycle, response, and shared support instead of one central mapper
- Lab F-Stop CLI parsing now keeps shared provider and coercion helpers in a separate support module so the main command parser can stay a composition root
- Lab F-Stop review and calibration parsing now live in dedicated modules instead of remaining embedded inside the general CLI args file
- Lab F-Stop command execution now lives in command-family modules for autoresearch, review, ingest, GC, and shared CLI I/O instead of one central shell file
- Lab trajectory ingest now separates raw file and dataset normalization from Aperture bundle/session emission so the public ingest entry stays focused on artifact creation
- Lab autoresearch final reporting now separates synthesis, file I/O, and markdown rendering so the report logic can evolve without one catch-all module
- Offline review now separates domain orchestration from preparation/recommendation helpers, validation, rendering, and file persistence so the main review module stays a compatibility facade
- Autoresearch calibration now separates promotion/evaluation orchestration from semantic-family support, validation, rendering, and file persistence so the main calibration module stays a compatibility facade
- Lab session bundles are now split into contract/model, scenario conversion, runtime capture conversion, and file I/O modules so the public entrypoint stays as a compatibility facade
- Lab validation is now split into event, replay, and shared support modules so the public validator entrypoint stays as a compatibility facade instead of a 900-line mixed concern file
- Lab public trajectory adapters now keep dataset fetching/parsing separate from imported-session and bundle emission logic, so each dataset surface stays reviewable without changing the aggregate API
- launcher startup warnings are visible by default, with verbose stack output available when requested
- module budgets now track the new mapper family files directly so future growth has to stay within owned seams, including the extracted Lab CLI, offline-review, and autoresearch-calibration modules

The remaining work is mostly continued decomposition of core orchestration and
further artifact/versioning cleanup, not re-litigating the public local ingress
shape.

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
