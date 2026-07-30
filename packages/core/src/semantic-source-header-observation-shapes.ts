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

export function looksLikeSourceLicenseCommentHeader(text: string): boolean {
  const trimmed = text.trim();
  const blockComment = /^\s*\/\*([\s\S]{0,900}?)\*\//.exec(trimmed);

  return (
    /^\s*\/\/\s*SPDX-License-Identifier:\s*\S/i.test(trimmed) ||
    (blockComment !== null && LICENSE_HEADER_PATTERN.test(blockComment[1] ?? "")) ||
    looksLikeMultilineCommentLicenseHeader(trimmed) ||
    looksLikeFlattenedCommentLicenseHeader(trimmed)
  );
}

function looksLikeMultilineCommentLicenseHeader(text: string): boolean {
  const head = text.split(/\r?\n/).slice(0, 12);
  const commentLines = head.filter((line) => /^\s*(?:\/\/+|#)\s*(?:\S|$)/.test(line)).length;

  return commentLines >= 3 && LICENSE_HEADER_PATTERN.test(head.join("\n"));
}

function looksLikeFlattenedCommentLicenseHeader(text: string): boolean {
  if (!/^\s*(?:\/\/|#)\s+/.test(text)) {
    return false;
  }

  return (
    [...text.slice(0, 900).matchAll(/(?:^|\s)(?:\/\/|#)\s+/g)].length >= 3 &&
    LICENSE_HEADER_PATTERN.test(text.slice(0, 900))
  );
}

const LICENSE_HEADER_PATTERN =
  /\b(?:SPDX-License-Identifier|copyright|permission is hereby granted|open source license)\b/i;
