export function looksLikeCLikeSourceFragmentObservation(value: string): boolean {
  const text = value.trim();
  return text.length > 0 && !looksLikeRejectedContainer(text) && hasStrongCLikeRun(text);
}

type CLikeCategory =
  | "access"
  | "assignment"
  | "brace"
  | "call"
  | "control"
  | "declaration"
  | "return";

type CLikeLine = {
  category: CLikeCategory;
  strongAnchor: boolean;
  nontrivialAnchor: boolean;
};

function hasStrongCLikeRun(text: string): boolean {
  let run: CLikeLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || isCommentOnlyLine(line)) {
      continue;
    }

    const parsed = readCLikeLine(line);
    if (parsed === null) {
      if (hasRequiredCLikeEvidence(run)) {
        return true;
      }
      run = [];
      continue;
    }
    run.push(parsed);
  }

  return hasRequiredCLikeEvidence(run);
}

function hasRequiredCLikeEvidence(run: CLikeLine[]): boolean {
  const categories = new Set(run.map((line) => line.category));
  const strongAnchors = run.filter((line) => line.strongAnchor).length;

  return (
    run.length >= 4 &&
    categories.size >= 2 &&
    strongAnchors >= 2 &&
    run.some((line) => line.nontrivialAnchor)
  );
}

function readCLikeLine(line: string): CLikeLine | null {
  if (/^(?:public|private|protected):$/.test(line)) {
    return { category: "access", strongAnchor: true, nontrivialAnchor: true };
  }
  if (/^[{}]\s*;?$/.test(line) || /^\}\s*(?:else\b|while\s*\().*/.test(line)) {
    return { category: "brace", strongAnchor: false, nontrivialAnchor: false };
  }
  if (/^(?:if|for|while|switch)\s*\(.+\)\s*\{?$/.test(line) || /^case\s+.+:\s*$/.test(line)) {
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

  return null;
}

function looksLikeCLikeDeclaration(line: string): boolean {
  return /^(?:(?:const|static|inline|extern|volatile|mutable|constexpr)\s+)*(?:std::)?[a-z_][a-z0-9_:<>]*(?:\s*[*&]|\s+)+[a-z_][a-z0-9_]*(?:\s*[({=;[]|\s+\{)/i.test(
    line,
  );
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

  return /^(?:(?:[a-z_][a-z0-9_]*)(?:->|\.|::))?[a-z_][a-z0-9_:]*\s*\(.+\)\s*;$/i.test(line);
}

function looksLikeRejectedContainer(text: string): boolean {
  return (
    /^\s*(?:\{|\[|")/.test(text) ||
    containsLineNumberedRows(text) ||
    containsKernelTimestampLine(text) ||
    containsMarkdownStructure(text) ||
    containsSourceLocationRows(text) ||
    /(?:^|[\r\n])\s*(?:make(?:\[\d+])?:|CMake (?:Error|Warning)\b|\[\s*\d+%]\s+\S|(?:error|fatal|warning):\b|Traceback\b|[$#>]\s+\S)/i.test(
      text,
    )
  );
}

function containsKernelTimestampLine(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:\d{1,6}:\s*)?\[\s*\d+(?:\.\d+)?]\s+\S/.test(text);
}

function containsMarkdownStructure(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:#{1,6}\s+\S|[-*]\s+\S|```|\|.+\|)/.test(text);
}

function containsSourceLocationRows(text: string): boolean {
  return /(?:^|[\r\n])\s*\S+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py):\d+(?::\d+)?:/i.test(
    text,
  );
}

function containsLineNumberedRows(text: string): boolean {
  return /(?:^|[\r\n])\s*\d{1,6}(?:[ \t]+|:\s*)\S/.test(text);
}

function isCommentOnlyLine(line: string): boolean {
  return /^(?:(?:\/\/|#|;)\s*|\/\*+|\*\/?)/.test(line);
}
