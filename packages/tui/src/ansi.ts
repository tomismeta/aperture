import type { AttentionFrame as Frame } from "@tomismeta/aperture-core";
import type { Posture } from "./types.js";

/**
 * Minimal ANSI palette — near-monochrome with a single accent.
 *
 * Design: inspired by Claude Code's terminal approach.
 * Hierarchy comes from bold/dim/normal weight, not color count.
 * Only two hues: dim white family (structure) + one accent (interaction).
 *
 * The palette uses 16-color ANSI codes so it adapts to the operator's
 * terminal theme (Solarized, Catppuccin, Dracula, etc.).
 */
export const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  italic: "\u001B[3m",
  white: "\u001B[97m",
  gray: "\u001B[90m",
  // Brand — single accent hue (256-color 74: calm teal-blue #5FAFAF)
  brand: "\u001B[38;5;74m",
} as const;

// ── Style functions ──────────────────────────────────────────────────

/** Titles, active frame names — bold bright white */
export function styleStrong(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.white}${value}${ANSI.reset}` : value;
}

/** Secondary text, metadata, labels — dim */
export function styleMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${value}${ANSI.reset}` : value;
}

/** Ambient items, decorative — very dim */
export function styleDeepMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${ANSI.gray}${value}${ANSI.reset}` : value;
}

/** Judgment lines, rationale — italic dim */
export function styleItalicMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${ANSI.italic}${value}${ANSI.reset}` : value;
}

/** Key hints: [a], [enter] — key in bold brand blue, brackets in dim */
export function styleKey(value: string, color: boolean): string {
  if (!color) return `[${value}]`;
  return `${ANSI.dim}[${ANSI.reset}${ANSI.bold}${ANSI.brand}${value}${ANSI.reset}${ANSI.dim}]${ANSI.reset}`;
}

/** Queue rank numbers — dim, not attention-grabbing */
export function styleRank(rank: number, color: boolean): string {
  const value = String(rank).padStart(2, "0");
  return color ? `${ANSI.dim}${value}${ANSI.reset}` : value;
}

/** Brand "APERTURE" — bold cyan. The single accent gives it identity. */
export function styleBrand(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.brand}${value}${ANSI.reset}` : value;
}

/** Source labels — dim, informational, not interactive */
export function styleSource(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${value}${ANSI.reset}` : value;
}

/** Numeric values worth highlighting — cyan, draws eye to key data */
export function styleValue(value: string, color: boolean): string {
  return color ? `${ANSI.brand}${value}${ANSI.reset}` : value;
}

/**
 * Title with filename highlighting — filenames and paths pop in cyan
 * while the rest stays bold white. Matches common patterns:
 * - bare filenames: render-why.ts, package.json
 * - absolute paths: /Users/tom/dev/aperture/src/render.ts
 * - relative paths: src/render.ts, ./render.ts
 */
export function styleTitle(value: string, color: boolean): string {
  if (!color) return value;
  // Match paths or filenames with extensions
  const filePattern = /(?:(?:\.?\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+|[\w@.-]+\.\w{1,10})/g;
  let result = "";
  let lastIndex = 0;
  for (const match of value.matchAll(filePattern)) {
    const before = value.slice(lastIndex, match.index);
    if (before) result += `${ANSI.bold}${ANSI.white}${before}${ANSI.reset}`;
    result += `${ANSI.bold}${ANSI.brand}${match[0]}${ANSI.reset}`;
    lastIndex = match.index + match[0].length;
  }
  const remaining = value.slice(lastIndex);
  if (remaining) result += `${ANSI.bold}${ANSI.white}${remaining}${ANSI.reset}`;
  return result || styleStrong(value, color);
}

// ── Semantic colors (used very sparingly) ────────────────────────────

/** Posture — single cyan hue, hierarchy through weight (dim/normal/bold) */
export function stylePosture(posture: Posture, flash: boolean, color: boolean): string {
  const icons: Record<Posture, string> = {
    calm: "○",
    elevated: "◐",
    busy: "●",
  };
  const text = `${icons[posture]} ${posture}`;
  if (!color) return text;
  switch (posture) {
    case "calm":
      return `${ANSI.dim}${ANSI.brand}${text}${ANSI.reset}`;
    case "elevated":
      return flash
        ? `${ANSI.bold}${ANSI.brand}${text}${ANSI.reset}`
        : `${ANSI.brand}${text}${ANSI.reset}`;
    case "busy":
      return flash
        ? `${ANSI.bold}${ANSI.brand}${text}${ANSI.reset}`
        : `${ANSI.bold}${ANSI.brand}${text}${ANSI.reset}`;
  }
}

/** Why-mode: verdict/override labels — bold cyan, brand accent */
export function styleVerdict(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.brand}${value}${ANSI.reset}` : value;
}

/** Why-mode: active gate names that produced a decision — cyan */
export function styleActiveGate(value: string, color: boolean): string {
  return color ? `${ANSI.brand}${value}${ANSI.reset}` : value;
}

// ── Text utilities ───────────────────────────────────────────────────

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

export function truncateVisible(value: string, width: number): string {
  if (width < 1) return "";
  let visible = 0;
  let i = 0;
  const ansiPattern = /\u001B\[[0-9;]*m/;
  while (i < value.length && visible < width) {
    const remaining = value.slice(i);
    const match = remaining.match(ansiPattern);
    if (match && match.index === 0) {
      i += match[0].length;
      continue;
    }
    visible++;
    i++;
  }
  const tail = value.slice(i);
  const trailingAnsi = tail.match(/^(\u001B\[[0-9;]*m)+/);
  if (trailingAnsi) {
    return value.slice(0, i) + trailingAnsi[0];
  }
  return value.slice(0, i) + ANSI.reset;
}

export function padVisible(value: string, width: number): string {
  const visible = visibleLength(value);
  if (visible < width) {
    return `${value}${" ".repeat(width - visible)}`;
  }
  if (visible > width) {
    return truncateVisible(value, width);
  }
  return value;
}

export function alignLine(left: string, right: string, width: number): string {
  const gap = width - visibleLength(left) - visibleLength(right);
  if (gap <= 1) {
    return left;
  }
  return `${left}${" ".repeat(gap)}${right}`;
}

export function alignFooterStats(left: string, right: string, width: number): string {
  const rightWidth = visibleLength(right);
  if (rightWidth >= width) {
    return truncateVisible(right, width);
  }

  const availableLeft = Math.max(0, width - rightWidth - 1);
  if (availableLeft === 0) {
    return right;
  }

  const fittedLeft = visibleLength(left) > availableLeft
    ? truncateVisible(left, Math.max(1, availableLeft - 1))
    : left;
  const gap = Math.max(1, width - visibleLength(fittedLeft) - rightWidth);
  return `${fittedLeft}${" ".repeat(gap)}${right}`;
}

export function wrapText(value: string, width: number): string[] {
  const normalized = value.trim();
  if (normalized === "" || width < 1) {
    return [""];
  }

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = hardBreak(word, width);

    for (const chunk of chunks) {
      if (current === "") {
        current = chunk;
        continue;
      }

      if (`${current} ${chunk}`.length <= width) {
        current = `${current} ${chunk}`;
        continue;
      }

      lines.push(current);
      current = chunk;
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines;
}

export function hardBreak(word: string, width: number): string[] {
  if (word.length <= width) {
    return [word];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < word.length) {
    chunks.push(word.slice(offset, offset + width));
    offset += width;
  }
  return chunks;
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function renderLabeledBlock(label: string, value: string, color: boolean): string[] {
  return renderPrefixedBlock(`${styleMuted(`${label} `, color)}`, value, `${" ".repeat(label.length)} `);
}

export function renderPrefixedBlock(prefix: string, value: string, continuationPrefix = "    "): string[] {
  const prefixWidth = visibleLength(prefix);
  const wrapped = wrapText(value, CONTENT_WIDTH - prefixWidth);
  return wrapped.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
}

export const CONTENT_WIDTH = 76;
export const SCREEN_WIDTH = 78;
