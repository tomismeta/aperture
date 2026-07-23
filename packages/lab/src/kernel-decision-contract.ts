export {
  buildKernelDecisionRecordProjection,
  buildKernelDecisionRecordProjectionFromSnapshot,
  canonicalizeKernelDecisionRecordProjection,
  fingerprintKernelDecisionRecordProjection,
  isKernelDecisionRecordFingerprint,
  KERNEL_DECISION_RECORD_PROJECTION_SCHEMA,
  KERNEL_DECISION_RECORD_PROJECTION_V1_SCHEMA,
  serializeKernelDecisionRecordProjection,
} from "./kernel-decision-contract-support.js";
export type {
  KernelDecisionRecordFingerprint,
  KernelDecisionRecordProjection,
  KernelDecisionRecordProjectionV1,
  KernelDecisionRecordProjectionV2,
} from "./kernel-decision-contract-support.js";
