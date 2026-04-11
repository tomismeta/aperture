import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import {
  mapWorkPayloadToSourceEvents,
  mapWorkTextToSourceEvent,
  normalizeWorkPayload,
  type WorkEvent,
} from "../src/work-event-ingest.js";

const safeTextArbitrary = fc.string({ minLength: 1, maxLength: 80 }).filter((value) => {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(trimmed)
  );
});

const idArbitrary = fc.stringMatching(/[a-z0-9:-]{3,24}/);

const workUpdatedArbitrary: fc.Arbitrary<WorkEvent> = fc
  .record({
    specVersion: fc.constantFrom("1.0", "1.1"),
    kind: fc.constant<"work.updated">("work.updated"),
    work: fc.record({
      id: idArbitrary.map((value) => `task:${value}`),
      status: fc.constantFrom("running", "waiting", "blocked", "failed", "completed"),
      title: fc.option(safeTextArbitrary, { nil: undefined }),
      summary: fc.option(safeTextArbitrary, { nil: undefined }),
      progress: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    }),
  })
  .map(
    (event) =>
      ({
        ...event,
        work: omitUndefined(event.work),
      }) as WorkEvent,
  );

const approvalRequestArbitrary = fc
  .record({
    kind: fc.constant<"approval">("approval"),
    title: fc.option(safeTextArbitrary, { nil: undefined }),
    summary: fc.option(safeTextArbitrary, { nil: undefined }),
  })
  .map((request) => omitUndefined(request));

const choiceRequestArbitrary = fc
  .record({
    kind: fc.constant<"choice">("choice"),
    title: fc.option(safeTextArbitrary, { nil: undefined }),
    summary: fc.option(safeTextArbitrary, { nil: undefined }),
    selectionMode: fc.constantFrom("single", "multiple"),
    options: fc
      .array(
        fc.record({
          id: idArbitrary.map((value) => `option:${value}`),
          label: safeTextArbitrary,
          summary: fc.option(safeTextArbitrary, { nil: undefined }),
        }),
        { minLength: 1, maxLength: 4 },
      )
      .filter((options) => new Set(options.map((option) => option.id)).size === options.length),
  })
  .map((request) => ({
    ...omitUndefined(request),
    options: request.options.map((option) => omitUndefined(option)),
  }));

const inputRequestedArbitrary: fc.Arbitrary<WorkEvent> = fc
  .record({
    specVersion: fc.constantFrom("1.0", "1.1"),
    kind: fc.constant<"input.requested">("input.requested"),
    work: fc.record({
      id: idArbitrary.map((value) => `task:${value}`),
      title: fc.option(safeTextArbitrary, { nil: undefined }),
      summary: fc.option(safeTextArbitrary, { nil: undefined }),
    }),
    interaction: fc.record({
      id: idArbitrary.map((value) => `interaction:${value}`),
    }),
    request: fc.oneof(approvalRequestArbitrary, choiceRequestArbitrary),
  })
  .map(
    (event) =>
      ({
        ...event,
        work: omitUndefined(event.work),
      }) as WorkEvent,
  );

const workEventArbitrary: fc.Arbitrary<WorkEvent> = fc.oneof(
  workUpdatedArbitrary,
  inputRequestedArbitrary,
);

test("valid structured WorkEvent samples normalize and map without losing task identity", async () => {
  await fc.assert(
    fc.asyncProperty(workEventArbitrary, async (event) => {
      const normalized = normalizeWorkPayload(event);
      assert.equal(typeof normalized, "object");
      assert.equal(Array.isArray(normalized), false);

      const sourceEvents = mapWorkPayloadToSourceEvents(normalized);
      assert.equal(sourceEvents.length, 1);
      assert.equal(sourceEvents[0]?.taskId, event.work.id);
    }),
    { numRuns: 50 },
  );
});

test("valid WorkEvent batches normalize and map across every entry", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(workEventArbitrary, { minLength: 1, maxLength: 4 }),
      async (events) => {
        const normalized = normalizeWorkPayload(events);
        assert.equal(Array.isArray(normalized), true);

        const sourceEvents = mapWorkPayloadToSourceEvents(normalized);
        assert.equal(sourceEvents.length, events.length);
        assert.deepEqual(
          sourceEvents.map((event) => event.taskId),
          events.map((event) => event.work.id),
        );
      },
    ),
    { numRuns: 40 },
  );
});

test("safe plain-text work samples always map to running task updates", async () => {
  await fc.assert(
    fc.asyncProperty(safeTextArbitrary, async (text) => {
      const event = mapWorkTextToSourceEvent(text);
      assert.equal(event.type, "task.updated");
      assert.equal(event.status, "running");
      assert.equal(event.summary, text.trim());
    }),
    { numRuns: 40 },
  );
});

test("structured work rejects duplicate ids inside request and context collections", () => {
  assert.throws(
    () =>
      normalizeWorkPayload({
        kind: "input.requested",
        work: {
          id: "task:duplicate-options",
        },
        interaction: {
          id: "interaction:duplicate-options",
        },
        request: {
          kind: "choice",
          selectionMode: "single",
          options: [
            { id: "option:a", label: "Alpha" },
            { id: "option:a", label: "Alpha again" },
          ],
        },
      }),
    /duplicate id/i,
  );

  assert.throws(
    () =>
      normalizeWorkPayload({
        kind: "work.updated",
        work: {
          id: "task:duplicate-context",
          status: "running",
        },
        context: {
          items: [
            { id: "ctx:1", value: "one" },
            { id: "ctx:1", value: "two" },
          ],
        },
      }),
    /duplicate id/i,
  );
});

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
