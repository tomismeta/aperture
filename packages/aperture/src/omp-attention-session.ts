import {
  OMP_ATTENTION_LIMITS,
  OmpAttentionEventError,
  safeDisplayText,
} from "./omp-attention-validation.js";

export type OmpAttentionSessionFacet = {
  id: string;
  label: string;
  value: string;
};

export type OmpAttentionSession = {
  label?: string;
  facets?: OmpAttentionSessionFacet[];
};

export function assertOmpAttentionSession(value: unknown): OmpAttentionSession {
  const record = asRecord(value);
  const allowed = new Set(["label", "facets"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OmpAttentionEventError(`OMP attention session contains unknown field: ${key}`);
    }
  }

  const label =
    record.label === undefined
      ? undefined
      : safeDisplayText(record.label, OMP_ATTENTION_LIMITS.sessionLabelCodePoints, "session label");
  let facets: OmpAttentionSessionFacet[] | undefined;
  if (record.facets !== undefined) {
    if (
      !Array.isArray(record.facets) ||
      record.facets.length > OMP_ATTENTION_LIMITS.sessionFacets
    ) {
      throw new OmpAttentionEventError("OMP attention session facets are invalid");
    }
    const ids = new Set<string>();
    facets = record.facets.map((rawFacet) => {
      const facet = asRecord(rawFacet);
      const keys = Object.keys(facet).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["id", "label", "value"])) {
        throw new OmpAttentionEventError("OMP attention session facet is invalid");
      }
      const id = sessionFacetId(facet.id);
      if (ids.has(id)) {
        throw new OmpAttentionEventError("OMP attention session facet id is duplicated");
      }
      ids.add(id);
      return {
        id,
        label: safeDisplayText(
          facet.label,
          OMP_ATTENTION_LIMITS.sessionFacetLabelCodePoints,
          "session facet label",
        ),
        value: safeDisplayText(
          facet.value,
          OMP_ATTENTION_LIMITS.sessionFacetValueCodePoints,
          "session facet value",
        ),
      };
    });
  }
  if (label === undefined && (!facets || facets.length === 0)) {
    throw new OmpAttentionEventError("OMP attention session presentation is empty");
  }
  return {
    ...(label === undefined ? {} : { label }),
    ...(facets && facets.length > 0 ? { facets } : {}),
  };
}

function sessionFacetId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !new RegExp(
      `^[A-Za-z][A-Za-z0-9._-]{0,${OMP_ATTENTION_LIMITS.sessionFacetIdCodePoints - 1}}$`,
    ).test(value)
  ) {
    throw new OmpAttentionEventError("OMP attention session facet id is invalid");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OmpAttentionEventError("OMP attention session must be an object");
  }
  return value as Record<string, unknown>;
}
