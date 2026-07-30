import { PATH_LIKE_TOKEN_PATTERN, TAGGED_FILE_OBSERVATION_PHRASES } from "./semantic-patterns.js";
import { containsAnySemanticPhrase } from "./semantic-text.js";

export function looksLikeTaggedFileObservationTranscript(text: string): boolean {
  return (
    containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES) &&
    PATH_LIKE_TOKEN_PATTERN.test(text)
  );
}
