import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  BaseWorkSchemaProperties,
  LooseString,
  NonEmptyString,
  WORK_MAX_BATCH,
  WORK_MAX_FIELDS,
  WORK_MAX_ID_LENGTH,
  WORK_MAX_LABEL_LENGTH,
  WORK_MAX_OPTIONS,
  WORK_MAX_SUMMARY_LENGTH,
  WORK_MAX_TITLE_LENGTH,
  WorkEventContextItemSchema,
  WorkEventInteractionSchema,
  WorkEventMetadataSchema,
  WorkEventRequestFieldOptionSchema,
  WorkEventRequestOptionSchema,
  WorkEventSharedSchema,
} from "./work-contract-shared.js";

export const WORK_API_VERSION = "1.0";
export const WORK_SCHEMA_ID = "urn:aperture:work-event:1.0";
export const WORK_BATCH_SCHEMA_ID = "urn:aperture:work-event-batch:1.0";
export const WORK_SCHEMA_URL = "https://schema.aperture.dev/work-event.v1.json";
export const DEFAULT_WORK_EVENT_SOURCE = "urn:aperture:work";

const WorkEventApprovalRequestSchema = Type.Object(
  {
    kind: Type.Literal("approval"),
    title: Type.Optional(NonEmptyString(WORK_MAX_TITLE_LENGTH)),
    summary: Type.Optional(LooseString(WORK_MAX_SUMMARY_LENGTH)),
    requireReason: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
  },
);

const WorkEventChoiceRequestSchema = Type.Object(
  {
    kind: Type.Literal("choice"),
    title: Type.Optional(NonEmptyString(WORK_MAX_TITLE_LENGTH)),
    summary: Type.Optional(LooseString(WORK_MAX_SUMMARY_LENGTH)),
    selectionMode: Type.Union([Type.Literal("single"), Type.Literal("multiple")]),
    allowTextResponse: Type.Optional(Type.Boolean()),
    options: Type.Array(WorkEventRequestOptionSchema, {
      minItems: 1,
      maxItems: WORK_MAX_OPTIONS,
    }),
  },
  {
    additionalProperties: false,
  },
);

const WorkEventFormRequestSchema = Type.Object(
  {
    kind: Type.Literal("form"),
    title: Type.Optional(NonEmptyString(WORK_MAX_TITLE_LENGTH)),
    summary: Type.Optional(LooseString(WORK_MAX_SUMMARY_LENGTH)),
    fields: Type.Array(
      Type.Object(
        {
          id: NonEmptyString(WORK_MAX_ID_LENGTH),
          label: NonEmptyString(WORK_MAX_LABEL_LENGTH),
          type: Type.Union([
            Type.Literal("text"),
            Type.Literal("textarea"),
            Type.Literal("number"),
            Type.Literal("select"),
            Type.Literal("boolean"),
          ]),
          required: Type.Optional(Type.Boolean()),
          options: Type.Optional(
            Type.Array(WorkEventRequestFieldOptionSchema, {
              minItems: 1,
              maxItems: WORK_MAX_OPTIONS,
            }),
          ),
        },
        {
          additionalProperties: false,
        },
      ),
      {
        minItems: 1,
        maxItems: WORK_MAX_FIELDS,
      },
    ),
  },
  {
    additionalProperties: false,
  },
);

const WorkEventRequestSchema = Type.Union([
  WorkEventApprovalRequestSchema,
  WorkEventChoiceRequestSchema,
  WorkEventFormRequestSchema,
]);

const WorkEventWorkBaseSchema = Type.Object(
  {
    ...BaseWorkSchemaProperties,
    status: Type.Optional(
      Type.Union([
        Type.Literal("running"),
        Type.Literal("waiting"),
        Type.Literal("blocked"),
        Type.Literal("failed"),
        Type.Literal("completed"),
        Type.Literal("cancelled"),
      ]),
    ),
  },
  {
    additionalProperties: false,
  },
);

const WorkEventWorkUpdatedSchema = Type.Object(
  {
    ...BaseWorkSchemaProperties,
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("waiting"),
      Type.Literal("blocked"),
      Type.Literal("failed"),
      Type.Literal("completed"),
    ]),
  },
  {
    additionalProperties: false,
  },
);

const workEventMetadataSchema = WorkEventMetadataSchema(WORK_API_VERSION);
const workEventSharedSchema = WorkEventSharedSchema();

const WorkStartedEventSchema = Type.Object(
  {
    ...workEventMetadataSchema,
    kind: Type.Literal("work.started"),
    work: WorkEventWorkBaseSchema,
    ...workEventSharedSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkUpdatedEventSchema = Type.Object(
  {
    ...workEventMetadataSchema,
    kind: Type.Literal("work.updated"),
    work: WorkEventWorkUpdatedSchema,
    ...workEventSharedSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkCompletedEventSchema = Type.Object(
  {
    ...workEventMetadataSchema,
    kind: Type.Literal("work.completed"),
    work: WorkEventWorkBaseSchema,
    ...workEventSharedSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkCancelledEventSchema = Type.Object(
  {
    ...workEventMetadataSchema,
    kind: Type.Literal("work.cancelled"),
    work: WorkEventWorkBaseSchema,
    ...workEventSharedSchema,
  },
  {
    additionalProperties: false,
  },
);

const InputRequestedEventSchema = Type.Object(
  {
    ...workEventMetadataSchema,
    kind: Type.Literal("input.requested"),
    work: WorkEventWorkBaseSchema,
    interaction: WorkEventInteractionSchema,
    request: WorkEventRequestSchema,
    ...workEventSharedSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkEventSchema = Type.Union(
  [
    WorkStartedEventSchema,
    WorkUpdatedEventSchema,
    WorkCompletedEventSchema,
    WorkCancelledEventSchema,
    InputRequestedEventSchema,
  ],
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: WORK_SCHEMA_ID,
    title: "WorkEvent",
    description: "Neutral work event contract for host-agnostic agent and operator systems.",
  },
);

export const WorkEventBatchSchema = Type.Array(WorkEventSchema, {
  $id: WORK_BATCH_SCHEMA_ID,
  minItems: 1,
  maxItems: WORK_MAX_BATCH,
  title: "WorkEventBatch",
  description: "Batch of structured work events accepted by POST /work.",
});

export type WorkEvent = Static<typeof WorkEventSchema>;
export type WorkEventKind = WorkEvent["kind"];
export type WorkStatus = NonNullable<Static<typeof WorkEventWorkBaseSchema>["status"]>;
export type WorkEventRequest = Static<typeof WorkEventRequestSchema>;
export type WorkEventContextItem = Static<typeof WorkEventContextItemSchema>;
export type WorkEventBatch = Static<typeof WorkEventBatchSchema>;

type WithNormalizedMetadata<TEvent extends WorkEvent> = Omit<
  TEvent,
  "specVersion" | "id" | "source" | "type"
> & {
  specVersion: string;
  id: string;
  source: string;
  type: string;
};

export type NormalizedWorkEvent = WorkEvent extends infer TEvent
  ? TEvent extends WorkEvent
    ? WithNormalizedMetadata<TEvent>
    : never
  : never;

const workEventCompiler = TypeCompiler.Compile(WorkEventSchema);
const workEventBatchCompiler = TypeCompiler.Compile(WorkEventBatchSchema);

export function isSupportedWorkSpecVersion(value: string): boolean {
  return /^1\.\d+$/.test(value);
}

export function buildWorkEventType(kind: WorkEventKind): string {
  return `io.agent.${kind}.v1`;
}

export function validateWorkEventShape(value: unknown): string[] {
  if (workEventCompiler.Check(value)) {
    return [];
  }
  return [...workEventCompiler.Errors(value)].map(formatCompilerError);
}

export function validateWorkEventBatchShape(value: unknown): string[] {
  if (workEventBatchCompiler.Check(value)) {
    return [];
  }
  return [...workEventBatchCompiler.Errors(value)].map(formatCompilerError);
}

export function workEventSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkEventSchema)) as Record<string, unknown>;
}

export function workEventBatchSchemaDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(WorkEventBatchSchema)) as Record<string, unknown>;
}

function formatCompilerError(error: { path: string; message: string }): string {
  const path = error.path === "" ? "$" : error.path;
  return `${path}: ${error.message}`;
}
