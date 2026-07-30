export function looksLikePythonLocationError(text: string): boolean {
  const match =
    /^File[ \t]+"[^"\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]{1,260}\.py",[ \t]+line[ \t]+\d+\b([^\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]{0,800})/i.exec(
      text.replace(/^[ \t]+/, ""),
    );
  const diagnosticBody = match?.[1] ?? "";
  return /(?:^|[ \t])\^[ \t]*(?:AssertionError|ImportError|IndentationError|ModuleNotFoundError|NameError|RuntimeError|SyntaxError|TypeError|ValueError)[ \t]*:/i.test(
    diagnosticBody,
  );
}
