export function stringifyAsciiJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("JSONL value is not serializable");
  return json.replace(
    /[\u0080-\uFFFF]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function serializeAsciiJsonLine(value: unknown): string {
  return `${stringifyAsciiJson(value)}\n`;
}
