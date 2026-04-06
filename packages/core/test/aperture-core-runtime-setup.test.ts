import assert from "node:assert/strict";
import test from "node:test";

import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import {
  buildApertureCoordinator,
  normalizeApertureCoreRuntimeSetup,
} from "../src/aperture-core-runtime-setup.js";

test("normalizeApertureCoreRuntimeSetup supplies clean runtime defaults", () => {
  const state = normalizeApertureCoreRuntimeSetup();

  assert.equal(state.operatorPresence, "present");
  assert.equal(state.baseMemoryProfile.operatorId, "default");
  assert.equal(state.baseMemoryProfile.sessionCount, 0);
  assert.equal(typeof state.timeSource, "function");
  assert.notEqual(state.surfaceCapabilities.topology, undefined);
  assert.notEqual(state.surfaceCapabilities.responses, undefined);
});

test("normalizeApertureCoreRuntimeSetup clones provided surface capabilities", () => {
  const provided = {
    topology: { supportsAmbient: false, supportsQueue: true, supportsMultipleTasks: true },
    responses: { supportsAcknowledge: true, supportsTextInput: false, supportsMultiSelect: true },
  };

  const state = normalizeApertureCoreRuntimeSetup({
    surfaceCapabilities: provided,
  });

  assert.notEqual(state.surfaceCapabilities, provided);
  assert.notEqual(state.surfaceCapabilities.topology, provided.topology);
  assert.notEqual(state.surfaceCapabilities.responses, provided.responses);
  assert.deepEqual(state.surfaceCapabilities, provided);
});

test("buildApertureCoordinator builds a coordinator from normalized state", () => {
  const state = normalizeApertureCoreRuntimeSetup();
  const coordinator = buildApertureCoordinator(state);

  assert.ok(coordinator instanceof JudgmentCoordinator);
});
