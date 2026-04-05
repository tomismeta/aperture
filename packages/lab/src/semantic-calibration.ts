export const SEMANTIC_CALIBRATION_FAMILIES = [
  "ask_missed",
  "ask_overread",
  "consequence_overread",
  "consequence_underread",
  "blocking_missed",
  "episode_missed",
  "confidence_too_high",
  "confidence_too_low",
] as const;

export type ReplaySemanticCalibrationFamily =
  (typeof SEMANTIC_CALIBRATION_FAMILIES)[number];

export function isReplaySemanticCalibrationFamily(
  value: unknown,
): value is ReplaySemanticCalibrationFamily {
  return typeof value === "string"
    && (SEMANTIC_CALIBRATION_FAMILIES as readonly string[]).includes(value);
}
