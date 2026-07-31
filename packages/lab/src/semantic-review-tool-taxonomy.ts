const KNOWN_TOOL_FAMILIES = new Set([
  "bash",
  "edit",
  "exec_command",
  "read",
  "run_shell_command",
  "search",
  "task",
  "web",
  "write",
]);

export function hasToolTaxonomyGap(toolFamily: string | null | undefined): boolean {
  return typeof toolFamily === "string" && !KNOWN_TOOL_FAMILIES.has(toolFamily);
}
