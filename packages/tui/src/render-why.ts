import type { ApertureTrace } from "./types.js";
import { ANSI, SCREEN_WIDTH, styleMuted, styleActiveGate, styleVerdict } from "./ansi.js";

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

export function renderWhyOverlay(
  trace: ApertureTrace | null,
  color: boolean,
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

  return renderCandidateTrace(trace, color);
}

function renderCandidateTrace(trace: CandidateTrace, color: boolean): string[] {
  const lines: string[] = [];

  // Decision section
  lines.push("");
  lines.push(whySectionHeader("decision", color));
  const route = trace.coordination.kind;
  const candidateScore = trace.coordination.candidateScore;
  const currentScore = trace.coordination.currentScore;
  const threshold = trace.policyRules.criterion?.criterion?.activationThreshold ?? "—";
  lines.push(`   ${styleMuted("route:", color)} ${styleActiveGate(route, color)}  ${styleMuted("·", color)}  ${styleMuted(`score: ${candidateScore}`, color)}  ${styleMuted("·", color)}  ${styleMuted(`current: ${currentScore ?? "—"}`, color)}  ${styleMuted("·", color)}  ${styleMuted(`threshold: ${threshold}`, color)}`);
  if (trace.coordination.reasons.length > 0) {
    lines.push(`   ${styleMuted(trace.coordination.reasons.join("; "), color)}`);
  }

  // Policy gates section
  lines.push("");
  lines.push(whySectionHeader("policy", color));
  for (const gate of trace.policyRules.gateEvaluations) {
    const name = humanRuleName(gate.rule).padEnd(20);
    const outcome = gateOutcome(gate.kind);
    if (gate.kind === "verdict") {
      const rationale = gate.rationale.length > 0 ? `  ${styleMuted(`"${gate.rationale[0]}"`, color)}` : "";
      lines.push(`   ${styleActiveGate(name, color)} → ${styleVerdict(outcome, color)}${rationale}`);
    } else {
      lines.push(`   ${styleMuted(`${name} → ${outcome}`, color)}`);
    }
  }

  // Criterion section
  if (trace.policyRules.criterion) {
    lines.push("");
    lines.push(whySectionHeader("criterion", color));
    const crit = trace.policyRules.criterion;
    const parts = [
      `threshold: ${crit.criterion?.activationThreshold ?? "—"}`,
      `margin: ${crit.criterion?.promotionMargin ?? "—"}`,
    ];
    if (crit.ambiguity) {
      parts.push(`ambiguity: ${crit.ambiguity.reason}`);
    } else {
      parts.push("ambiguity: none");
    }
    lines.push(`   ${styleMuted(parts.join("  ·  "), color)}`);

    // Criterion rule evaluations
    for (const rule of trace.policyRules.criterionEvaluations) {
      const name = humanRuleName(rule.rule).padEnd(20);
      const outcome = criterionOutcome(rule.kind);
      if (rule.kind === "adjust" || rule.kind === "verdict") {
        const rationale = rule.rationale.length > 0 ? `  ${styleMuted(`"${rule.rationale[0]}"`, color)}` : "";
        lines.push(`   ${styleActiveGate(name, color)} → ${styleVerdict(outcome, color)}${rationale}`);
      } else {
        lines.push(`   ${styleMuted(`${name} → ${outcome}`, color)}`);
      }
    }
  }

  // Continuity section
  if (trace.coordination.continuityEvaluations.length > 0) {
    lines.push("");
    lines.push(whySectionHeader("continuity", color));
    for (const rule of trace.coordination.continuityEvaluations) {
      const name = humanRuleName(rule.rule).padEnd(24);
      const outcome = continuityOutcome(rule.kind);
      if (rule.kind === "override") {
        const rationale = rule.rationale.length > 0 ? `  ${styleMuted(`"${rule.rationale[0]}"`, color)}` : "";
        lines.push(`   ${styleActiveGate(name, color)} → ${styleVerdict(outcome, color)}${rationale}`);
      } else {
        const rationale = rule.rationale.length > 0 ? `  ${styleMuted(`"${rule.rationale[0]}"`, color)}` : "";
        lines.push(`   ${styleMuted(`${name} → ${outcome}`, color)}${rationale}`);
      }
    }
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
