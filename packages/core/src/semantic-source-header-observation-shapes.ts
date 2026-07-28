export function looksLikeFlattenedIncludeSourceCluster(text: string): boolean {
  const trimmed = text.trim();
  if (!/^#include\s*(?:<[^>\r\n]+>|"[^"\r\n]+")/i.test(trimmed)) {
    return false;
  }

  const includes = [...trimmed.matchAll(/(?:^|\s)#include\s*(<[^>\r\n]+>|"[^"\r\n]+")/gi)].map(
    (match) => match[1]?.toLowerCase(),
  );
  const uniqueIncludes = new Set(includes.filter((include) => include !== undefined));

  return (
    uniqueIncludes.size >= 5 ||
    (uniqueIncludes.size >= 3 &&
      /\b(?:namespace|std::|class|struct|template|using|void|int|auto|const|public:|private:|[a-z_][a-z0-9_:]*::[a-z_][a-z0-9_]*)\b/i.test(
        trimmed,
      ))
  );
}

export function looksLikeLineNumberedSourceLicenseHeader(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const numberedCommentLines = lines.filter((line) =>
    /^\d{1,6}\s+(?:(?:(?:\/\/|\/\*|\*)\s*)|\/\/{5,})/i.test(line),
  );

  return (
    numberedCommentLines.length >= 2 &&
    lines.some((line) =>
      /^\d{1,6}\s+(?:(?:\/\/\s*)?SPDX-License-Identifier:|(?:(?:\/\/|\/\*|\*)\s*)?(?:copyright|permission is hereby granted|open source license))/i.test(
        line,
      ),
    )
  );
}
