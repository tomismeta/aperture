import { normalizeSemanticText } from "./semantic-text.js";

export function looksLikeBareNonzeroTerminalExitEvidence(rawText: string): boolean {
  const text = normalizeSemanticText(rawText).replace(/[.]+$/g, "").replace(/\s+/g, " ");
  return BARE_NONZERO_TERMINAL_EXIT_PATTERNS.some((pattern) => pattern.test(text));
}

const COMPLETE_NO_OUTPUT_PREFIX_SOURCE = String.raw`(?:(?:no output|without output|no stdout\s+no stderr|no stderr\s+no stdout|empty stdout\s+empty stderr|stdout empty\s+stderr empty)\s+)`;
const BARE_NONZERO_TERMINAL_EXIT_PREFIX_SOURCE = String.raw`${COMPLETE_NO_OUTPUT_PREFIX_SOURCE}(?:(?:command|process|tool|subprocess)\s+)?`;
const BARE_NONZERO_TERMINAL_EXIT_PATTERNS = [
  new RegExp(
    String.raw`^${BARE_NONZERO_TERMINAL_EXIT_PREFIX_SOURCE}(?:exit code|exit_code|exit-code|exited with code|exit status|exited with status|return code|return_code|returned code)\s*(?:is|was)?\s*-?[1-9]\d*$`,
  ),
  new RegExp(
    String.raw`^${BARE_NONZERO_TERMINAL_EXIT_PREFIX_SOURCE}(?:failed\s+with\s+)?(?:a\s+)?(?:non-zero|nonzero|non zero)\s+exit$`,
  ),
] as const;
