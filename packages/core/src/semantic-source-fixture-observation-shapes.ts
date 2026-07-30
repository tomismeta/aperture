export function looksLikeSourceFixtureObservation(value: string): boolean {
  return (
    /^\s*(?:source\s+)?fixture\s*:\s*```[\s\S]+```\s*$/i.test(value) ||
    /^\s*(?:const|let|var)\s+[a-z_$][\w$]*\s*=\s*`[\s\S]+`\s*;?\s*$/i.test(value) ||
    /^\s*[a-z_][\w]*\s*=\s*(?:'''|""")[\s\S]+(?:'''|""")\s*$/i.test(value)
  );
}
