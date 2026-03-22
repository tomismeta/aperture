import assert from "node:assert/strict";
import test from "node:test";

import { mergeSemanticProvenance } from "../src/semantic-provenance.js";

test("semantic provenance keeps base whyNow authoritative and dedupes factors", () => {
  const merged = mergeSemanticProvenance({
    base: {
      whyNow: "Adapter says the operator is blocking the release.",
      factors: ["adapter release gate", "shared factor"],
    },
    semantic: {
      whyNow: "Semantic layer inferred an approval checkpoint.",
      factors: ["semantic approval", "shared factor"],
    },
    fallbackWhyNow: "Fallback why-now",
    extraFactors: ["extra factor", "semantic approval"],
  });

  assert.deepEqual(merged, {
    whyNow: "Adapter says the operator is blocking the release.",
    factors: [
      "adapter release gate",
      "shared factor",
      "semantic approval",
      "extra factor",
    ],
  });
});

test("semantic provenance falls back to semantic and fallback whyNow when base is absent", () => {
  const semanticMerged = mergeSemanticProvenance({
    semantic: {
      whyNow: "Semantic layer inferred a waiting state.",
      factors: ["semantic waiting"],
    },
    fallbackWhyNow: "Fallback why-now",
  });
  const fallbackMerged = mergeSemanticProvenance({
    fallbackWhyNow: "Fallback why-now",
    extraFactors: ["derived factor"],
  });

  assert.deepEqual(semanticMerged, {
    whyNow: "Semantic layer inferred a waiting state.",
    factors: ["semantic waiting"],
  });
  assert.deepEqual(fallbackMerged, {
    whyNow: "Fallback why-now",
    factors: ["derived factor"],
  });
});
