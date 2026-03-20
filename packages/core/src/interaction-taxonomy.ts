import type { AttentionActivityClass } from "./events.js";
import {
  inferSemanticToolFamily,
  readExplicitSemanticToolFamily,
  type SemanticDetectionInput,
} from "./semantic-detection.js";

type TaxonomyInput = SemanticDetectionInput;

type BoundedToolFamilyInput = TaxonomyInput & {
  mode: "status" | "approval" | "choice" | "form";
  activityClass?: AttentionActivityClass;
};

export function readExplicitToolFamily(input: TaxonomyInput): string | null {
  return readExplicitSemanticToolFamily(input);
}

export function inferToolFamily(input: TaxonomyInput): string | null {
  return inferSemanticToolFamily(input);
}

export function readBoundedToolFamily(input: BoundedToolFamilyInput): string | null {
  if (input.mode === "status") {
    return readExplicitToolFamily(input);
  }

  if (input.activityClass !== undefined && input.activityClass !== "permission_request") {
    return readExplicitToolFamily(input);
  }

  if (input.mode !== "approval") {
    return readExplicitToolFamily(input);
  }

  return inferToolFamily(input);
}

export function sourceKey(source?: { kind?: string; id: string }): string | null {
  if (!source) {
    return null;
  }

  return source.kind ?? source.id;
}
