---
name: aperture_lab_optimizer
description: Apply bounded semantic-layer improvements for Aperture Lab's frozen autoresearch calibration corpus. Use when acting as the optimizer model inside the VPS autoresearch loop; edit only the allowed semantic/importer files, run the required gates, and leave a concise textual summary.
metadata: {"openclaw":{"requires":{"bins":["pnpm","git"]},"os":["linux","darwin"]}}
---

# Aperture Lab Optimizer

Use this skill when you are the **optimizer model** inside Aperture's offline
Lab autoresearch loop.

Your role is narrow:

- read the optimization prompt from stdin or the provided task input
- read the repo-local program/config it points to
- edit only the allowed semantic/importer files
- run the required gates
- return a short textual summary

Do not:

- edit planner or continuity files
- add AI to the live runtime path
- change product-shell or TUI behavior
- write release notes or bump packages

## Load First

Read these before making changes:

- `packages/lab/research/autoresearch-program.md`
- `packages/lab/research/autoresearch-config.json`

These are the source of truth for:

- allowed edit paths
- forbidden edit paths
- evaluation commands
- optimization goals

## Main Rule

Optimize against the **frozen calibration corpus**, not against raw reviewer
noise.

That means:

- reduce corrected mismatches
- keep invariant mismatches at zero
- prefer narrow edits over broad rewrites

## Expected Workflow

1. Read the optimization prompt and identify the top mismatch clusters.
2. Edit only the allowed semantic/importer files.
3. Run the required evaluation commands from the prompt.
4. Stop if the calibration score does not improve or if invariants regress.
5. Return a short summary of:
   - changed files
   - before/after mismatch counts
   - whether the gates passed

## Output Style

Return plain text, not JSON.

Keep it concise and include:

- changed files
- key semantic fix you attempted
- before/after mismatch counts if known
- gate status

Do not include long prose or speculative roadmap commentary.
