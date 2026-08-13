import { FormatRegistry } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

export const WORK_MAX_ID_LENGTH = 256;
export const WORK_MAX_TITLE_LENGTH = 512;
export const WORK_MAX_SUMMARY_LENGTH = 8_192;
export const WORK_MAX_REASON_LENGTH = 4_096;
export const WORK_MAX_LABEL_LENGTH = 512;
export const WORK_MAX_TEXT_LENGTH = 8_192;
export const WORK_MAX_SOURCE_LENGTH = 512;
export const WORK_MAX_TYPE_LENGTH = 256;
export const WORK_MAX_SUBJECT_LENGTH = 256;
export const WORK_MAX_SCHEMA_LENGTH = 1_024;
export const WORK_MAX_CONTENT_TYPE_LENGTH = 128;
export const WORK_MAX_TRACE_FIELD_LENGTH = 512;
export const WORK_MAX_OPTIONS = 64;
export const WORK_MAX_FIELDS = 64;
export const WORK_MAX_CONTEXT_ITEMS = 64;
export const WORK_MAX_BATCH = 64;

FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)));

export const NonEmptyString = (
  maxLength: number,
  description?: string,
): ReturnType<typeof Type.String> =>
  Type.String({
    minLength: 1,
    maxLength,
    ...(description !== undefined ? { description } : {}),
  });

export const LooseString = (
  maxLength: number,
  description?: string,
): ReturnType<typeof Type.String> =>
  Type.String({
    maxLength,
    ...(description !== undefined ? { description } : {}),
  });

export const WorkEventTraceSchema = Type.Object(
  {
    traceparent: Type.Optional(NonEmptyString(WORK_MAX_TRACE_FIELD_LENGTH)),
    tracestate: Type.Optional(LooseString(WORK_MAX_TRACE_FIELD_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventRunSchema = Type.Object(
  {
    sessionId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
    runId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventAutomationSchema = Type.Object(
  {
    runMode: Type.Optional(
      Type.Union([
        Type.Literal("interactive"),
        Type.Literal("background"),
        Type.Literal("scheduled"),
      ]),
    ),
    trigger: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    recurrence: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("recurring")])),
    scheduleId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventExecutionSchema = Type.Object(
  {
    surface: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    placement: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    runner: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    environment: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventGovernanceSchema = Type.Object(
  {
    policyId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
    approvalState: Type.Optional(
      Type.Union([
        Type.Literal("not_required"),
        Type.Literal("pending"),
        Type.Literal("approved"),
        Type.Literal("rejected"),
      ]),
    ),
    approvalId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
    decisionId: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventUsageSchema = Type.Object(
  {
    model: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    modelRouting: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    cachedInputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventActorSchema = Type.Object(
  {
    id: NonEmptyString(WORK_MAX_ID_LENGTH),
    kind: Type.Optional(
      Type.Union([
        Type.Literal("agent"),
        Type.Literal("subagent"),
        Type.Literal("host"),
        Type.Literal("system"),
        Type.Literal("human"),
      ]),
    ),
    label: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventFactsSchema = Type.Object(
  {
    capabilityFamily: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    activityCategory: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventHintsSchema = Type.Object(
  {
    consequence: Type.Optional(
      Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
    ),
    capabilityFamily: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    activityCategory: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    requestKind: Type.Optional(
      Type.Union([Type.Literal("approval"), Type.Literal("choice"), Type.Literal("form")]),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventContextItemSchema = Type.Object(
  {
    id: NonEmptyString(WORK_MAX_ID_LENGTH),
    label: Type.Optional(NonEmptyString(WORK_MAX_LABEL_LENGTH)),
    value: Type.Union([
      Type.String({ maxLength: WORK_MAX_TEXT_LENGTH }),
      Type.Number(),
      Type.Boolean(),
    ]),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventContextSchema = Type.Object(
  {
    items: Type.Optional(
      Type.Array(WorkEventContextItemSchema, {
        minItems: 1,
        maxItems: WORK_MAX_CONTEXT_ITEMS,
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventInteractionSchema = Type.Object(
  {
    id: NonEmptyString(WORK_MAX_ID_LENGTH),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventRequestOptionSchema = Type.Object(
  {
    id: NonEmptyString(WORK_MAX_ID_LENGTH),
    label: NonEmptyString(WORK_MAX_LABEL_LENGTH),
    summary: Type.Optional(LooseString(WORK_MAX_SUMMARY_LENGTH)),
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventRequestFieldOptionSchema = Type.Object(
  {
    value: NonEmptyString(WORK_MAX_ID_LENGTH),
    label: NonEmptyString(WORK_MAX_LABEL_LENGTH),
  },
  {
    additionalProperties: false,
  },
);

export const BaseWorkSchemaProperties = {
  id: NonEmptyString(WORK_MAX_ID_LENGTH),
  title: Type.Optional(NonEmptyString(WORK_MAX_TITLE_LENGTH)),
  summary: Type.Optional(LooseString(WORK_MAX_SUMMARY_LENGTH)),
  reason: Type.Optional(LooseString(WORK_MAX_REASON_LENGTH)),
  progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
} as const;

export const WorkEventMetadataSchema = (
  workApiVersion: string,
  workEventTraceSchema = WorkEventTraceSchema,
  workEventRunSchema = WorkEventRunSchema,
) =>
  ({
    specVersion: Type.Optional(
      Type.Literal(workApiVersion, {
        default: workApiVersion,
        description:
          "Optional on ingress. Aperture defaults this to the current Work contract version when omitted. Only the current version is accepted.",
      }),
    ),
    id: Type.Optional(NonEmptyString(WORK_MAX_ID_LENGTH)),
    source: Type.Optional(NonEmptyString(WORK_MAX_SOURCE_LENGTH)),
    type: Type.Optional(NonEmptyString(WORK_MAX_TYPE_LENGTH)),
    time: Type.Optional(Type.String({ format: "date-time" })),
    subject: Type.Optional(NonEmptyString(WORK_MAX_SUBJECT_LENGTH)),
    schema: Type.Optional(Type.String({ maxLength: WORK_MAX_SCHEMA_LENGTH })),
    contentType: Type.Optional(NonEmptyString(WORK_MAX_CONTENT_TYPE_LENGTH)),
    trace: Type.Optional(workEventTraceSchema),
    run: Type.Optional(workEventRunSchema),
  }) as const;

export const WorkEventSharedSchema = (
  workEventActorSchema = WorkEventActorSchema,
  workEventFactsSchema = WorkEventFactsSchema,
  workEventHintsSchema = WorkEventHintsSchema,
  workEventContextSchema = WorkEventContextSchema,
  workEventAutomationSchema = WorkEventAutomationSchema,
  workEventExecutionSchema = WorkEventExecutionSchema,
  workEventGovernanceSchema = WorkEventGovernanceSchema,
  workEventUsageSchema = WorkEventUsageSchema,
) =>
  ({
    actor: Type.Optional(workEventActorSchema),
    facts: Type.Optional(workEventFactsSchema),
    hints: Type.Optional(workEventHintsSchema),
    context: Type.Optional(workEventContextSchema),
    automation: Type.Optional(workEventAutomationSchema),
    execution: Type.Optional(workEventExecutionSchema),
    governance: Type.Optional(workEventGovernanceSchema),
    usage: Type.Optional(workEventUsageSchema),
    extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }) as const;
