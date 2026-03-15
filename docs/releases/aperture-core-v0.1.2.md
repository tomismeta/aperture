# @tomismeta/aperture-core v0.1.2

Improves the core judgment engine with explicit ambiguity handling, attention-surface-aware planning, and generic text-response support, while tightening the public SDK contract and fixing actionable-episode activation under ambiguity.

## Highlights

- added explicit interrupt ambiguity handling through `AttentionDecisionAmbiguity`
- added attention surface capability awareness to core planning
- added generic text-response support with `text_submitted` and `allowTextResponse`
- fixed actionable-episode activation being suppressed by ambiguity handling
- cleaned up the public SDK surface:
  - added `baseAttentionSurfaceCapabilities`
  - restored schema version exports
  - removed the temporary compatibility alias before publish

## Recommended tag

- `aperture-core-v0.1.2`
