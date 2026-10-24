import type { AttentionResponse } from "@tomismeta/aperture-core";
import {
  isApertureCoreResponseExpiredError,
  isApertureCoreValidationError,
} from "@tomismeta/aperture-core/internal";
import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { RuntimeHttpError } from "./runtime-http.js";

type RuntimeResponseContext = Pick<BuildRuntimeRoutesOptions, "state" | "core">;

export function retractRuntimeInteraction(
  options: RuntimeResponseContext,
  retraction: Pick<AttentionResponse, "taskId" | "interactionId">,
): boolean {
  const workResponse = options.state.readWorkResponse(retraction.interactionId);
  const retracted = options.core.retract(retraction.taskId, retraction.interactionId);
  if (workResponse?.taskId === retraction.taskId && workResponse.state === "pending") {
    options.state.cancelWorkResponse(retraction.interactionId);
  }
  return retracted;
}

export function submitRuntimeResponse(
  options: RuntimeResponseContext,
  response: AttentionResponse,
): void {
  options.state.withResponseSubmission(response, (workResponse) => {
    if (workResponse?.state === "expired" || workResponse?.state === "cancelled") {
      options.core.retract(response.taskId, response.interactionId);
      throw new RuntimeHttpError(
        409,
        `response_${workResponse.state}`,
        `The interaction response is ${workResponse.state}.`,
        "Republish the interaction before submitting a response.",
      );
    }
    try {
      options.core.submit(response);
    } catch (error) {
      if (isApertureCoreResponseExpiredError(error)) {
        options.state.limitWorkResponseExpiry(response.taskId, response.interactionId);
        options.core.retract(response.taskId, response.interactionId);
        throw new RuntimeHttpError(
          409,
          error.code,
          error.message,
          "Refresh the pending frame or republish the interaction before submitting a response.",
        );
      }
      if (isApertureCoreValidationError(error)) {
        throw new RuntimeHttpError(400, error.code, error.message);
      }
      throw error;
    }
  });
  options.state.recordSubmittedResponse(response);
}
