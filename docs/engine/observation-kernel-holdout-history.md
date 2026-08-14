# Observation Kernel Holdout History

The active release holdout at
`packages/lab/conformance/observation-kernel-release-holdout.json` is a
maintainer-authored regression and hardening artifact. It is digest-bound by
the custody files beside it and makes no independent-oracle claim.

The numbered holdout artifacts are historical evidence, not active release
gates. `observation-kernel-holdout-v6.json`, its schema, custody record, first
run, and report remain unchanged as the record of the post-freeze experiment
at commit `a3d36b5571494e43ffee98ceb38fddea43155553`. Its fallback slice was
deterministic but did not pass, so V6 is retired and is not release proof. The
V6 runner is retained only for historical reproduction and is excluded from
`release:check`.

The active release proof is the unnumbered
`observation-kernel-release-holdout` protocol. It has explicit seal,
first-run, and read-only check modes, exclusive evidence writes, and custody
checks for the artifact digest and frozen core tree. Its oracle provenance is
intentionally honest: it is a maintainer-authored regression and hardening
set, not an independent oracle. An independent adversarial re-audit remains a
release requirement.

## Input-only correction wave

Commit `1e16c6c` (`test(lab): reseal active semantic holdout`) corrected four
fixture inputs and one rationale after the active holdout was assembled. The
fixture count remained 32, and the expected semantic, judgment, decision, and
exact-outcome values were unchanged.

The corrected fixtures were:

- `holdout-release-ordinary-word-boundary`: expanded the summary with line
  breaks and an ordinary `if`-word example so the existing word-boundary case
  exercised the intended presentation shape.
- `holdout-release-complete-runtime-boundary`: clarified the summary as a
  crashed process with a complete stderr diagnostic while retaining the same
  typed runtime evidence and expected visible diagnostic judgment.
- `holdout-release-title-summary-abstention`: replaced the quoted summary
  fragment with the intended quoted, non-asserted outcome-only wording while
  retaining the same abstention expectation.
- `holdout-release-flattened-ordinary-words`: added the ordinary `if`-word
  example to the flattened presentation variant so the pair tests whitespace
  stability rather than a fixture-specific sentence.

The rationale for `holdout-release-title-summary-abstention` was also expanded
to state that the generic title cannot override quoted or outcome-only fallback
text. This was a documentation correction, not an expected-output change.

## Subject-continuation corrective wave

The active holdout now includes `holdout-release-continued-diagnostic`, which
keeps an expected execution clause and a later asserted diagnostic without
repeating the execution subject. The structural grammar accepts this only when
the same evidence also establishes an execution context; a bare pronoun
diagnostic, blocked execution, and incomplete diagnostic remain indeterminate.
The active release fixture count is 46, with 12 typed-evidence and 34 structural-fallback
fixtures. This is a regression guard for the semantic grammar, not an
independent oracle or a claim of broad language coverage.

The active custody artifact records the resulting digest and implementation
freeze. Future holdout changes must update custody through the release-holdout
workflow and must state whether they alter inputs, rationales, or expected
outcomes. A holdout reseal is regression governance; it is not evidence of
independent labeling or statistical accuracy over arbitrary agent output.
