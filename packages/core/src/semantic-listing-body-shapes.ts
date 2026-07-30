export function looksLikeNoSpaceListingBody(body: string): boolean {
  const value = body.trim();
  if (NO_SPACE_BODY_REJECTION_PATTERN.test(value)) {
    return false;
  }
  return (
    NO_SPACE_SOURCE_BODY_PATTERNS.some((pattern) => pattern.test(value)) ||
    looksLikeTechnicalNoSpaceListingBody(value)
  );
}

function looksLikeTechnicalNoSpaceListingBody(value: string): boolean {
  return TECHNICAL_NO_SPACE_BODY_PATTERN.test(value);
}

const NO_SPACE_BODY_REJECTION_PATTERN =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:$|[/:]\S*)|[{\["]|\d{1,2}:\d{2}(?::\d{2})?\b|\d+(?:\.\d+){1,}\b)/i;

const TECHNICAL_NO_SPACE_BODY_PATTERN =
  /(?:\b[A-Z][A-Z0-9_]{2,}\b|\b[A-Za-z]*[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b|\b\d+-bit\b|0x[0-9a-fA-F]+\b|`[^`]+`|[a-zA-Z_$][\w.-]*=)/;

const NO_SPACE_SOURCE_BODY_PATTERNS = [
  /^\/[/*]/,
  /^#(?:include|define|if|ifdef|ifndef|endif|pragma)\b/,
  /^\.[a-z_][\w.]*(?:\s|$)/i,
  /^(?:if|for|while|switch|catch)\s*\(/,
  /^(?:return(?:\s+(?:[a-z_$][\w$.]*(?:\([^)]*\))?|-?\d+(?:\.\d+)?|true|false|null|nullptr))?|break|continue)\s*;?$/i,
  /^(?=.*(?:\b[a-z_$][\w$:<>]*_t\b|::|[<&*]|\b(?:static|inline|extern|const|virtual|void|int|char|bool|auto|struct|enum)\b))(?:[a-z_$][\w$:<>*&,]*\s+)+[*&\s]*[~a-z_$][\w$:<>]*\s*\([^)]*\)\s*(?:\{|;|const\b|override\b)/i,
  /^[a-z_$][\w$:<>]*(?:->|::)[a-z_$][\w$:]*/i,
  /^(?:this|[a-z_$][\w$]*)\.[a-z_$][\w$]*(?:\s*\(|\s*(?:=|\+=|-=|\*=|\/=))/i,
  /^[a-z_$][\w$]*(?:\[[^\]]+])?\s*(?:=|\+=|-=|\*=|\/=)\s*\S.*;$/i,
] as const;
