---
name: aperture_lab_fstop
description: Run Aperture Lab F-Stop, the offline discovery, calibration, and proposal subsystem for Aperture. Use when operating the product-facing lab:fstop:* command surface across OpenClaw, Hermes, or another compatible runtime.
metadata: {"openclaw":{"requires":{"bins":["pnpm"]},"os":["linux","darwin"]}}
---

# Aperture Lab F-Stop

Use this skill when the goal is to operate **F-Stop**, the discovery and
proposal subsystem inside Aperture Lab.

The canonical command surface is:

- `pnpm lab:fstop:campaign --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> ...`
- `pnpm lab:fstop:run --provider <provider> --reviewer-provider <provider> --optimizer-provider <provider> ...`
- `pnpm lab:fstop:review --reviewer-provider <provider> ...`
- `pnpm lab:fstop:reviewer --provider <provider>`
- `pnpm lab:fstop:propose --reviewer-provider <provider> --optimizer-provider <provider> ...`
- `pnpm lab:fstop:optimize --provider <provider> ...`
- `pnpm lab:fstop:optimizer --provider <provider>`

Load first:

- `packages/lab/research/autoresearch-program.md`
- `packages/lab/research/autoresearch-config.json`

Main rule:

- keep AI out of the live Aperture hot path
- use F-Stop to discover, review, calibrate, and propose
- let Aperture Lab own the scoring and gates
- prefer `lab:fstop:campaign` for unattended VPS work
