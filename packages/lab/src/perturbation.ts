import type { SourceEvent } from "@tomismeta/aperture-core";

import { loadGoldenScenarios } from "./golden.js";
import { runJudgmentBench, type JudgmentBenchRun } from "./judgment-bench.js";
import type { ReplayObservationStep, ReplayScenario } from "./scenario.js";

export type ScenarioPerturbationProfile = {
  id: string;
  description: string;
  transformText: (value: string) => string;
};

export const DEFAULT_PERTURBATION_PROFILES: readonly ScenarioPerturbationProfile[] = [
  {
    id: "surface_noise",
    description: "Case, punctuation, and spacing noise that should not change semantics.",
    transformText(value: string): string {
      const words = value.split(/\s+/);
      const noisy = words.map((word, index) => {
        if (word.length <= 3) {
          return word;
        }

        return index % 2 === 0 ? word.toUpperCase() : word;
      }).join("   ");
      return `${noisy} !!`;
    },
  },
  {
    id: "synonym_shift",
    description: "Phrasing shifts that should preserve the underlying semantic meaning.",
    transformText(value: string): string {
      return applyReplacementSet(value, SYNONYM_REPLACEMENTS);
    },
  },
] as const;

export async function loadPerturbedSemanticScenarios(
  scenarios?: ReplayScenario[],
  profiles: readonly ScenarioPerturbationProfile[] = DEFAULT_PERTURBATION_PROFILES,
): Promise<ReplayScenario[]> {
  const baseScenarios = scenarios ?? await loadGoldenScenarios();
  return generatePerturbedSemanticScenarios(baseScenarios, profiles);
}

export function generatePerturbedSemanticScenarios(
  scenarios: ReplayScenario[],
  profiles: readonly ScenarioPerturbationProfile[] = DEFAULT_PERTURBATION_PROFILES,
): ReplayScenario[] {
  const semanticScenarios = scenarios.filter(isSemanticReplayScenario);
  const perturbed: ReplayScenario[] = [];

  for (const scenario of semanticScenarios) {
    for (const profile of profiles) {
      const variant = perturbReplayScenario(scenario, profile);
      if (variant) {
        perturbed.push(variant);
      }
    }
  }

  return perturbed.sort((left, right) => left.id.localeCompare(right.id));
}

export async function runPerturbedJudgmentBench(
  scenarios?: ReplayScenario[],
  profiles: readonly ScenarioPerturbationProfile[] = DEFAULT_PERTURBATION_PROFILES,
): Promise<JudgmentBenchRun> {
  const perturbedScenarios = await loadPerturbedSemanticScenarios(scenarios, profiles);
  return runJudgmentBench(perturbedScenarios);
}

function isSemanticReplayScenario(scenario: ReplayScenario): boolean {
  const doctrines = new Set(scenario.doctrineTags ?? []);
  return (
    (doctrines.has("semantic_robustness") || doctrines.has("adversarial_semantics"))
    && scenario.steps.some((step) => step.kind === "publishSource")
  );
}

function perturbReplayScenario(
  scenario: ReplayScenario,
  profile: ScenarioPerturbationProfile,
): ReplayScenario | null {
  let changed = false;
  const steps = scenario.steps.map((step) => {
    if (step.kind !== "publishSource") {
      return step;
    }

    const nextEvent = perturbSourceEvent(step.event, profile.transformText);
    if (nextEvent !== step.event) {
      changed = true;
      return {
        ...step,
        event: nextEvent,
      } satisfies ReplayObservationStep;
    }

    return step;
  });

  if (!changed) {
    return null;
  }

  return {
    ...scenario,
    id: `${scenario.id}:perturbed:${profile.id}`,
    title: `${scenario.title} (${profile.id.replaceAll("_", " ")})`,
    description: scenario.description
      ? `${scenario.description} Generated perturbation: ${profile.description}`
      : `Generated perturbation: ${profile.description}`,
    doctrineTags: dedupeStrings([...(scenario.doctrineTags ?? []), "semantic_perturbation", `perturbation_${profile.id}`]),
    steps,
  };
}

function perturbSourceEvent(
  event: SourceEvent,
  transformText: (value: string) => string,
): SourceEvent {
  switch (event.type) {
    case "task.started":
    case "task.updated": {
      const title = transformText(event.title);
      const summary = event.summary !== undefined ? transformText(event.summary) : undefined;
      if (title === event.title && summary === event.summary) {
        return event;
      }

      return {
        ...event,
        title,
        ...(summary !== undefined ? { summary } : {}),
      };
    }
    case "human.input.requested": {
      const title = transformText(event.title);
      const summary = transformText(event.summary);
      if (title === event.title && summary === event.summary) {
        return event;
      }

      return {
        ...event,
        title,
        summary,
      };
    }
    case "task.completed": {
      const summary = event.summary !== undefined ? transformText(event.summary) : undefined;
      if (summary === event.summary) {
        return event;
      }

      return {
        ...event,
        ...(summary !== undefined ? { summary } : {}),
      };
    }
    case "task.cancelled":
      return event;
  }
}

function applyReplacementSet(
  value: string,
  replacements: ReadonlyArray<{ pattern: RegExp; replacement: string }>,
): string {
  let next = value;
  for (const replacement of replacements) {
    next = next.replace(replacement.pattern, replacement.replacement);
  }
  return next;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

const SYNONYM_REPLACEMENTS = [
  { pattern: /\bApprove\b/g, replacement: "Sign off on" },
  { pattern: /\bapprove\b/g, replacement: "sign off on" },
  { pattern: /\bApproval\b/g, replacement: "Sign-off" },
  { pattern: /\bapproval\b/g, replacement: "sign-off" },
  { pattern: /\bRead\b/g, replacement: "Inspect" },
  { pattern: /\bread\b/g, replacement: "inspect" },
  { pattern: /\bwaiting for approval\b/gi, replacement: "awaiting sign-off" },
  { pattern: /\bapproval required\b/gi, replacement: "sign-off required" },
  { pattern: /\bno approval needed\b/gi, replacement: "sign-off not needed" },
] as const;
