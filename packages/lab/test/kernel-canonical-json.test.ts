import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeKernelDecisionRecordProjection,
  digestKernelCanonicalJson,
  fingerprintKernelDecisionRecordProjection,
  serializeKernelCanonicalJson,
  type KernelDecisionRecordProjectionV1,
} from "../src/index.js";

test("kernel canonical JSON ignores object insertion order", () => {
  assert.equal(
    serializeKernelCanonicalJson({ b: 2, a: { d: 4, c: 3 } }),
    serializeKernelCanonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("kernel canonical JSON sorts keys by code unit order", () => {
  assert.equal(
    serializeKernelCanonicalJson({ b: 1, A: 2, a: 3, "\u00e1": 4 }),
    '{"A":2,"a":3,"b":1,"\u00e1":4}',
  );
});

test("kernel canonical JSON rejects non-finite numbers and sparse arrays", () => {
  assert.throws(() => serializeKernelCanonicalJson({ value: Number.NaN }), /finite numbers/);
  assert.throws(() => serializeKernelCanonicalJson({ value: Number.POSITIVE_INFINITY }), /finite/);
  assert.throws(() => serializeKernelCanonicalJson({ value: Number.NEGATIVE_INFINITY }), /finite/);

  const sparse: unknown[] = [];
  sparse[1] = "hole";
  assert.throws(() => serializeKernelCanonicalJson(sparse), /sparse arrays/);
});

test("kernel canonical JSON has a stable digest vector", () => {
  assert.equal(
    digestKernelCanonicalJson({ b: [true, null, "x"], a: 1 }),
    "sha256:eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1",
  );
});

test("kernel projection fingerprint excludes prose reasons", () => {
  const projection: KernelDecisionRecordProjectionV1 = {
    schema: "aperture.kernel.decision_record_projection.v1",
    version: 1,
    route: "queue",
    lane: "next",
    evidence: {
      operatorPresence: "present",
      currentFrameId: null,
      currentEpisodeId: null,
    },
    value: {
      candidateScore: 10,
      components: { b: 2, a: 1 },
    },
    reasons: ["old wording"],
    reasonCodes: [
      "pressure:overload:low",
      "route:queue",
      "policy:minimum_lane:next",
      "lane:next",
      "pressure:level:steady",
      "evidence:operator_presence:present",
      "evidence:current_frame:absent",
      "evidence:current_episode:absent",
    ],
  };
  const reworded = canonicalizeKernelDecisionRecordProjection({
    ...projection,
    reasons: ["new wording"],
    reasonCodes: [...projection.reasonCodes].reverse(),
  });

  assert.equal(
    fingerprintKernelDecisionRecordProjection(projection),
    fingerprintKernelDecisionRecordProjection(reworded),
  );
});
