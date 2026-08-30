import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import * as addFormatsModule from "ajv-formats";

import surfaceProtocolSchema from "../surface-protocol.schema.json" with { type: "json" };
import type { ApertureSurfaceMessage } from "./protocol.js";

const validator = new Ajv2020({ allErrors: true, strict: true });
(addFormatsModule.default as unknown as (ajv: Ajv2020) => Ajv2020)(validator);
const validateMessage = validator.compile<ApertureSurfaceMessage>(surfaceProtocolSchema);

export function isApertureSurfaceMessage(value: unknown): value is ApertureSurfaceMessage {
  return validateMessage(value);
}

export function assertApertureSurfaceMessage(
  value: unknown,
): asserts value is ApertureSurfaceMessage {
  if (validateMessage(value)) return;

  const detail = (validateMessage.errors ?? []).map(formatValidationError).join("; ");
  throw new Error(
    `Aperture surface message failed schema validation: ${detail || "unknown error"}`,
  );
}

function formatValidationError(error: ErrorObject): string {
  return `${error.instancePath || "/"} ${error.message ?? error.keyword}`;
}
