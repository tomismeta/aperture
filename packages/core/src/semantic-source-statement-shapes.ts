import { readCLikeLine } from "./semantic-c-like-source-line-shapes.js";

export function looksLikeSourceStatement(body: string): boolean {
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:$|[/:]\S*)/i.test(body)) {
    return false;
  }

  return (
    looksLikeStructuralSourceStatement(body) ||
    looksLikeShellSourceStatement(body) ||
    looksLikeTypeScriptSourceStatement(body) ||
    looksLikePythonSourceStatement(body) ||
    looksLikeCStyleSourceStatement(body)
  );
}

export function looksLikeStandaloneSourcePrefix(line: string): boolean {
  return (
    looksLikeImportStatement(line) ||
    looksLikeTypeScriptDeclaration(line) ||
    looksLikePythonDeclaration(line) ||
    looksLikeStandaloneCStyleDeclaration(line)
  );
}

function looksLikeStructuralSourceStatement(body: string): boolean {
  return [
    /^#!\/(?:usr\/bin\/env\s+)?[a-z0-9_.+-]+\b/,
    /^[{}]\s*;?$/,
    /^(?:case\s+.+|default):\s*$/,
    /^#include\s*(?:<[^>]+>|"[^"]+")/,
  ].some((pattern) => pattern.test(body));
}

function looksLikeShellSourceStatement(body: string): boolean {
  return [
    /^set\s+-euo\s+pipefail\b/,
    /^(?:export\s+|readonly\s+|local\s+)?[a-z_$][a-z0-9_$]*=(?=\S)(?=.*(?:["'`$(){}]|\S+$)).+$/,
    /^[a-z_$][a-z0-9_$]*\s*\(\)\s*\{$/,
  ].some((pattern) => pattern.test(body));
}

function looksLikeTypeScriptSourceStatement(body: string): boolean {
  return (
    looksLikeTypeScriptDeclaration(body) ||
    /^(?:if|for|while|switch)\s*\(/.test(body) ||
    /^(?:break|continue)(?:\s+[a-zA-Z_$][a-zA-Z0-9_$]*)?\s*;?$/.test(body) ||
    /^return\s+\([^)]{1,100}\)\s*\S.*;?$/.test(body) ||
    /^return(?:\s+(?:[a-zA-Z_$][a-zA-Z0-9_$.]*(?:\([^)]*\))?|-?\d+(?:\.\d+)?|true|false|null|nullptr|none))?\s*;?$/.test(
      body,
    ) ||
    /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*(?:=|:=)\s*\S.*;\s*$/.test(body) ||
    /^[a-zA-Z_$][a-zA-Z0-9_$:<>]*(?:->|::)[a-zA-Z_$][a-zA-Z0-9_$:]*/.test(body) ||
    /^(?:this|[a-zA-Z_$][a-zA-Z0-9_$]*)\.[a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*\(|\s*(?:=|\+=|-=|\*=|\/=))/.test(
      body,
    )
  );
}

function looksLikeTypeScriptDeclaration(line: string): boolean {
  return (
    looksLikeVariableDeclaration(line) ||
    looksLikeFunctionDeclaration(line) ||
    looksLikeClassOrInterfaceDeclaration(line) ||
    looksLikeTypeAliasDeclaration(line) ||
    /^export\s+\{[^}\r\n]+\}\s+from\s+["'][^"'\r\n]+["']\s*;?$/.test(line)
  );
}

function looksLikeVariableDeclaration(line: string): boolean {
  const match =
    /^(?:export\s+)?(?:const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*(\S[\s\S]*)$/u.exec(line);
  return match !== null && looksLikeAssignmentRightHandSide(match[1] ?? "");
}

function looksLikeAssignmentRightHandSide(value: string): boolean {
  const rhs = value.replace(/;\s*$/, "").trim();
  if (rhs.length === 0) {
    return false;
  }
  if (/^(?:["'`{[(]|\d|true\b|false\b|null\b|undefined\b|new\s+[A-Z_$])/.test(rhs)) {
    return true;
  }
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*(?:\([^)]*\))?$/.test(rhs)) {
    return true;
  }

  return /(?:=>|::|->|[.[\]{}(),?:+\-*/%]|&&|\|\||[!<>=]=?)/.test(rhs);
}

function looksLikeFunctionDeclaration(line: string): boolean {
  const match =
    /^(?:(?:export\s+(?:default\s+)?(?:async\s+)?)|(?:async\s+))?function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(([^)]*)\)\s*(?::\s*[^;{\r\n]+)?\s*(?:;|\{[^\r\n]*)\s*$/.exec(
      line,
    );
  return match !== null && looksLikeParameterList(match[1] ?? "");
}

function looksLikeClassOrInterfaceDeclaration(line: string): boolean {
  return /^(?:export\s+)?(?:class|interface)\s+[a-zA-Z_$][a-zA-Z0-9_$]*(?:<[^>\r\n]+>)?(?:\s+(?:extends|implements)\b[^{\r\n]*)?\s*\{/.test(
    line,
  );
}

function looksLikeTypeAliasDeclaration(line: string): boolean {
  return /^(?:export\s+)?type\s+[a-zA-Z_$][a-zA-Z0-9_$]*(?:<[^>\r\n]+>)?\s*=/.test(line);
}

function looksLikePythonSourceStatement(body: string): boolean {
  return looksLikeImportStatement(body) || looksLikePythonDeclaration(body);
}

function looksLikeImportStatement(line: string): boolean {
  return looksLikePythonImportStatement(line) || looksLikeJavaScriptImportStatement(line);
}

function looksLikePythonImportStatement(line: string): boolean {
  return [
    /^from\s+(?:\.{1,3}[a-zA-Z_][a-zA-Z0-9_.]*|\.{1,3}|[a-zA-Z_][a-zA-Z0-9_.]*)\s+import\s+(?:\*|[a-zA-Z_][a-zA-Z0-9_]*(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)$/,
    /^import\s+[a-zA-Z_][a-zA-Z0-9_.]*(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_.]*(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*$/,
  ].some((pattern) => pattern.test(line));
}

function looksLikeJavaScriptImportStatement(line: string): boolean {
  return [
    /^import\s+["'][^"'\r\n]+["']\s*;?$/,
    /^import\s+(?:type\s+)?(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*,\s*)?(?:\{[^}\r\n]+\}|\*\s+as\s+[a-zA-Z_$][a-zA-Z0-9_$]*|[a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+["'][^"'\r\n]+["']\s*;?$/,
  ].some((pattern) => pattern.test(line));
}

function looksLikePythonDeclaration(line: string): boolean {
  const match =
    /^(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(([^)]*)\)\s*(?:->\s*[^:\r\n]+)?\s*:\s*$/.exec(
      line,
    );
  return (
    (match !== null && looksLikeParameterList(match[1] ?? "")) ||
    /^class\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?:\s*$/.test(line)
  );
}

function looksLikeParameterList(value: string): boolean {
  const parameters = value.trim();
  if (parameters.length === 0) {
    return true;
  }
  if (/^(?:this|self|cls)$/.test(parameters)) {
    return true;
  }
  if (/[,:=*[\]{}]|(?:^|\s)(?:readonly|public|private|protected)\s+/.test(parameters)) {
    return true;
  }
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*,\s*[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(parameters)) {
    return true;
  }

  return false;
}

function looksLikeCStyleSourceStatement(body: string): boolean {
  return [
    /^(?=.*(?:\b[a-z_$][a-z0-9_$:<>]*_t\b|::|[<&*]|\b(?:static|inline|extern|const|virtual|void|int|char|bool|auto|struct|enum)\b))(?:[a-z_$][a-z0-9_$:<>*&,]*\s+)+[*&\s]*[~a-z_$][a-z0-9_$:<>]*\s*\([^)]*\)\s*(?:\{|;|const\b|override\b)/,
    /^(?:(?:const|static|inline|extern|volatile|mutable|constexpr)\s+)*(?:struct|enum|class)\s+[a-z_$][a-z0-9_$:<>]*\s+[*&\s]*[a-z_$][a-z0-9_$]*\s*(?:[=;,{]|\[[^\]]+])/,
    /^(?:(?:static|inline|extern|const)\s+)*(?:struct|enum|typedef|void|int|char|bool|[a-z_$][a-z0-9_$:<>]*_t)\s+[*&\s]*[a-z_$][a-z0-9_$]*\s*(?:\([^)]*\)|[=;,[{])/,
  ].some((pattern) => pattern.test(body));
}

function looksLikeStandaloneCStyleDeclaration(line: string): boolean {
  if (/^(?:struct|enum)\s+[a-z_][a-z0-9_:<>]*\s*(?:[{:;])/.test(line)) {
    return true;
  }

  const parsed = readCLikeLine(line);
  return (
    parsed?.category === "declaration" &&
    (parsed.nontrivialAnchor || looksLikeTypedCDeclarationPrefix(line))
  );
}

function looksLikeTypedCDeclarationPrefix(line: string): boolean {
  return /^(?:(?:const|static|inline|extern|volatile|mutable|constexpr|virtual)\s+)*(?:(?:struct|enum|class)\s+)?(?:void|int|char|bool|auto|size_t|u?int\d+_t|[a-z_][a-z0-9_]*_t)\b/.test(
    line,
  );
}
