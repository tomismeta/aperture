import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXTUAL_RESOLVE_PHRASES,
  HIGH_RISK_PHRASES,
  REPEAT_PHRASES,
} from "../src/semantic-patterns.js";
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

test("risk phrase matching still reads exact prod tokens as high consequence", () => {
  const text = normalizeSemanticText(
    "Approve the prod deploy before continuing.",
  );

  assert.equal(inferConsequenceFromSemanticText(text, "low"), "high");
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

test("blocking phrase detection does not overread constant-like log tokens", () => {
  const text = normalizeSemanticText(
    "Kernel log emitted CANNOT_CONTINUE_READING while draining the queue.",
  );

  assert.equal(detectSemanticBlockingSignal(text), null);
});

test("semantic pattern families keep repeat and contextual resolve phrases distinct", () => {
  const overlap = REPEAT_PHRASES.filter((phrase) =>
    CONTEXTUAL_RESOLVE_PHRASES.includes(phrase),
  );

  assert.deepEqual(overlap, []);
  assert.ok(HIGH_RISK_PHRASES.includes("prod"));
});
