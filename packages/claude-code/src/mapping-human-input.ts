import type {
  HumanInputRequest,
} from "@tomismeta/aperture-core";

import type {
  ClaudeCodeElicitationEvent,
  ClaudeCodePreToolUseEvent,
} from "./mapping.js";

type HumanInputFormField = Extract<HumanInputRequest, { kind: "form" }>["fields"][number];

export function elicitationSummary(
  event: ClaudeCodeElicitationEvent,
  request: HumanInputRequest,
): string {
  if (request.kind === "approval" && event.url) {
    return `Open ${event.url} to continue.`;
  }

  return `Input requested by ${event.mcp_server_name}.`;
}

export function buildElicitationRequest(event: ClaudeCodeElicitationEvent): HumanInputRequest {
  if (event.mode === "url") {
    return {
      kind: "approval",
    };
  }

  const schema = event.requested_schema;
  const singleEnum = singleEnumField(schema);
  if (singleEnum) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: singleEnum.values.map((value) => ({
        id: elicitationChoiceOptionId(singleEnum.fieldId, value),
        label: value,
      })),
    };
  }

  const singleBoolean = singleBooleanField(schema);
  if (singleBoolean) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: elicitationChoiceOptionId(singleBoolean.fieldId, "true"), label: "Yes" },
        { id: elicitationChoiceOptionId(singleBoolean.fieldId, "false"), label: "No" },
      ],
    };
  }

  const textFieldId = singleTextFieldId(schema);
  if (textFieldId) {
    return {
      kind: "choice",
      selectionMode: "single",
      allowTextResponse: true,
      options: [],
    };
  }

  const fields = schemaToFormFields(schema);
  if (fields.length > 0) {
    return {
      kind: "form",
      fields,
    };
  }

  return {
    kind: "choice",
    selectionMode: "single",
    allowTextResponse: true,
    options: [],
  };
}

export function buildAskUserQuestionRequest(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
): HumanInputRequest {
  if (questions.length <= 1) {
    const question = questions[0];
    if (!question) {
      return {
        kind: "choice",
        selectionMode: "single",
        allowTextResponse: true,
        options: [],
      };
    }

    if (question.options.length === 0) {
      return {
        kind: "choice",
        selectionMode: question.multiSelect ? "multiple" : "single",
        allowTextResponse: true,
        options: [],
      };
    }

    return {
      kind: "choice",
      selectionMode: question.multiSelect ? "multiple" : "single",
      options: question.options.map((option, optionIndex) => ({
        id: askUserQuestionOptionId(0, optionIndex, option.label),
        label: option.label,
        ...(option.description ? { summary: option.description } : {}),
      })),
    };
  }

  return {
    kind: "form",
    fields: questions.flatMap((question, index): HumanInputFormField[] => {
      if (question.options.length > 0 && !question.multiSelect) {
        return [{
          id: askUserQuestionFieldId(index),
          label: question.question,
          type: "select" as const,
          required: true,
          options: question.options.map((option) => ({
            value: option.label,
            label: option.label,
          })),
        }];
      }

      if (question.options.length > 0 && question.multiSelect) {
        return question.options.map((option, optionIndex) => ({
          id: askUserQuestionBooleanFieldId(index, optionIndex),
          label: `${question.question}: ${option.label}`,
          type: "boolean" as const,
        }));
      }

      return [{
        id: askUserQuestionFieldId(index),
        label: question.question,
        type: "text" as const,
        required: true,
      }];
    }),
  };
}

export function singleTextFieldId(schema: Record<string, unknown> | undefined): string | undefined {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return undefined;
  }
  const [fieldId, definition] = properties[0]!;
  return fieldType(definition) === "string" && !readStringArray(definition.enum)
    ? fieldId
    : undefined;
}

function schemaToFormFields(schema: Record<string, unknown> | undefined): HumanInputFormField[] {
  const properties = schemaProperties(schema);
  const required = schemaRequiredFields(schema);
  return Object.entries(properties).flatMap(([fieldId, definition]) => {
    const field = definitionToFormField(fieldId, definition, required.has(fieldId));
    return field ? [field] : [];
  });
}

function definitionToFormField(
  fieldId: string,
  definition: Record<string, unknown>,
  required: boolean,
): HumanInputFormField | null {
  const label = readString(definition.title) ?? humanizeFieldId(fieldId);
  const type = fieldType(definition);

  switch (type) {
    case "string": {
      const enumValues = readStringArray(definition.enum);
      if (enumValues) {
        return {
          id: fieldId,
          label,
          type: "select",
          required,
          options: enumValues.map((value) => ({ value, label: value })),
        };
      }
      return {
        id: fieldId,
        label,
        type: "text",
        required,
      };
    }
    case "integer":
    case "number":
      return {
        id: fieldId,
        label,
        type: "number",
        required,
      };
    case "boolean":
      return {
        id: fieldId,
        label,
        type: "boolean",
        required,
      };
    default:
      return null;
  }
}

function schemaProperties(schema: Record<string, unknown> | undefined): Record<string, Record<string, unknown>> {
  if (!schema || typeof schema !== "object") {
    return {};
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [[key, value as Record<string, unknown>]];
      }
      return [];
    }),
  );
}

function schemaRequiredFields(schema: Record<string, unknown> | undefined): Set<string> {
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  return new Set(required);
}

function singleEnumField(
  schema: Record<string, unknown> | undefined,
): { fieldId: string; values: string[] } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  const values = readStringArray(definition.enum);
  if (!values || fieldType(definition) !== "string") {
    return null;
  }
  return { fieldId, values };
}

function singleBooleanField(
  schema: Record<string, unknown> | undefined,
): { fieldId: string } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  return fieldType(definition) === "boolean" ? { fieldId } : null;
}

function fieldType(definition: Record<string, unknown>): string | undefined {
  return readString(definition.type);
}

function elicitationChoiceOptionId(fieldId: string, value: string): string {
  return `${encodeURIComponent(fieldId)}=${encodeURIComponent(value)}`;
}

function askUserQuestionOptionId(questionIndex: number, optionIndex: number, label: string): string {
  return `q${questionIndex}:o${optionIndex}:${encodeURIComponent(label)}`;
}

function askUserQuestionFieldId(questionIndex: number): string {
  return `q${questionIndex}`;
}

function askUserQuestionBooleanFieldId(questionIndex: number, optionIndex: number): string {
  return `q${questionIndex}:o${optionIndex}`;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return next.length > 0 ? next : undefined;
}

function humanizeFieldId(fieldId: string): string {
  return fieldId
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
