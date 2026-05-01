import {
  isApertureCoreResponseExpiredError,
  isApertureCoreValidationError,
} from "@tomismeta/aperture-core/internal";

import type { BuildRuntimeRoutesOptions } from "./runtime-routes.js";
import { readJson, RuntimeHttpError, writeJson } from "./runtime-http.js";
import { matchLiteral, type RuntimeRoute } from "./runtime-router.js";
import {
  normalizeSourceEventPayload,
  validateAttentionResponse,
  validateOperatorEngagement,
} from "./runtime-validation.js";
import type { LearningPersistenceState } from "./learning-persistence.js";
import type { SourceEvent } from "@tomismeta/aperture-core";

export function createRuntimeControlRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    {
      name: "runtime.health",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/health`),
      requiresAuth: false,
      handler: async ({ res }) => {
        const snapshot = options.state.snapshot(options.core);
        writeJson(res, 200, {
          ok: true,
          runtimeId: options.runtimeId,
          kind: options.kind,
          adapterCount: snapshot.adapters.length,
          surfaceCount: snapshot.surfaceCount,
          authRequired: true,
          metadata: options.metadata ?? {},
          health: snapshot.health,
        });
      },
    },
    {
      name: "runtime.state",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/state`),
      handler: async ({ res }) => {
        writeJson(res, 200, options.state.snapshot(options.core));
      },
    },
    {
      name: "runtime.learning.checkpoint",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/learning/checkpoint`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res }) => {
        const snapshot = await options.core.checkpointMemory();
        if (!snapshot) {
          writeJson(res, 200, { checkpointed: false });
          return;
        }
        const nextLearningPersistence: LearningPersistenceState = {
          ...(options.readLearningPersistence() ?? { enabled: true }),
          lastCheckpointAt: snapshot.updatedAt,
        };
        options.setLearningPersistence(nextLearningPersistence);
        writeJson(res, 200, {
          checkpointed: true,
          updatedAt: snapshot.updatedAt,
          sessionCount: snapshot.sessionCount,
        });
      },
    },
    {
      name: "runtime.learning.reload",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/learning/reload`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ res }) => {
        const reloaded = await options.core.reloadMarkdown();
        if (!reloaded) {
          writeJson(res, 200, { reloaded: false });
          return;
        }
        const loadedAt = new Date().toISOString();
        const nextLearningPersistence: LearningPersistenceState = {
          ...(options.readLearningPersistence() ?? { enabled: true }),
          lastLoadedAt: loadedAt,
        };
        options.setLearningPersistence(nextLearningPersistence);
        writeJson(res, 200, { reloaded: true, loadedAt });
      },
    },
    {
      name: "runtime.events.feed",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/events`),
      handler: async ({ res, url }) => {
        const since = Number(url.searchParams.get("since") ?? "0");
        writeJson(res, 200, {
          events: options.state.eventsSince(since),
          nextSequence: options.state.nextSequence(),
          stateVersion: options.state.version,
        });
      },
    },
    {
      name: "runtime.session",
      method: "GET",
      match: matchLiteral(`${options.controlPathPrefix}/session`),
      handler: async ({ res }) => {
        writeJson(res, 200, options.exportSessionCapture());
      },
    },
    {
      name: "runtime.response.submit",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/response`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.general);
        const response = validateAttentionResponse(payload);
        if (!response) {
          throw new RuntimeHttpError(
            400,
            "invalid_attention_response",
            "Invalid attention response payload.",
          );
        }
        try {
          options.core.submit(response);
        } catch (error) {
          if (isApertureCoreResponseExpiredError(error)) {
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
        options.state.recordSubmittedResponse(response, new Date().toISOString());
        writeJson(res, 200, {});
      },
    },
    {
      name: "runtime.engagement",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/engagement`),
      mutating: true,
      rateLimitKey: "control",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.general);
        const engagement = validateOperatorEngagement(payload);
        if (!engagement) {
          throw new RuntimeHttpError(
            400,
            "invalid_engagement",
            "Invalid operator engagement payload.",
          );
        }
        options.core.engage(engagement.taskId, engagement.interactionId, {
          ...(engagement.durationMs !== undefined ? { durationMs: engagement.durationMs } : {}),
        });
        writeJson(res, 200, { engaged: true });
      },
    },
    {
      name: "runtime.events.source.publish",
      method: "POST",
      match: matchLiteral(`${options.controlPathPrefix}/events/source`),
      mutating: true,
      rateLimitKey: "source",
      handler: async ({ req, res }) => {
        const payload = await readJson(req, options.bodyLimits.sourceEvents);
        let sourceEvents: SourceEvent[];
        try {
          sourceEvents = normalizeSourceEventPayload(payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid source event payload.";
          throw new RuntimeHttpError(400, "invalid_source_event", message);
        }
        options.publishSourceEvents(sourceEvents);
        writeJson(res, 200, { published: sourceEvents.length });
      },
    },
  ];
}
