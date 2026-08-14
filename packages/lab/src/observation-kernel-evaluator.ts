import { ApertureCore } from "@tomismeta/aperture-core";
import {
  isCandidateTrace,
  projectObservationJudgmentContract,
  subscribeInternalTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

import { digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import type { ObservationKernelFixture } from "./observation-kernel-fixtures.js";
import type {
  ObservationKernelDecisionFields,
  ObservationKernelFields,
  ObservationKernelObservation,
} from "./observation-kernel-scorecard-model.js";

export function evaluateObservationKernelFixture(
  fixture: ObservationKernelFixture,
): ObservationKernelObservation[] {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];
  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  for (const event of fixture.events) {
    core.publish(normalizeSourceEvent(event));
  }

  let sequence = 0;
  return traces.flatMap((trace) => {
    if (!isCandidateTrace(trace)) {
      return [];
    }
    const observation = trace.evaluation.adjusted.judgmentInput.observation;
    if (observation === undefined) {
      return [];
    }

    const fields: ObservationKernelFields = {
      kind: observation.kind,
      polarity: observation.polarity,
      owner: observation.ownership.owner,
      toolFamily: observation.ownership.toolFamily ?? null,
      subject: observation.subject,
      evidenceLoss: observation.evidenceLoss,
      evidenceStrength: observation.evidenceStrength,
      semanticAgreement: observation.semanticAgreement,
      diagnosticClass: observation.diagnosticClass ?? null,
      recoveryHint: observation.recoveryHint ?? null,
      provenanceOrigin: observation.provenance.origin,
      provenanceAuthority: observation.provenance.authority,
      consequenceBaseline: observation.consequenceBaseline,
    };
    const judgment = projectObservationJudgmentContract(observation);
    const decision: ObservationKernelDecisionFields = {
      plannerKind: trace.coordination.kind,
      resultLane: trace.coordination.resultLane,
    };
    const observationSequence = sequence++;
    const judgmentDigest = digestKernelCanonicalJson(judgment);
    const semanticDigest = digestKernelCanonicalJson(fields);
    const decisionDigest = digestKernelCanonicalJson(decision);

    return [
      {
        fixtureId: fixture.id,
        dimension: fixture.dimension,
        sequence: observationSequence,
        digest: digestKernelCanonicalJson({
          fixtureId: fixture.id,
          dimension: fixture.dimension,
          split: fixture.split,
          sequence: observationSequence,
          fields,
          judgment,
          decision,
        }),
        semanticDigest,
        judgmentDigest,
        decisionDigest,
        split: fixture.split,
        fields,
        judgment,
        decision,
      },
    ];
  });
}

export function digestObservationKernelList(
  observations: readonly ObservationKernelObservation[],
): string {
  return observations
    .map((observation) => `${observation.fixtureId}:${observation.digest}`)
    .sort()
    .join("\n");
}
