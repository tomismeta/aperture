import assert from "node:assert/strict";
import test from "node:test";

import {
  ApertureWorkClient,
  ApertureWorkClientError,
  WORK_API_VERSION,
  WORK_SCHEMA_ID,
  WORK_SCHEMA_URL,
  isSupportedWorkSpecVersion,
  workEventSchemaDocument,
} from "../src/work.js";

test("public Work surface exposes the current contract and schema", () => {
  assert.equal(WORK_API_VERSION, "1.0");
  assert.equal(WORK_SCHEMA_ID, "urn:aperture:work-event:1.0");
  assert.equal(
    WORK_SCHEMA_URL,
    "https://raw.githubusercontent.com/tomismeta/aperture/aperture-v0.5.0/schemas/work-event.schema.json",
  );
  assert.equal(isSupportedWorkSpecVersion("1.0"), true);
  assert.equal(isSupportedWorkSpecVersion("1.1"), false);
  assert.equal(workEventSchemaDocument().$id, WORK_SCHEMA_ID);
});

test("public Work client reports structured server version errors", async () => {
  const requests: Request[] = [];
  const client = await ApertureWorkClient.connect({
    baseUrl: "http://127.0.0.1:4546",
    authToken: "token",
    registryDir: "/path/that/does/not/exist",
    fetch: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return new Response(
        request.method === "GET"
          ? JSON.stringify({ apiVersion: "1.0" })
          : JSON.stringify({
              error: {
                code: "unsupported_work_spec_version",
                message: "Unsupported Work specVersion 1.1.",
                hint: "Send Work specVersion 1.0 or omit specVersion.",
                receivedVersion: "1.1",
                supportedVersion: "1.0",
                batchIndex: 1,
              },
            }),
        {
          status: request.method === "GET" ? 200 : 400,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  await assert.rejects(
    () =>
      client.publish([
        { kind: "work.updated", work: { id: "task:one", status: "running" } },
        { kind: "work.updated", specVersion: "1.0", work: { id: "task:two", status: "running" } },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof ApertureWorkClientError);
      assert.equal(error.code, "unsupported_work_spec_version");
      assert.equal(error.receivedVersion, "1.1");
      assert.equal(error.supportedVersion, "1.0");
      assert.equal(error.batchIndex, 1);
      return true;
    },
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "http://127.0.0.1:4546/work");
  assert.equal(requests[1]?.headers.get("authorization"), "Bearer token");
});

test("public Work client reports missing local runtime clearly", async () => {
  const error = await ApertureWorkClient.connect({
    registryDir: "/path/that/does/not/exist",
  }).catch((value: unknown) => value);
  assert.ok(error instanceof ApertureWorkClientError);
  assert.equal(error.code, "runtime_not_found");
});
