import assert from "node:assert/strict";
import test from "node:test";

import { APERTURE_STATE_SCHEMA_VERSION } from "@tomismeta/aperture-core/internal";

import {
  isSupportedWorkSpecVersion,
  WORK_API_VERSION,
  workEventSchemaDocument,
} from "../src/work-contract.js";
import { normalizeWorkPayload } from "../src/work-event-ingest.js";

test("live contract policy has one current version per boundary", () => {
  assert.equal(APERTURE_STATE_SCHEMA_VERSION, 1);
  assert.equal(WORK_API_VERSION, "1.0");
  assert.equal(isSupportedWorkSpecVersion(WORK_API_VERSION), true);
  assert.equal(isSupportedWorkSpecVersion("1.1"), false);
  assert.equal(isSupportedWorkSpecVersion("2.0"), false);

  const schema = workEventSchemaDocument();
  const variants = schema.anyOf as Array<{ properties?: Record<string, unknown> }>;
  assert.ok(variants.length > 0);
  for (const variant of variants) {
    assert.deepEqual(variant.properties?.specVersion, {
      const: WORK_API_VERSION,
      default: WORK_API_VERSION,
      type: "string",
      description:
        "Optional on ingress. Aperture defaults this to the current Work contract version when omitted. Only the current version is accepted.",
    });
  }
});

test("live Work normalization owns the current version and rejects future versions", () => {
  const base = {
    kind: "work.updated",
    work: { id: "task:version-policy", status: "running" },
  } as const;

  const normalized = normalizeWorkPayload(base);
  assert.equal(Array.isArray(normalized), false);
  assert.equal((normalized as { specVersion: string }).specVersion, WORK_API_VERSION);

  assert.throws(() => normalizeWorkPayload({ ...base, specVersion: "1.1" }));
  assert.throws(() => normalizeWorkPayload({ ...base, specVersion: "2.0" }));
});
