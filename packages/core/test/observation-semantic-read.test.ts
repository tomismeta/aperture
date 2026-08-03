import assert from "node:assert/strict";
import test from "node:test";

import {
  observationReadsAsStatusUpdate,
  readObservationExpectedSemanticRead,
} from "../src/observation-semantic-read.js";
import type { ObservationSemantics } from "../src/observation-semantics.js";

function observation(
  polarity: ObservationSemantics["polarity"],
): Pick<ObservationSemantics, "polarity"> {
  return { polarity };
}

test("observation routing maps neutral and success observations to status progress", () => {
  for (const polarity of ["neutral", "success"] as const) {
    assert.equal(observationReadsAsStatusUpdate(observation(polarity)), true);
    assert.deepEqual(readObservationExpectedSemanticRead(observation(polarity)), {
      activity: "task_progress",
      intentFrame: "status_update",
      activityClass: "status_update",
    });
  }
});

test("observation routing maps failure and unknown observations to failure semantics", () => {
  for (const polarity of ["failure", "unknown"] as const) {
    assert.equal(observationReadsAsStatusUpdate(observation(polarity)), false);
    assert.deepEqual(readObservationExpectedSemanticRead(observation(polarity)), {
      activity: "failure",
      intentFrame: "failure",
      activityClass: "tool_failure",
    });
  }

  assert.equal(observationReadsAsStatusUpdate(null), false);
});
