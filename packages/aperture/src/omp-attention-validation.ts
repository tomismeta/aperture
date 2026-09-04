export const OMP_ATTENTION_LIMITS = {
  jsonLineBytes: 64 * 1024,
  opaqueIdCodePoints: 160,
  focusHandleCharacters: 32,
  sessionFacets: 4,
  sessionFacetIdCodePoints: 32,
  sessionFacetLabelCodePoints: 32,
  sessionFacetValueCodePoints: 120,
  sessionLabelCodePoints: 116,
  titleCodePoints: 160,
  summaryCodePoints: 320,
} as const;

export class OmpAttentionEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmpAttentionEventError";
  }
}

export function safeDisplayText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OmpAttentionEventError(`OMP attention ${label} must contain visible text`);
  }
  if (Array.from(value).length > maximum) {
    throw new OmpAttentionEventError(`OMP attention ${label} exceeded the character limit`);
  }
  if (containsSecret(value) || looksLikePrivatePath(value)) {
    throw new OmpAttentionEventError(`OMP attention ${label} contained private material`);
  }
  return value;
}

function containsSecret(value: string): boolean {
  return (
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value) ||
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*\S+/i.test(
      value,
    )
  );
}

export function looksLikePrivatePath(value: string): boolean {
  return (
    /(?:^|\s)(?:~\/|\/(?:Users|home|private|tmp)\/|[A-Za-z]:\\(?:Users|Documents|Temp)\\)/.test(
      value,
    ) || /(?:^|\s)file:\/\//i.test(value)
  );
}
