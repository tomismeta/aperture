import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

export type SemanticStructuredOutputOwnership = "unsupported" | "native" | "exact";

export function readSemanticStructuredOutputOwnership(
  toolFamily: string | undefined,
): SemanticStructuredOutputOwnership {
  if (isSemanticCommandExecutionToolFamily(toolFamily) || toolFamily === "edit") {
    return "native";
  }

  return isExplicitStructuredOutputExclusion(toolFamily) ? "unsupported" : "exact";
}

function isExplicitStructuredOutputExclusion(toolFamily: string | undefined): boolean {
  return (
    toolFamily === "read" ||
    toolFamily === "search" ||
    toolFamily === "web" ||
    toolFamily === "write"
  );
}
