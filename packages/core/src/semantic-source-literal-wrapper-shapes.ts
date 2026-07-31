export function looksLikeSingleSourceLiteralWrapper(text: string): boolean {
  return (
    /^\s*(?:(?:const|let|var)\s+)?[a-z_$][\w$]*\s*=\s*["'`][\s\S]*["'`]\s*;?\s*$/i.test(text) ||
    /^\s*(?:print|console\.(?:log|warn|error)|logger\.[a-z_$][\w$]*|process\.stdout\.write)\s*\(\s*["'`][\s\S]*["'`]\s*\)\s*;?\s*$/i.test(
      text,
    )
  );
}
