# Kernel Scale Characterization

This note defines Aperture's deterministic scale check for the stateless public
kernel entrypoint. It is a release characterization, not a universal latency
service-level agreement.

## Workload

`pnpm kernel:scale` evaluates 30,000 events in three 10,000-event rounds after a
1,000-event warmup. The fixed workload rotates through eight structural event
families:

- command success under a conflicting failed transport status
- outcome-only nonzero command exit
- bounded source-window failure
- terminal diagnostic output
- search output
- structured command output
- approval input request
- completed work

The workload uses only `ApertureKernelEvent` and
`evaluateApertureKernelEvent(...)`. It does not invoke a runtime, adapter,
network, model, persistence layer, or UI.

## Determinism Proof

Each round hashes the complete `ApertureKernelResult` for every evaluation using
the Lab's canonical JSON serializer. The digest therefore covers the finalized
event, normalized Observation, observation judgment, explanation, reason codes,
and every other bounded public result field. Serialization and hashing happen
inside the timed loop, so the measurement characterizes evaluation plus the
proof work performed by the release gate.

All round digests must be identical. The check also requires at least three
rounds and 30,000 total evaluations. This catches state leakage, unstable result
ordering, and accidental reductions in the exercised scale.

## Performance Characterization

The command reports per-round throughput and mean latency, aggregate median and
minimum throughput, median and p95 round-mean latency, and the process heap delta.

The release gate applies a deliberately coarse floor of 700 evaluations per
second in every measured round. The floor is set below the observed shared-CI
runner baseline so that scheduling variance does not make the release gate
flaky. It remains a regression tripwire, not a throughput promise. Heap movement
is reported but is not gated because garbage-collection timing is process- and
runtime-dependent.

Timing values are never committed as a golden snapshot. Hardware, Node.js,
operating-system scheduling, and concurrent load all affect them. Determinism,
workload size, and the coarse floor are the release invariants.

## Current Local Characterization

On August 12, 2026, the release workload completed with:

- 30,000 evaluations across three rounds
- one identical SHA-256 result digest across all rounds
- result digest
  `sha256:9c59671865dd7ab712f554a61bc0d01191486b21fffc1f58ca3718a04ded4ed0`
- median throughput of approximately 3,890 evaluations per second
- minimum round throughput of approximately 3,719 evaluations per second
- median round-mean latency of approximately 257 microseconds
- p95 round-mean latency of approximately 269 microseconds

Run the command on the release environment for authoritative results:

```bash
pnpm kernel:scale
```
