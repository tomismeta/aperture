import type { ApertureTrace } from "./types.js";
import { ANSI, SCREEN_WIDTH, CONTENT_WIDTH, styleMuted, styleActiveGate, styleVerdict, styleValue, wrapText } from "./ansi.js";

type CandidateTrace = Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;

function isCandidateTrace(trace: ApertureTrace): trace is CandidateTrace {
  return trace.evaluation.kind === "candidate";
}

// ── Operator-facing rule outcome labels ──────────────────────────────
// These translate internal engine terminology into readable operator language.

function gateOutcome(kind: string): string {
  return kind === "verdict" ? "set policy" : "did not apply";
}

function criterionOutcome(kind: string): string {
  switch (kind) {
    case "verdict": return "resolved route";
    case "adjust": return "adjusted threshold";
    default: return "did not apply";
  }
}

function continuityOutcome(kind: string): string {
  return kind === "override" ? "rerouted" : "did not apply";
}

// Humanize underscore_case rule names
function humanRuleName(name: string): string {
  return name.replace(/_/g, " ");
}

function humanDecisionKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

export function renderWhyOverlay(
  trace: ApertureTrace | null,
  color: boolean,
  expanded = false,
): string[] {
  if (!trace) {
    return [
      "",
      styleMuted("   no trace available for this interaction", color),
      styleMuted("   traces are captured when the engine routes a candidate", color),
      "",
    ];
  }

  if (!isCandidateTrace(trace)) {
    return [
      "",
      styleMuted(`   trace kind: ${trace.evaluation.kind}`, color),
      styleMuted("   no judgment data for this event type", color),
      "",
    ];
  }

  return renderCandidateTrace(trace, color, expanded);
}

/**
 * Render a rule evaluation line with proper text wrapping.
 * The rationale text wraps with continuation lines aligned to the rationale start.
 *
 *   rule name             → outcome  "rationale text that may be
 *                                     long and needs wrapping"
 */
function renderRuleLine(
  name: string,
  outcome: string,
  rationale: string | undefined,
  active: boolean,
  color: boolean,
  indent: number,
  nameWidth: number,
): string[] {
  const pad = " ".repeat(indent);
  const paddedName = name.padEnd(nameWidth);
  const arrow = "→";

  if (!active) {
    // Dim entire line — no rationale wrapping needed for inactive rules
    const line = `${pad}${paddedName} ${arrow} ${outcome}`;
    return [styleMuted(line, color)];
  }

  // Active rule: styled name → styled outcome + optional rationale
  const prefix = `${pad}${styleActiveGate(paddedName, color)} ${arrow} ${styleVerdict(outcome, color)}`;

  if (!rationale) {
    return [prefix];
  }

  // Calculate where rationale starts (after "   name____ → outcome  ")
  const rationaleIndent = indent + nameWidth + ` ${arrow} `.length + outcome.length + 2;
  const rationaleWidth = Math.max(20, CONTENT_WIDTH - rationaleIndent);
  const wrapped = wrapText(`"${rationale}"`, rationaleWidth);
  const continuationPad = " ".repeat(rationaleIndent);

  const lines: string[] = [];
  lines.push(`${prefix}  ${styleMuted(wrapped[0] ?? "", color)}`);
  for (let i = 1; i < wrapped.length; i++) {
    lines.push(`${continuationPad}${styleMuted(wrapped[i] ?? "", color)}`);
  }
  return lines;
}

function renderCandidateTrace(trace: CandidateTrace, color: boolean, expanded: boolean): string[] {
  const lines: string[] = [];

  // Decision section — always shown in full
  lines.push("");
  lines.push(whySectionHeader("decision", color));
  const route = trace.coordination.kind;
  const surfaced = trace.coordination.resultBucket;
  const candidateScore = trace.coordination.candidateScore;
  const currentScore = trace.coordination.currentScore;
  const threshold = trace.policyRules.criterion?.criterion?.activationThreshold ?? "—";
  lines.push(`   ${styleMuted("route:", color)} ${styleActiveGate(humanDecisionKind(route), color)}  ${styleMuted("·", color)}  ${styleMuted("surface:", color)} ${styleVerdict(surfaced, color)}  ${styleMuted("·", color)}  ${styleMuted("score:", color)} ${styleValue(String(candidateScore), color)}  ${styleMuted("·", color)}  ${styleMuted("current:", color)} ${styleValue(String(currentScore ?? "—"), color)}  ${styleMuted("·", color)}  ${styleMuted("threshold:", color)} ${styleValue(String(threshold), color)}`);
  if (trace.coordination.reasons.length > 0) {
    lines.push(`   ${styleMuted(trace.coordination.reasons.join("; "), color)}`);
  }

  // Policy gates section
  lines.push("");
  lines.push(whySectionHeader("policy", color));
  lines.push(...renderRuleSection(
    trace.policyRules.gateEvaluations,
    (gate) => gate.kind === "verdict",
    (gate) => gateOutcome(gate.kind),
    expanded, color, 3, 20,
  ));

  // Criterion section
  if (trace.policyRules.criterion) {
    lines.push("");
    lines.push(whySectionHeader("criterion", color));
    const crit = trace.policyRules.criterion;
    const thresholdVal = String(crit.criterion?.activationThreshold ?? "—");
    const marginVal = String(crit.criterion?.promotionMargin ?? "—");
    const ambiguityVal = crit.ambiguity ? crit.ambiguity.reason : "none";
    lines.push(`   ${styleMuted("threshold:", color)} ${styleValue(thresholdVal, color)}  ${styleMuted("·", color)}  ${styleMuted("margin:", color)} ${styleValue(marginVal, color)}  ${styleMuted("·", color)}  ${styleMuted("ambiguity:", color)} ${styleMuted(ambiguityVal, color)}`);

    lines.push(...renderRuleSection(
      trace.policyRules.criterionEvaluations,
      (rule) => rule.kind === "adjust" || rule.kind === "verdict",
      (rule) => criterionOutcome(rule.kind),
      expanded, color, 3, 20,
    ));
  }

  // Continuity section
  if (trace.coordination.continuityEvaluations.length > 0) {
    lines.push("");
    lines.push(whySectionHeader("continuity", color));
    lines.push(...renderRuleSection(
      trace.coordination.continuityEvaluations,
      (rule) => rule.kind === "override",
      (rule) => continuityOutcome(rule.kind),
      expanded, color, 3, 24,
    ));
  }

  return lines;
}

/**
 * Render a section of rules with collapse/expand support.
 * In collapsed mode, only triggered rules are shown + a count of hidden ones.
 * In expanded mode, all rules are shown (triggered rules styled, others dim).
 */
function renderRuleSection(
  rules: Array<{ rule: string; kind: string; rationale: string[] }>,
  isActive: (rule: { rule: string; kind: string; rationale: string[] }) => boolean,
  getOutcome: (rule: { rule: string; kind: string; rationale: string[] }) => string,
  expanded: boolean,
  color: boolean,
  indent: number,
  nameWidth: number,
): string[] {
  const lines: string[] = [];
  let hiddenCount = 0;

  for (const rule of rules) {
    const active = isActive(rule);

    if (!expanded && !active) {
      hiddenCount++;
      continue;
    }

    const name = humanRuleName(rule.rule);
    const outcome = getOutcome(rule);
    const rationale = active && rule.rationale.length > 0 ? rule.rationale[0] : undefined;
    lines.push(...renderRuleLine(name, outcome, rationale, active, color, indent, nameWidth));
  }

  if (hiddenCount > 0) {
    const pad = " ".repeat(indent);
    const countText = `+ ${hiddenCount} rule${hiddenCount === 1 ? "" : "s"} did not apply`;
    lines.push(styleMuted(`${pad}${countText}`, color));
  }

  return lines;
}

function whySectionHeader(label: string, color: boolean): string {
  const prefix = ` ┄ ${label} `;
  const fill = "┄".repeat(Math.max(0, SCREEN_WIDTH - prefix.length));
  return color
    ? `${ANSI.dim}${prefix}${fill}${ANSI.reset}`
    : `${prefix}${fill}`;
}
