import { Type, type Static } from "@sinclair/typebox";

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

export const WorkReceiptSchema = Type.Object(
  {
    ok: Type.Literal(true),
    apiVersion: Type.String(),
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

export const WorkResponseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    apiVersion: Type.String(),
    taskId: Type.String(),
    interactionId: Type.String(),
    state: WorkResponseStateSchema,
    message: Type.String(),
    response: Type.Optional(Type.Any()),
    answeredAt: Type.Optional(Type.String()),
    expiresAt: Type.Optional(Type.String()),
    cancelledAt: Type.Optional(Type.String()),
    retentionExpiresAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkEndpointDescriptionSchema = Type.Object(
  {
    apiVersion: Type.String(),
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
export type WorkEndpointDescription = Static<typeof WorkEndpointDescriptionSchema>;
export type WorkResponseState = Static<typeof WorkResponseStateSchema>;
export type WorkReceiptMode = Static<typeof WorkReceiptModeSchema>;
export type WorkReceiptItem = Static<typeof WorkReceiptItemSchema>;
export type WorkReceiptNextStep = Static<typeof WorkReceiptNextStepSchema>;

export function workReceiptSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkReceiptSchema)) as Record<string, unknown>;
}

export function workResponseSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkResponseSchema)) as Record<string, unknown>;
}

export function workEndpointDescriptionSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkEndpointDescriptionSchema)) as Record<string, unknown>;
}
