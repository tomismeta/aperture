import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  workEndpointDescriptionSchemaDocument,
  workEventBatchSchemaDocument,
  workEventSchemaDocument,
  workReceiptSchemaDocument,
  workResponseSchemaDocument,
} from "@aperture/runtime/internal";
import { format } from "prettier";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = resolve(repoRoot, "schemas");

const targets = [
  {
    path: resolve(schemaDir, "work-event.schema.json"),
    document: workEventSchemaDocument(),
    printWidth: undefined,
  },
  {
    path: resolve(schemaDir, "work-event-batch.schema.json"),
    document: workEventBatchSchemaDocument(),
    printWidth: undefined,
  },
  {
    path: resolve(repoRoot, "packages", "aperture", "src", "work-event.schema.json"),
    document: workEventSchemaDocument(),
    printWidth: undefined,
  },
  {
    path: resolve(repoRoot, "packages", "aperture", "src", "work-event-batch.schema.json"),
    document: workEventBatchSchemaDocument(),
    printWidth: undefined,
  },
  {
    path: resolve(schemaDir, "work-receipt.schema.json"),
    document: workReceiptSchemaDocument(),
    printWidth: 100,
  },
  {
    path: resolve(schemaDir, "work-response.schema.json"),
    document: workResponseSchemaDocument(),
    printWidth: 100,
  },
  {
    path: resolve(schemaDir, "work-endpoint-description.schema.json"),
    document: workEndpointDescriptionSchemaDocument(),
    printWidth: 100,
  },
] as const;

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  await mkdir(schemaDir, { recursive: true });

  const mismatches: string[] = [];

  for (const target of targets) {
    const expected = await formatJson(target.document, target.printWidth);
    const current = await readCurrentFile(target.path);

    if (checkOnly) {
      if (current !== expected) {
        mismatches.push(target.path);
      }
      continue;
    }

    if (current !== expected) {
      await writeFile(target.path, expected, "utf8");
    }
  }

  const generatedPath = resolve(
    repoRoot,
    "packages",
    "aperture",
    "src",
    "work-contract.generated.ts",
  );
  const generated = await formatWorkTypes({
    workEvent: workEventSchemaDocument(),
    workEventBatch: workEventBatchSchemaDocument(),
    workReceipt: workReceiptSchemaDocument(),
    workResponse: workResponseSchemaDocument(),
    workEndpointDescription: workEndpointDescriptionSchemaDocument(),
  });
  const currentGenerated = await readCurrentFile(generatedPath);
  if (checkOnly) {
    if (currentGenerated !== generated) {
      mismatches.push(generatedPath);
    }
  } else if (currentGenerated !== generated) {
    await writeFile(generatedPath, generated, "utf8");
  }

  if (mismatches.length > 0) {
    const message = [
      "Generated work contract artifacts are out of date.",
      "Run `pnpm contract:generate` and commit the updated schema files:",
      ...mismatches.map((path) => `- ${path}`),
    ].join("\n");
    throw new Error(message);
  }
}

async function formatJson(document: unknown, printWidth?: number): Promise<string> {
  return format(JSON.stringify(document), {
    parser: "json",
    ...(printWidth === undefined ? {} : { printWidth }),
  });
}

type JsonSchema = {
  $id?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  patternProperties?: Record<string, JsonSchema>;
};

async function formatWorkTypes(input: {
  workEvent: Record<string, unknown>;
  workEventBatch: Record<string, unknown>;
  workReceipt: Record<string, unknown>;
  workResponse: Record<string, unknown>;
  workEndpointDescription: Record<string, unknown>;
}): Promise<string> {
  const workEvent = input.workEvent as JsonSchema;
  const workEventBatch = input.workEventBatch as JsonSchema;
  const workReceipt = input.workReceipt as JsonSchema;
  const workResponse = input.workResponse as JsonSchema;
  const workEndpointDescription = input.workEndpointDescription as JsonSchema;
  const inputRequested = workEvent.anyOf?.find(
    (candidate) => candidate.properties?.kind?.const === "input.requested",
  );
  const requestSchema = inputRequested?.properties?.request ?? {};
  const contextItemSchema = findContextItemSchema(workEvent) ?? {};
  const statusValues = collectPropertyConstants(workEvent, "status");
  const requestKindValues = collectPropertyConstants(requestSchema, "kind");
  const responseStateSchema = { enum: collectPropertyConstants(workResponse, "state") };
  const receiptModeSchema = workReceipt.properties?.receivedAs ?? {};
  const answeredResponseSchema =
    findUnionBranch(workResponse, "state", "answered")?.properties?.response ?? {};

  const source = `// Generated by scripts/generate-work-contract.ts from Runtime-owned schemas.\n// Do not edit this file directly.\n\nexport const WORK_API_VERSION = ${JSON.stringify(readStringProperty(workEvent, "$id")?.split(":").at(-1) ?? "1.0")} as const;\nexport const WORK_SCHEMA_ID = ${JSON.stringify(readStringProperty(workEvent, "$id") ?? "urn:aperture:work-event:1.0")} as const;\nexport const WORK_BATCH_SCHEMA_ID = ${JSON.stringify(readStringProperty(workEventBatch, "$id") ?? "urn:aperture:work-event-batch:1.0")} as const;\nexport const WORK_SCHEMA_URL = "https://raw.githubusercontent.com/tomismeta/aperture/aperture-v0.5.0/schemas/work-event.schema.json";\n\nexport type WorkEvent = ${schemaToType(workEvent)};\nexport type WorkEventBatch = WorkEvent[];\nexport type WorkEventKind = WorkEvent["kind"];\nexport type WorkStatus = ${unionOfStrings(statusValues)};\nexport type WorkRequestKind = ${unionOfStrings(requestKindValues)};\nexport type WorkEventContextItem = ${schemaToType(contextItemSchema)};\nexport type WorkEventRequest = ${schemaToType(requestSchema)};\n\nexport type WorkReceipt = ${schemaToType(workReceipt)};\nexport type WorkReceiptItem = WorkReceipt["published"][number];\nexport type WorkReceiptMode = ${schemaToType(receiptModeSchema)};\nexport type WorkReceiptNextStep = NonNullable<WorkReceipt["next"]>[number];\nexport type WorkResponseAnswer = ${schemaToType(answeredResponseSchema)};\nexport type WorkResponse = ${schemaToType(workResponse)};\nexport type WorkResponseState = ${schemaToType(responseStateSchema)};\nexport type WorkEndpointDescription = ${schemaToType(workEndpointDescription)};\n`;

  return format(source, {
    parser: "typescript",
    printWidth: 100,
    trailingComma: "all",
    semi: true,
    singleQuote: false,
  });
}

function schemaToType(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum)
    return unionOfStrings(
      schema.enum.filter((value): value is string => typeof value === "string"),
    );
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) return alternatives.map(schemaToType).join(" | ");
  if (schema.allOf) return schema.allOf.map(schemaToType).join(" & ");
  if (Array.isArray(schema.type))
    return schema.type.map((type) => schemaToType({ type })).join(" | ");
  switch (schema.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `Array<${schema.items ? schemaToType(schema.items) : "unknown"}>`;
    case "object": {
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(properties).map(([key, value]) => {
        const optional = required.has(key) ? "" : "?";
        return `${JSON.stringify(key)}${optional}: ${schemaToType(value)};`;
      });
      if (fields.length > 0) return `{ ${fields.join(" ")} }`;
      if (schema.patternProperties) {
        const values = Object.values(schema.patternProperties);
        return `Record<string, ${values.length === 1 ? schemaToType(values[0] as JsonSchema) : "unknown"}>`;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Record<string, ${schemaToType(schema.additionalProperties)}>`;
      }
      return "Record<string, unknown>";
    }
    default:
      return "unknown";
  }
}

function collectPropertyConstants(schema: JsonSchema, propertyName: string): string[] {
  const values: string[] = [];
  const visit = (candidate: JsonSchema): void => {
    const property = candidate.properties?.[propertyName];
    if (property) collectConstants(property, values);
    for (const child of [
      ...(candidate.anyOf ?? []),
      ...(candidate.oneOf ?? []),
      ...(candidate.allOf ?? []),
    ]) {
      visit(child);
    }
    for (const child of Object.values(candidate.properties ?? {})) visit(child);
    if (candidate.items) visit(candidate.items);
  };
  visit(schema);
  return [...new Set(values)];
}

function findUnionBranch(
  schema: JsonSchema,
  propertyName: string,
  value: string,
): JsonSchema | null {
  for (const candidate of schema.anyOf ?? schema.oneOf ?? []) {
    if (candidate.properties?.[propertyName]?.const === value) return candidate;
  }
  return null;
}

function collectConstants(schema: JsonSchema, values: string[]): void {
  if (typeof schema.const === "string") values.push(schema.const);
  for (const child of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    collectConstants(child, values);
  }
}

function findContextItemSchema(schema: JsonSchema): JsonSchema | null {
  if (
    schema.type === "object" &&
    schema.properties?.id?.type === "string" &&
    schema.properties.value?.anyOf?.some((value) => value.type === "string")
  ) {
    return schema;
  }
  for (const child of [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
    ...Object.values(schema.properties ?? {}),
  ]) {
    const match = findContextItemSchema(child);
    if (match) return match;
  }
  return schema.items ? findContextItemSchema(schema.items) : null;
}

function unionOfStrings(values: string[]): string {
  return values.length > 0 ? values.map(JSON.stringify).join(" | ") : "never";
}

function readStringProperty(schema: JsonSchema, key: string): string | null {
  const value = schema[key as keyof JsonSchema];
  return typeof value === "string" ? value : null;
}

async function readCurrentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
