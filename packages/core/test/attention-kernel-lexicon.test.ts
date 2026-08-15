import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("attention kernel lexicon keeps public terms explicit", async () => {
  const lexicon = await readFile(
    new URL("../../../docs/engine/attention-kernel-lexicon.md", import.meta.url),
    "utf8",
  );

  for (const term of [
    "Core SDK",
    "ApertureCore",
    "attention evaluator",
    "attention kernel",
    "SourceEvent",
    "ApertureEvent",
    "attention ontology",
    "attention claim",
    "evidence/context",
    "judgment",
    "decision record",
    "evaluatedAt",
    "route",
    "planned lane",
    "realized lane",
    "AttentionFrame",
    "AttentionView",
  ]) {
    assert.match(lexicon, new RegExp(`\\|\\s+${escapeRegExp(term)}\\s+\\|`));
  }

  assert.match(lexicon, /`AttentionOntology\*` is the only ontology vocabulary exported by core/);
  assert.match(lexicon, /public judgment summaries should say `realizedLane`/);
  assert.match(lexicon, /`evaluateAttention\(\.\.\.\)`/);
  assert.match(lexicon, /`AttentionOntologyDiagnostic\.source` is the canonical ontology/);
  const preferredApi = lexicon.slice(
    lexicon.indexOf("Preferred public API language:"),
    lexicon.indexOf("Avoid public API language"),
  );
  const avoidedApi = lexicon.slice(lexicon.indexOf("Avoid public API language"));
  assert.doesNotMatch(preferredApi, /createAttentionKernel|kernel\.apply|kernel\.snapshot/);
  assert.match(avoidedApi, /createAttentionKernel/);
  assert.doesNotMatch(lexicon, /event kernel|judgment kernel/i);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
