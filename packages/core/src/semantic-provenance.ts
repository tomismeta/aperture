import type { AttentionProvenance } from "./frame.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import { dedupeSemanticStrings } from "./semantic-detection.js";

type SemanticProvenanceInput = {
  base?: AttentionProvenance | undefined;
  semantic?: Pick<SemanticInterpretation, "whyNow" | "factors"> | undefined;
  fallbackWhyNow?: string | undefined;
  extraFactors?: string[] | undefined;
};

export function mergeSemanticProvenance(
  input: SemanticProvenanceInput = {},
): AttentionProvenance | undefined {
  const base = input.base;
  const semantic = input.semantic;
  const whyNow = base?.whyNow ?? semantic?.whyNow ?? input.fallbackWhyNow;
  const factors = dedupeSemanticStrings([
    ...(base?.factors ?? []),
    ...(semantic?.factors ?? []),
    ...(input.extraFactors ?? []),
  ]);

  if (base === undefined && whyNow === undefined && factors.length === 0) {
    return undefined;
  }

  return {
    ...(base ?? {}),
    ...(whyNow !== undefined ? { whyNow } : {}),
    ...(factors.length > 0 ? { factors } : {}),
  };
}
