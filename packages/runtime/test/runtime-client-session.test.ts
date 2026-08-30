import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { RuntimeAttachmentSession } from "../src/runtime-client-session.js";

test("runtime attachment polling is single-flight and close waits before detach", async () => {
  const pollGate = new EventEmitter();
  let polls = 0;
  let detached = false;

  const session = new RuntimeAttachmentSession({
    pollIntervalMs: 1,
    attach: async () => ({ attachedId: "surface-1", heartbeatIntervalMs: 60_000 }),
    detach: async () => {
      detached = true;
    },
    heartbeat: async () => {},
    poll: async () => {
      polls += 1;
      await once(pollGate, "release");
      return { events: [], nextSequence: polls, stateVersion: polls };
    },
    onPoll: async () => {},
  });

  await session.start();
  await waitFor(() => polls === 1);
  await delay(10);
  assert.equal(polls, 1, "a second poll started while the first was active");

  const closing = session.close();
  await delay(1);
  assert.equal(detached, false, "detach ran before the active poll settled");
  pollGate.emit("release");
  await closing;
  assert.equal(detached, true);
  assert.equal(polls, 1, "close allowed another poll to start");
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for runtime session state");
    await delay(1);
  }
}
