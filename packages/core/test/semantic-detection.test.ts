import assert from "node:assert/strict";
import test from "node:test";

import {
  detectSemanticBlockingSignal,
  inferConsequenceFromSemanticText,
  normalizeSemanticText,
} from "../src/semantic-detection.js";

test("risk phrase matching does not overread product-like words as prod risk", () => {
  const text = normalizeSemanticText(
    "Review the productivity dashboard and product roadmap before the staging deploy.",
  );

  assert.equal(inferConsequenceFromSemanticText(text, "low"), "low");
});

test("blocking phrase detection survives normalization of apostrophes", () => {
  const text = normalizeSemanticText(
    "Work can't continue until credentials are provided.",
  );

  assert.equal(detectSemanticBlockingSignal(text), "blocking");
});

test("blocking phrase detection stays bounded to whole phrases", () => {
  const text = normalizeSemanticText(
    "The service can continue automatically after the queue drains.",
  );

  assert.equal(detectSemanticBlockingSignal(text), null);
});
