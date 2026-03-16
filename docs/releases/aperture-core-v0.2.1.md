# Aperture Core SDK v0.2.1

Patch release for `@tomismeta/aperture-core`.

This release tightens core routing correctness and adds an optional stale-response safety guard for hosts that need approval revalidation.

## Highlights

- fixed peripheral routing edge cases where work that should have remained `ambient` or `queue` could incorrectly activate
- clarified the boundary between:
  - soft peripheral posture
  - sticky peripheral presentation floors from policy
- preserved explicit configured and background peripheral policy through criterion evaluation
- kept visible queued episode work batching correctly when no active task frame is present
- added optional `responseExpiryMs` on `ApertureCore`
  - response-capable frames can now expire
  - expired submissions are rejected so the host can revalidate before executing stale approvals

## Recommended tag

- `aperture-core-v0.2.1`
