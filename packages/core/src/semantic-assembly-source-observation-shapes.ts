export function looksLikeAssemblySourceObservation(value: string): boolean {
  const text = value.trim();
  if (text.length === 0 || looksLikeRejectedAssemblyContainer(text)) {
    return false;
  }

  const spans = readAssemblySpans(text);
  const numberedSpans = spans.filter((span) => span.lineNumber !== undefined);
  if (numberedSpans.length > 0) {
    return (
      numberedSpans.length >= 3 &&
      hasStrictlyIncreasingLineNumbers(numberedSpans) &&
      hasNumberedAssemblyEvidence(numberedSpans)
    );
  }

  return hasPlainAssemblyEvidence(spans);
}

export function looksLikeAssemblySourceStatement(value: string): boolean {
  const body = value.trim();
  const instruction = readAssemblyInstructionMnemonic(body);
  return isAssemblyDirective(body) || instruction?.hasOperandEvidence === true;
}

type AssemblySpan = { body: string; lineNumber?: number };

function readAssemblySpans(text: string): AssemblySpan[] {
  const spans: AssemblySpan[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const body = stripOptionalLineNumber(rawLine).trim();
    if (body.length === 0 || isAssemblyComment(body)) {
      continue;
    }
    const lineNumber = readLineNumber(rawLine);
    spans.push({ body, ...(lineNumber !== undefined ? { lineNumber } : {}) });
  }
  return spans;
}

function hasNumberedAssemblyEvidence(spans: AssemblySpan[]): boolean {
  const summary = summarizeAssembly(spans);
  return summary.statements >= 3 && summary.instructions >= 1 && summary.operandInstructions >= 1;
}

function hasPlainAssemblyEvidence(spans: AssemblySpan[]): boolean {
  const summary = summarizeAssembly(spans);
  return (
    summary.statements >= 4 &&
    summary.instructions >= 1 &&
    ((summary.labels + summary.directives >= 1 && summary.operandInstructions >= 1) ||
      (summary.instructions >= 4 &&
        summary.distinctMnemonics >= 2 &&
        summary.operandInstructions >= 4))
  );
}

function summarizeAssembly(spans: AssemblySpan[]): AssemblySummary {
  const mnemonics = new Set<string>();
  let labels = 0;
  let directives = 0;
  let instructions = 0;
  let operandInstructions = 0;

  for (const span of spans) {
    const instruction = readAssemblyInstructionMnemonic(span.body);
    labels += isAssemblyLabel(span.body) ? 1 : 0;
    directives += isAssemblyDirective(span.body) ? 1 : 0;
    instructions += instruction !== null ? 1 : 0;
    operandInstructions += instruction?.hasOperandEvidence === true ? 1 : 0;
    if (instruction !== null) {
      mnemonics.add(instruction.mnemonic);
    }
  }

  return {
    labels,
    directives,
    instructions,
    operandInstructions,
    distinctMnemonics: mnemonics.size,
    statements: labels + directives + instructions,
  };
}

type AssemblySummary = {
  labels: number;
  directives: number;
  instructions: number;
  operandInstructions: number;
  distinctMnemonics: number;
  statements: number;
};

function readAssemblyInstructionMnemonic(
  line: string,
): { mnemonic: string; hasOperandEvidence: boolean } | null {
  const match = /^([a-z][a-z0-9_.]*)(?:\s+(.+))?$/i.exec(line.trim());
  const mnemonic = match?.[1]?.toLowerCase();
  const operands = match?.[2] ?? "";
  if (mnemonic === undefined || !ALLOWED_ASSEMBLY_MNEMONIC_PATTERN.test(mnemonic)) {
    return null;
  }

  return {
    mnemonic,
    hasOperandEvidence:
      operands.length > 0 && ASSEMBLY_OPERAND_EVIDENCE_PATTERN.test(stripAssemblyComment(operands)),
  };
}

function looksLikeRejectedAssemblyContainer(text: string): boolean {
  return (
    /^\s*(?:\{|\[|")/.test(text) ||
    containsKernelTimestampLine(text) ||
    /(?:^|[\r\n])\s*(?:make(?:\[\d+])?:|CMake (?:Error|Warning)\b|\[\s*\d+%]\s+\S|(?:error|fatal|warning):\b|Traceback\b|[$#>]\s+\S)/i.test(
      text,
    )
  );
}

function containsKernelTimestampLine(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:\d{1,6}:\s*)?\[\s*\d+(?:\.\d+)?]\s+\S/.test(text);
}

function stripOptionalLineNumber(line: string): string {
  return line.replace(/^\s*\d{1,6}(?:[ \t]+|:\s*)/, "");
}

function readLineNumber(line: string): number | undefined {
  const match = /^\s*(\d{1,6})(?:[ \t]+|:\s*)/.exec(line);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function hasStrictlyIncreasingLineNumbers(spans: AssemblySpan[]): boolean {
  return spans.every(
    (span, index) => index === 0 || (span.lineNumber ?? 0) > (spans[index - 1]?.lineNumber ?? 0),
  );
}

function isAssemblyComment(line: string): boolean {
  return /^\s*(?:\/\/|#|;)(?:\s|$)/.test(line);
}

function isAssemblyLabel(line: string): boolean {
  return (
    !/^(?:error|fatal|warning):$/i.test(line.trim()) &&
    /^\.?[a-z_.$][\w.$]*:\s*$/i.test(line.trim())
  );
}

function isAssemblyDirective(line: string): boolean {
  return ALLOWED_ASSEMBLY_DIRECTIVE_PATTERN.test(line.trim());
}

function stripAssemblyComment(value: string): string {
  return value.replace(/\s*(?:(?:\/\/|#|;).*)$/, "");
}

const ALLOWED_ASSEMBLY_DIRECTIVE_PATTERN =
  /^\.(?:if|ifdef|ifndef|elseif|else|endif|set|equ|macro|endm|section|text|data|bss|globl|global|type|size|align|p2align|long|word|byte|quad|file|loc|cfi_[a-z_]+)\b/i;

const ALLOWED_ASSEMBLY_MNEMONIC_PATTERN =
  /^(?:(?:s|v)_[a-z0-9_]+|(?:flat|buffer|global|ds|scratch|image|tbuffer)_[a-z0-9_]+|(?:mov|add|sub|mul|imul|div|idiv|cmp|jmp|call|ret|push|pop|ldr|str|ldp|stp|adr|lea|xor|and|or|test|inc|dec|nop)[a-z0-9_.]*)$/i;

const ASSEMBLY_OPERAND_EVIDENCE_PATTERN =
  /(?:0x[0-9a-f]+|\b\d+\b|[,\[\]()\\]|%[a-z0-9]+|\b(?:r\d+|x\d+|w\d+|v\d+|s\d+|ttmp\d+|exec(?:_lo|_hi)?|m0|sp|fp|lr|pc|eax|ebx|ecx|edx|rax|rbx|rcx|rdx|esi|edi|rsi|rdi|rbp|rsp|al|ah|bl|bh|cl|ch|dl|dh)\b|\.[a-z_.$][\w.$]*)/i;
