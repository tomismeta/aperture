---
name: aperture_lab_optimizer
description: Apply bounded semantic-layer improvements for Aperture Lab F-Stop's frozen calibration corpus. Use when acting as the optimizer model inside the VPS F-Stop loop; edit only the allowed semantic/importer files, run the required gates, and return a structured JSON outcome.
metadata: {"openclaw":{"requires":{"bins":["pnpm","git"]},"os":["linux","darwin"]}}
---

# Aperture Lab F-Stop Optimizer

Use this skill when you are the **optimizer model** inside Aperture Lab
F-Stop.

Your role is narrow:

- read the optimization prompt from stdin or the provided task input
- read the repo-local program/config it points to
- edit only the allowed semantic/importer files
- run the required gates
- return a structured JSON outcome

Do not:

- edit planner or continuity files
- add AI to the live runtime path
- change product-shell or TUI behavior
- create commits or switch branches
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
- prefer structural rules over one-off titles or phrase literals
- treat the harness evaluation outputs as the source of truth

## Expected Workflow

1. Read the optimization prompt and identify the top mismatch clusters.
2. Edit only the allowed semantic/importer files.
3. Run the required evaluation commands from the prompt.
4. Prefer structural generalizations over single-title or exact-phrase special cases unless multiple promoted examples clearly justify the phrase.
5. Use the mismatch counts from the commands you actually ran; do not invent or round them.
6. If the calibration improves but another gate fails, say that explicitly instead of calling the patch a semantic regression.
7. Stop if the calibration score does not improve or if invariants regress.
5. Return exactly one JSON object with:
   - `action`: `patched` or `no_patch`
   - `summary`
   - `reasons`
   - `recommendedFiles`
   - `changedFiles`
   - `commandsRun`
   - `beforeMismatchCount`
   - `afterMismatchCount`
   - `judgmentBattle`
   - `releaseCheck`

## Output Style

Return JSON only.

If no patch survives, still return a JSON object with:

- `action: "no_patch"`
- a concrete blocker in `reasons`
- likely target files in `recommendedFiles`
- the commands you actually ran in `commandsRun`

Do not include prose before or after the JSON object.
