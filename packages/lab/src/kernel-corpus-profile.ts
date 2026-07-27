import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import {
  KERNEL_CANONICALIZATION_VERSION,
  KERNEL_REASON_CODE_GRAMMAR_VERSION,
} from "./kernel-profile.js";
import {
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_SCENARIO_IDS,
} from "./kernel-corpus-profile-data.js";

export {
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_SCENARIO_IDS,
} from "./kernel-corpus-profile-data.js";

export const KERNEL_CORPUS_PROFILE_ID = "aperture.kernel.messy_event_corpus.v2" as const;
export const KERNEL_CORPUS_PROFILE_VERSION = 2 as const;

export const KERNEL_CORPUS_PROFILE = {
  id: KERNEL_CORPUS_PROFILE_ID,
  version: KERNEL_CORPUS_PROFILE_VERSION,
  decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  reasonCodeGrammarVersion: KERNEL_REASON_CODE_GRAMMAR_VERSION,
  canonicalizationVersion: KERNEL_CANONICALIZATION_VERSION,
  scenarioIds: KERNEL_CORPUS_SCENARIO_IDS,
  coverageDimensions: KERNEL_CORPUS_COVERAGE_DIMENSIONS,
} as const;
