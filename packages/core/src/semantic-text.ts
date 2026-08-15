// Shared lexical helpers for bounded semantic reads. Keep these mechanical:
// higher-level evidence and judgment modules own the meaning of each match.
export function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, " ")
    .trim();
}
export function normalizeSemanticLexicalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function containsAnySemanticPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsSemanticPhrase(value, phrase));
}
export function containsSemanticPhrase(value: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  if (!normalizedPhrase.includes(" ")) {
    return hasSemanticWord(value, normalizedPhrase);
  }

  return hasSemanticPhrase(value, normalizedPhrase);
}

export function hasSemanticPhrase(value: string, phrase: string): boolean {
  const normalizedValue = normalizeSemanticText(value);
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  return new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(normalizedPhrase)}(?:$|[^a-z0-9_])`).test(
    normalizedValue,
  );
}

export function hasSemanticWord(value: string, word: string): boolean {
  const normalizedValue = normalizeSemanticText(value);
  const normalizedWord = normalizeSemanticText(word);
  if (!normalizedWord || normalizedWord.includes(" ")) {
    return false;
  }

  return new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(normalizedWord)}(?:$|[^a-z0-9_])`).test(
    normalizedValue,
  );
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
