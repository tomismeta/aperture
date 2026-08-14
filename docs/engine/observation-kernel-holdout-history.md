# Observation Kernel Holdout History

The numbered holdout artifacts are historical evidence, not active release gates.

`observation-kernel-holdout-v6.json`, its schema, custody record, first run, and report remain unchanged as the record of the post-freeze experiment at commit `a3d36b5571494e43ffee98ceb38fddea43155553`. Its fallback slice was deterministic but did not pass, so V6 is retired and is not release proof. The V6 runner is retained only for historical reproduction and is excluded from `release:check`.

The active release proof is the unnumbered `observation-kernel-release-holdout` protocol. It has explicit seal, first-run, and read-only check modes, exclusive evidence writes, and custody checks for the artifact digest and frozen core tree. Its oracle provenance is intentionally honest: it is a maintainer-authored regression and hardening set, not an independent oracle. An independent adversarial re-audit remains a release requirement.
