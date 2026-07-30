export type CLikeLine = {
  category: CLikeCategory;
  strongAnchor: boolean;
  nontrivialAnchor: boolean;
};

type CLikeCategory =
  | "access"
  | "assignment"
  | "brace"
  | "call"
  | "control"
  | "declaration"
  | "return";

export function readCLikeLine(line: string): CLikeLine | null {
  if (/^(?:public|private|protected):$/.test(line)) {
    return { category: "access", strongAnchor: true, nontrivialAnchor: true };
  }
  if (/^[{}]\s*;?$/.test(line) || /^\}\s*(?:else\b|while\s*\().*/.test(line)) {
    return { category: "brace", strongAnchor: false, nontrivialAnchor: false };
  }
  if (
    /^(?:if|for|while|switch)\s*\(.+\)\s*\{?$/.test(line) ||
    /^(?:case\s+.+|default):\s*$/.test(line)
  ) {
    return {
      category: "control",
      strongAnchor: /[{};]|->|::|\bstd::/.test(line),
      nontrivialAnchor: true,
    };
  }
  if (/^(?:return|break|continue)\b.*;$/.test(line)) {
    return {
      category: "return",
      strongAnchor: /[A-Z_]{3,}|->|::|\bstd::/.test(line),
      nontrivialAnchor: false,
    };
  }
  if (looksLikeCLikeDeclaration(line)) {
    return {
      category: "declaration",
      strongAnchor: true,
      nontrivialAnchor: /(?:\bstd::|->|::|[*&<>]|\b(?:size_t|uint\d+_t|int\d+_t)\b)/.test(line),
    };
  }
  if (looksLikeCLikeAssignment(line)) {
    return {
      category: "assignment",
      strongAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*|\[[^\]]+])|\b[A-Z_]{3,}\b/i.test(line),
      nontrivialAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*)/i.test(line),
    };
  }
  if (looksLikeCLikeCall(line)) {
    return {
      category: "call",
      strongAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*|\b[A-Z_]{3,}\s*\()/i.test(line),
      nontrivialAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*)/i.test(line),
    };
  }
  if (looksLikeCLikeContinuation(line)) {
    return {
      category: "call",
      strongAnchor: /(?:->|::|\.|\[[^\]]+]|\bsizeof\s*\()/i.test(line),
      nontrivialAnchor: /(?:->|::|\.|\[[^\]]+])/i.test(line),
    };
  }

  return null;
}

export function readClippedCLikeLine(line: string): CLikeLine | null {
  const clipped = line.replace(/\.\.\.\s*$/, "").trim();
  if (looksLikeCLikePartialReturn(clipped)) {
    return { category: "return", strongAnchor: false, nontrivialAnchor: false };
  }
  if (looksLikeCLikePartialAssignment(clipped)) {
    return {
      category: "assignment",
      strongAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*|\[[^\]]+])|\b[A-Z_]{3,}\b/i.test(clipped),
      nontrivialAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*)/i.test(clipped),
    };
  }
  if (looksLikeCLikePartialCall(clipped)) {
    return {
      category: "call",
      strongAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*|\b[A-Z_]{3,}\s*\(|\bstd::)/i.test(clipped),
      nontrivialAnchor: /(?:->|::|\.[a-z_][a-z0-9_]*)/i.test(clipped),
    };
  }
  return null;
}

export function isCLikeCommentOnlyLine(line: string): boolean {
  return /^(?:(?:\/\/|#|;)\s*|\/\*+|\*\/?)/.test(line);
}

function looksLikeCLikeDeclaration(line: string): boolean {
  return [
    /^(?:(?:const|static|inline|extern|volatile|mutable|constexpr)\s+)*(?:std::)?[a-z_][a-z0-9_:<>]*(?:\s*[*&]|\s+)+[a-z_][a-z0-9_:~]*(?:\s*[({=;[]|\s+\{)/i,
    /^(?:(?:const|static|inline|extern|volatile|mutable|constexpr)\s+)*(?:struct|enum|class)\s+[a-z_][a-z0-9_:<>]*\s+[*&\s]*[a-z_][a-z0-9_]*\s*(?:[=;,{]|\[[^\]]+])/i,
    /^(?=.*\()(?:(?:static|inline|extern|const|virtual)\s+)*(?:(?:struct|enum|class)\s+)?[a-z_][a-z0-9_:<>]*(?:\s*[*&]|\s+)+[~a-z_][a-z0-9_:<>]*\s*\([^;]*(?:\{|,\s*)?$/i,
    /^(?=.*[,)]\s*(?:const\s*)?(?:\{)?$)\s*(?:const\s+)?[a-z_][a-z0-9_:<>]*(?:\s*[*&]+|\s+)[^;{}]+[,)]\s*(?:const\s*)?(?:\{)?$/i,
  ].some((pattern) => pattern.test(line));
}

function looksLikeCLikeAssignment(line: string): boolean {
  return /^[a-z_][a-z0-9_]*(?:(?:->|\.|::)[a-z_][a-z0-9_]*|\[[^\]]+])*\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|<<=|>>=).+;$/i.test(
    line,
  );
}

function looksLikeCLikeCall(line: string): boolean {
  if (!/;$/.test(line)) {
    return false;
  }
  if (/^(?:please|then|now|maybe|should|must|can)\b/i.test(line)) {
    return false;
  }

  return /^(?:(?:[a-z_][a-z0-9_]*)(?:->|\.|::))?[a-z_][a-z0-9_:]*\s*\(.*\)\s*;$/i.test(line);
}

function looksLikeCLikeContinuation(line: string): boolean {
  return /^(?=.*;\s*$)(?=.*(?:\)|]|\bsizeof\s*\())[\w\s.,:[\]()*&<>\-]+;\s*$/i.test(line);
}

function looksLikeCLikePartialAssignment(line: string): boolean {
  return /^[a-z_][a-z0-9_]*(?:(?:->|\.|::)[a-z_][a-z0-9_]*|\[[^\]]+])*\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|<<=|>>=)\s*\S.+$/i.test(
    line,
  );
}

function looksLikeCLikePartialCall(line: string): boolean {
  if (/^(?:please|then|now|maybe|should|must|can)\b/i.test(line)) {
    return false;
  }
  return /^(?:(?:[a-z_][a-z0-9_]*)(?:->|\.|::))?[a-z_][a-z0-9_:]*\s*\(.+\S$/i.test(line);
}

function looksLikeCLikePartialReturn(line: string): boolean {
  return /^retu(?:r(?:n)?)?(?:\b|$)/i.test(line);
}
