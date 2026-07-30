export function looksLikeBareDiagnosticObservationBody(body: string): boolean {
  return /^\s*(?:error|syntaxerror|typeerror|runtimeerror|valueerror|assertionerror):\s+\S/i.test(
    body,
  );
}
