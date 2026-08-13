import { Type, type Static } from "@sinclair/typebox";
import type { AttentionResponse } from "@tomismeta/aperture-core";

import { WORK_API_VERSION } from "./work-contract.js";

const WorkResponseStateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("answered"),
  Type.Literal("expired"),
  Type.Literal("cancelled"),
]);

const WorkReceiptModeSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("event"),
  Type.Literal("batch"),
]);

const WorkReceiptNextStepSchema = Type.Object(
  {
    when: Type.String(),
    send: Type.Union([
      Type.Literal("text"),
      Type.Literal("WorkEvent"),
      Type.Literal("WorkEvent[]"),
    ]),
    why: Type.String(),
  },
  { additionalProperties: false },
);

const WorkReceiptItemSchema = Type.Object(
  {
    taskId: Type.String(),
    type: Type.String(),
    title: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    interactionId: Type.Optional(Type.String()),
    responsePath: Type.Optional(Type.String()),
    responseUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkResponseAnswerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("acknowledged") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("approved"), reason: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("rejected"), reason: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("option_selected"),
      optionIds: Type.Array(Type.String(), { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("text_submitted"), text: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("form_submitted"),
      values: Type.Record(Type.String(), Type.Unknown()),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal("dismissed") }, { additionalProperties: false }),
]);

const WorkResponseBaseProperties = {
  ok: Type.Literal(true),
  apiVersion: Type.Literal(WORK_API_VERSION),
  taskId: Type.String(),
  interactionId: Type.String(),
  message: Type.String(),
};

export const WorkReceiptSchema = Type.Object(
  {
    ok: Type.Literal(true),
    apiVersion: Type.Literal(WORK_API_VERSION),
    accepted: Type.Integer({ minimum: 0 }),
    receivedAs: WorkReceiptModeSchema,
    message: Type.String(),
    published: Type.Array(WorkReceiptItemSchema),
    retention: Type.Optional(
      Type.Object(
        {
          pendingTtlMs: Type.Integer({ minimum: 0 }),
          terminalRetentionMs: Type.Integer({ minimum: 0 }),
          capacity: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    next: Type.Optional(Type.Array(WorkReceiptNextStepSchema)),
  },
  { additionalProperties: false },
);

export const WorkResponseSchema = Type.Union([
  Type.Object(
    {
      ...WorkResponseBaseProperties,
      state: Type.Literal("pending"),
      expiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...WorkResponseBaseProperties,
      state: Type.Literal("answered"),
      response: WorkResponseAnswerSchema,
      answeredAt: Type.String(),
      retentionExpiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...WorkResponseBaseProperties,
      state: Type.Literal("expired"),
      expiresAt: Type.String(),
      retentionExpiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...WorkResponseBaseProperties,
      state: Type.Literal("cancelled"),
      cancelledAt: Type.String(),
      retentionExpiresAt: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

export const WorkEndpointDescriptionSchema = Type.Object(
  {
    apiVersion: Type.Literal(WORK_API_VERSION),
    path: Type.Literal("/work"),
    method: Type.Literal("POST"),
    summary: Type.String(),
    auth: Type.String(),
    send: Type.Array(
      Type.Object(
        {
          receivedAs: WorkReceiptModeSchema,
          contentType: Type.String(),
          body: Type.String(),
          bestFor: Type.String(),
          example: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    response: Type.Object(
      {
        path: Type.Literal("/work/response/{interactionId}"),
        deletePath: Type.Literal("/work/response/{interactionId}"),
        bestFor: Type.String(),
        states: Type.Array(WorkResponseStateSchema),
      },
      { additionalProperties: false },
    ),
    retention: Type.Object(
      {
        pendingTtlMs: Type.Integer({ minimum: 0 }),
        terminalRetentionMs: Type.Integer({ minimum: 0 }),
        capacity: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    next: Type.Array(WorkReceiptNextStepSchema),
  },
  { additionalProperties: false },
);

export type WorkReceipt = Static<typeof WorkReceiptSchema>;
export type WorkResponse = Static<typeof WorkResponseSchema>;
export type WorkResponseAnswer = Static<typeof WorkResponseAnswerSchema>;
export type WorkEndpointDescription = Static<typeof WorkEndpointDescriptionSchema>;
export type WorkResponseState = Static<typeof WorkResponseStateSchema>;
export type WorkReceiptMode = Static<typeof WorkReceiptModeSchema>;
export type WorkReceiptItem = Static<typeof WorkReceiptItemSchema>;
export type WorkReceiptNextStep = Static<typeof WorkReceiptNextStepSchema>;

type TypeEqual<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? (<T>() => T extends Right ? 1 : 2) extends <T>() => T extends Left ? 1 : 2
      ? true
      : false
    : false;

const workResponseAnswerTypeCheck: TypeEqual<WorkResponseAnswer, AttentionResponse["response"]> =
  true;
void workResponseAnswerTypeCheck;

export function workReceiptSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkReceiptSchema)) as Record<string, unknown>;
}

export function workResponseSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkResponseSchema)) as Record<string, unknown>;
}

export function workEndpointDescriptionSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkEndpointDescriptionSchema)) as Record<string, unknown>;
}
