import type { AttentionResponse, HumanInputRequest } from "@tomismeta/aperture-core";

import type { JsonValue } from "./generated/app-server/serde_json/JsonValue.js";
import type {
  CodexMcpServerElicitationRequestParams,
  CodexMcpElicitationPrimitiveSchema,
} from "./protocol.js";

type HumanInputFormField = Extract<HumanInputRequest, { kind: "form" }>["fields"][number];
type EnumOption = { value: string; label: string };

export function buildCodexElicitationRequest(
  params: CodexMcpServerElicitationRequestParams,
): HumanInputRequest {
  if (params.mode === "url") {
    return {
      kind: "approval",
    };
  }

  const schema = params.requestedSchema;
  const singleMultiSelect = singleMultiSelectEnumField(schema);
  if (singleMultiSelect) {
    return {
      kind: "choice",
      selectionMode: "multiple",
      options: singleMultiSelect.options.map((option) => ({
        id: elicitationChoiceOptionId(singleMultiSelect.fieldId, option.value),
        label: option.label,
        ...(option.label !== option.value ? { summary: option.value } : {}),
      })),
    };
  }

  const singleEnum = singleEnumField(schema);
  if (singleEnum) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: singleEnum.options.map((option) => ({
        id: elicitationChoiceOptionId(singleEnum.fieldId, option.value),
        label: option.label,
        ...(option.label !== option.value ? { summary: option.value } : {}),
      })),
    };
  }

  const singleBoolean = singleBooleanField(schema);
  if (singleBoolean) {
    return {
      kind: "choice",
      selectionMode: "single",
      options: [
        {
          id: elicitationChoiceOptionId(singleBoolean.fieldId, "true"),
          label: "Yes",
        },
        {
          id: elicitationChoiceOptionId(singleBoolean.fieldId, "false"),
          label: "No",
        },
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

export function codexElicitationSummary(
  params: CodexMcpServerElicitationRequestParams,
  request: HumanInputRequest,
): string {
  if (params.mode === "url" && request.kind === "approval") {
    return `Open ${params.url} to continue.`;
  }

  return `Input requested by MCP server ${params.serverName}.`;
}

export function mapCodexElicitationAcceptedContent(
  response: AttentionResponse,
  params: CodexMcpServerElicitationRequestParams,
): JsonValue | null {
  if (params.mode !== "form") {
    return null;
  }

  if (response.response.kind === "form_submitted") {
    return formValuesToContent(response.response.values, params);
  }

  if (response.response.kind === "text_submitted") {
    const fieldId = singleTextFieldId(params.requestedSchema);
    return fieldId ? { [fieldId]: response.response.text } : null;
  }

  if (response.response.kind === "option_selected") {
    return optionIdsToContent(response.response.optionIds, params);
  }

  return null;
}

function optionIdsToContent(
  optionIds: string[],
  params: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>,
): JsonValue | null {
  const schema = params.requestedSchema;
  const multiSelect = singleMultiSelectEnumField(schema);
  if (multiSelect) {
    return {
      [multiSelect.fieldId]: optionIds
        .map((optionId) => parseChoiceOptionId(optionId))
        .flatMap((entry) => (entry?.fieldId === multiSelect.fieldId ? [entry.value] : [])),
    };
  }

  const singleEnum = singleEnumField(schema);
  if (singleEnum) {
    const selected = optionIds
      .map((optionId) => parseChoiceOptionId(optionId))
      .find((entry) => entry?.fieldId === singleEnum.fieldId);
    return selected ? { [singleEnum.fieldId]: selected.value } : null;
  }

  const singleBoolean = singleBooleanField(schema);
  if (singleBoolean) {
    const selected = optionIds
      .map((optionId) => parseChoiceOptionId(optionId))
      .find((entry) => entry?.fieldId === singleBoolean.fieldId);
    if (!selected) {
      return null;
    }
    return {
      [singleBoolean.fieldId]: selected.value === "true",
    };
  }

  return null;
}

function formValuesToContent(
  values: Record<string, unknown>,
  params: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>,
): JsonValue | null {
  const content: Record<string, JsonValue> = {};
  for (const [fieldId, definition] of Object.entries(schemaProperties(params.requestedSchema))) {
    const fieldValue = valueForSchemaField(fieldId, definition, values);
    if (fieldValue !== undefined) {
      content[fieldId] = fieldValue;
    }
  }
  return content;
}

function valueForSchemaField(
  fieldId: string,
  definition: CodexMcpElicitationPrimitiveSchema,
  values: Record<string, unknown>,
): JsonValue | undefined {
  if (isMultiSelectSchema(definition)) {
    const selectedValues = enumOptionsForSchema(definition).flatMap((option, optionIndex) =>
      values[multiSelectBooleanFieldId(fieldId, optionIndex)] === true ? [option.value] : [],
    );
    return selectedValues;
  }

  const value = values[fieldId];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
        ? [entry]
        : [],
    );
  }
  return JSON.stringify(value);
}

function schemaToFormFields(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): HumanInputFormField[] {
  const required = new Set((schema.required ?? []).filter((value): value is string => typeof value === "string"));
  return Object.entries(schemaProperties(schema)).flatMap(([fieldId, definition]) => {
    if (isMultiSelectSchema(definition)) {
      return enumOptionsForSchema(definition).map((option, optionIndex) => ({
        id: multiSelectBooleanFieldId(fieldId, optionIndex),
        label: `${fieldLabel(fieldId, definition)}: ${option.label}`,
        type: "boolean" as const,
      }));
    }

    const field = definitionToFormField(fieldId, definition, required.has(fieldId));
    return field ? [field] : [];
  });
}

function definitionToFormField(
  fieldId: string,
  definition: CodexMcpElicitationPrimitiveSchema,
  required: boolean,
): HumanInputFormField | null {
  const label = fieldLabel(fieldId, definition);
  const enumOptions = definition.type === "string" ? enumOptionsForSchema(definition) : [];

  if (definition.type === "string" && enumOptions.length > 0) {
    return {
      id: fieldId,
      label,
      type: "select",
      required,
      options: enumOptions.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    };
  }

  switch (definition.type) {
    case "string":
      return {
        id: fieldId,
        label,
        type: "text",
        required,
      };
    case "number":
    case "integer":
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

function schemaProperties(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): Record<string, CodexMcpElicitationPrimitiveSchema> {
  return Object.fromEntries(
    Object.entries(schema.properties ?? {}).flatMap(([key, value]) =>
      isPrimitiveSchema(value) ? [[key, value]] : [],
    ),
  );
}

function singleTextFieldId(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): string | undefined {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return undefined;
  }
  const [fieldId, definition] = properties[0]!;
  return definition.type === "string" && enumOptionsForSchema(definition).length === 0 ? fieldId : undefined;
}

function singleBooleanField(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): { fieldId: string } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  return definition.type === "boolean" ? { fieldId } : null;
}

function singleEnumField(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): { fieldId: string; options: EnumOption[] } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  return definition.type === "string" && enumOptionsForSchema(definition).length > 0
    ? { fieldId, options: enumOptionsForSchema(definition) }
    : null;
}

function singleMultiSelectEnumField(
  schema: Extract<CodexMcpServerElicitationRequestParams, { mode: "form" }>["requestedSchema"],
): { fieldId: string; options: EnumOption[] } | null {
  const properties = Object.entries(schemaProperties(schema));
  if (properties.length !== 1) {
    return null;
  }
  const [fieldId, definition] = properties[0]!;
  return isMultiSelectSchema(definition)
    ? { fieldId, options: enumOptionsForSchema(definition) }
    : null;
}

function fieldLabel(fieldId: string, definition: CodexMcpElicitationPrimitiveSchema): string {
  return readNonEmptyString(definition.title) ?? humanizeFieldId(fieldId);
}

function enumOptionsForSchema(definition: CodexMcpElicitationPrimitiveSchema): EnumOption[] {
  if (isMultiSelectSchema(definition)) {
    if ("anyOf" in definition.items && Array.isArray(definition.items.anyOf)) {
      return definition.items.anyOf.flatMap((entry) => isConstOption(entry)
        ? [{ value: entry.const, label: entry.title || entry.const }]
        : []);
    }
    if ("enum" in definition.items && Array.isArray(definition.items.enum)) {
      return definition.items.enum
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((value) => ({ value, label: value }));
    }
    return [];
  }

  if ("oneOf" in definition && Array.isArray(definition.oneOf)) {
    return definition.oneOf.flatMap((entry) => isConstOption(entry)
      ? [{ value: entry.const, label: entry.title || entry.const }]
      : []);
  }

  if ("enum" in definition && Array.isArray(definition.enum)) {
    const values = definition.enum.filter((value): value is string => typeof value === "string" && value.length > 0);
    const enumNames = "enumNames" in definition ? definition.enumNames : undefined;
    const names = Array.isArray(enumNames)
      ? enumNames.filter((value: unknown): value is string => typeof value === "string")
      : [];
    return values.map((value, index) => ({
      value,
      label: names[index] || value,
    }));
  }

  return [];
}

function elicitationChoiceOptionId(fieldId: string, value: string): string {
  return `${encodeURIComponent(fieldId)}=${encodeURIComponent(value)}`;
}

function parseChoiceOptionId(optionId: string): { fieldId: string; value: string } | null {
  const separator = optionId.indexOf("=");
  if (separator <= 0) {
    return null;
  }
  return {
    fieldId: decodeURIComponent(optionId.slice(0, separator)),
    value: decodeURIComponent(optionId.slice(separator + 1)),
  };
}

function multiSelectBooleanFieldId(fieldId: string, optionIndex: number): string {
  return `${fieldId}:option:${optionIndex}`;
}

function isPrimitiveSchema(value: unknown): value is CodexMcpElicitationPrimitiveSchema {
  return isRecord(value) && typeof value.type === "string";
}

function isMultiSelectSchema(
  definition: CodexMcpElicitationPrimitiveSchema,
): definition is Extract<CodexMcpElicitationPrimitiveSchema, { type: "array" }> {
  return definition.type === "array" && isRecord(definition.items);
}

function isConstOption(value: unknown): value is { const: string; title: string } {
  return isRecord(value) && typeof value.const === "string" && typeof value.title === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function humanizeFieldId(fieldId: string): string {
  return fieldId
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
