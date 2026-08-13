import assert from "node:assert/strict";
import test from "node:test";

import { APERTURE_STATE_SCHEMA_VERSION } from "@tomismeta/aperture-core/internal";

import {
  isSupportedWorkSpecVersion,
  WORK_API_VERSION,
  workEventSchemaDocument,
} from "../src/work-contract.js";
import {
  WorkEndpointDescriptionSchema,
  WorkReceiptSchema,
  WorkResponseSchema,
} from "../src/work-public-contract.js";
import { normalizeWorkPayload } from "../src/work-event-ingest.js";
import { TypeCompiler } from "@sinclair/typebox/compiler";

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

test("public Work output contracts accept only the current literal version", () => {
  const contracts = [
    [
      WorkReceiptSchema,
      {
        ok: true,
        apiVersion: "1.0",
        accepted: 0,
        receivedAs: "text",
        message: "ok",
        published: [],
      },
    ],
    [
      WorkResponseSchema,
      {
        ok: true,
        apiVersion: "1.0",
        taskId: "task:test",
        interactionId: "interaction:test",
        state: "pending",
        message: "waiting",
        expiresAt: "2026-08-13T00:01:00.000Z",
      },
    ],
    [
      WorkEndpointDescriptionSchema,
      {
        apiVersion: "1.0",
        path: "/work",
        method: "POST",
        summary: "",
        auth: "",
        send: [],
        response: {
          path: "/work/response/{interactionId}",
          deletePath: "/work/response/{interactionId}",
          bestFor: "",
          states: [],
        },
        retention: { pendingTtlMs: 1, terminalRetentionMs: 1, capacity: 1 },
        next: [],
      },
    ],
  ] as const;

  for (const [schema, value] of contracts) {
    const compiler = TypeCompiler.Compile(schema);
    assert.equal(compiler.Check(value), true);
    assert.equal(compiler.Check({ ...value, apiVersion: "1.1" }), false);
  }
});
