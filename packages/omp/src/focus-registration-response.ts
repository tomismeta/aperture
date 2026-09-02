import type {
  FocusRegistration,
  FocusRegistrationResult,
  WorkerDirectAcknowledgement,
} from "@tomismeta/aperture/worker-direct-message";

export function focusRegistrationResult(
  registration: FocusRegistration,
  acknowledgement: WorkerDirectAcknowledgement,
): FocusRegistrationResult {
  if (acknowledgement.status !== "accepted" || !acknowledgement.workerGeneration) {
    throw new Error("Aperture worker returned incomplete registration identity");
  }
  const recovery = acknowledgement.recovery;
  if (registration.target.kind === "direct-terminal") {
    if (recovery !== undefined) {
      throw new Error("Aperture worker returned unexpected direct-terminal recovery");
    }
    return { workerGeneration: acknowledgement.workerGeneration };
  }
  if (!recovery || recovery.kind !== registration.target.kind) {
    throw new Error("Aperture worker returned incomplete focus recovery");
  }
  return { workerGeneration: acknowledgement.workerGeneration, recovery };
}
