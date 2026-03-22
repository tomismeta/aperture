import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readAskUserQuestionTranscriptPayload } from "../src/transcript.js";

test("reads matching AskUserQuestion transcript payloads within allowed roots", async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "aperture-transcript-"));
  const transcriptPath = join(scratchDir, "session.jsonl");

  await writeFile(
    transcriptPath,
    [
      JSON.stringify({ malformed: true }),
      JSON.stringify({
        message: {
          content: [{
            type: "tool_use",
            id: "tool-ask-1",
            name: "AskUserQuestion",
            input: {
              questions: [{
                question: "Choose a scripting language",
                header: "Scripting",
                options: [
                  { label: "Python" },
                  { label: "Node.js" },
                ],
              }],
            },
          }],
        },
      }),
      "{not-json}",
      JSON.stringify({
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool-ask-1",
          }],
        },
        toolUseResult: {
          answers: {
            "Choose a scripting language": "Node.js",
          },
        },
      }),
    ].join("\n"),
    "utf8",
  );

  try {
    const payload = await readAskUserQuestionTranscriptPayload(
      transcriptPath,
      "tool-ask-1",
      { allowedRoots: [scratchDir] },
    );

    assert.deepEqual(payload, {
      questions: [{
        question: "Choose a scripting language",
        header: "Scripting",
        options: [
          { label: "Python" },
          { label: "Node.js" },
        ],
      }],
      answers: {
        "Choose a scripting language": "Node.js",
      },
    });
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test("rejects transcript paths outside the allowed roots", async () => {
  const allowedDir = await mkdtemp(join(tmpdir(), "aperture-transcript-allowed-"));
  const blockedDir = await mkdtemp(join(tmpdir(), "aperture-transcript-blocked-"));
  const transcriptPath = join(blockedDir, "session.jsonl");

  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      message: {
        content: [{
          type: "tool_use",
          id: "tool-ask-1",
          name: "AskUserQuestion",
          input: {
            questions: [{ question: "Blocked question", options: [] }],
          },
        }],
      },
    })}\n`,
    "utf8",
  );

  try {
    const payload = await readAskUserQuestionTranscriptPayload(
      transcriptPath,
      "tool-ask-1",
      { allowedRoots: [allowedDir] },
    );

    assert.equal(payload, null);
  } finally {
    await rm(allowedDir, { recursive: true, force: true });
    await rm(blockedDir, { recursive: true, force: true });
  }
});

test("rejects oversized transcript files", async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "aperture-transcript-large-"));
  const transcriptPath = join(scratchDir, "session.jsonl");

  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      message: {
        content: [{
          type: "tool_use",
          id: "tool-ask-1",
          name: "AskUserQuestion",
          input: {
            questions: [{ question: "Large question", options: [] }],
          },
        }],
      },
    })}\n`,
    "utf8",
  );

  try {
    const payload = await readAskUserQuestionTranscriptPayload(
      transcriptPath,
      "tool-ask-1",
      { allowedRoots: [scratchDir], maxBytes: 10 },
    );

    assert.equal(payload, null);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});
