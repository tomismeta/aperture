import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import surfaceProtocolSchema from "../surface-protocol.schema.json" with { type: "json" };
import type { ApertureSurfaceMessage } from "./protocol.js";

const RFC3339_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const validator = new Ajv2020({ allErrors: true, strict: true });
validator.addFormat("date-time", {
  type: "string",
  validate: isStrictRfc3339DateTime,
});
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

function isStrictRfc3339DateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return false;
  }
  const zone = match[7] ?? "";
  if (zone === "Z" || zone === "z") return true;
  const offsetHour = Number(zone.slice(1, 3));
  const offsetMinute = Number(zone.slice(4, 6));
  return offsetHour <= 23 && offsetMinute <= 59;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
