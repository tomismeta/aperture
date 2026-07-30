export function looksLikeRuntimePanicDiagnostic(text: string): boolean {
  const panicPayloads = [
    ...text.matchAll(/(?:^|[\r\n])[^\S\r\n]*panic:([^\r\n]+)/gi),
    ...text.matchAll(/(?:^|[\r\n])[^\S\r\n]*failed to execute:\s+[^\r\n]*;\s*panic:([^\r\n]+)/gi),
  ];

  return panicPayloads.some((match) => looksLikeRuntimePanicPayload(match[1] ?? ""));
}

function looksLikeRuntimePanicPayload(value: string): boolean {
  const payload = value.trim();
  return payload.length > 0 && !looksLikeSourceStatementPanicPayload(payload);
}

function looksLikeSourceStatementPanicPayload(payload: string): boolean {
  return (
    /^(?:return|goto|break|continue|if|for|while|switch)\b/i.test(payload) ||
    /^[a-z_][a-z0-9_.]*\s*(?::=|[-+*/%]?=)\s*\S/i.test(payload) ||
    /^[a-z_][a-z0-9_]*\s*\([^)]*\)\s*;?\s*$/i.test(payload) ||
    /;\s*$/.test(payload)
  );
}
