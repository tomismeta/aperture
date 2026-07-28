import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import { looksLikeStrongRawSourceObservation } from "./semantic-source-observation-shapes.js";

export { looksLikeStrongRawSourceObservation } from "./semantic-source-observation-shapes.js";

export function looksLikeStructuredToolOutputObservation(output: string): boolean {
  return (
    looksLikeStrongRawSourceObservation(output) ||
    looksLikeBuildOrLogObservation(output) ||
    looksLikeReadTruncationProtocolObservation(output) ||
    looksLikeMarkdownDocumentObservation(output)
  );
}

export function looksLikePlainReadObservation(value: string): boolean {
  return (
    looksLikeStrongRawSourceObservation(value) ||
    looksLikeBuildOrLogObservation(value) ||
    looksLikeReadTruncationProtocolObservation(value) ||
    looksLikeMarkdownDocumentObservation(value)
  );
}

export function looksLikeBuildOrLogObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  const markers = [
    /\b(?:make|cmake|ninja|pytest|unittest|dkms)[^\r\n]{0,80}\.log\b/i,
    /\btotal output lines:\s*\d+\b/i,
    /(?:^|[\r\n])\s*\[\s*\d+%]\s+(?:building|linking|generating)\b/i,
    /(?:^|[\r\n])\s*checking for a\b/i,
    /(?:^|[\r\n])\s*building module\(s\)(?=\s|$)/i,
    /(?:^|[\r\n])\s*building [a-z0-9_ -]*object\b/i,
    /(?:^|[\r\n])\s*linking [a-z0-9_ -]*target\b/i,
    /(?:^|[\r\n])\s*[^\r\n:]+:\d+:\s*(?:userwarning|warning):\s+\S/i,
  ].filter((pattern) => pattern.test(text)).length;

  return (
    markers >= 2 ||
    countRepeatedBuildLogLines(text) >= 2 ||
    looksLikeFlattenedBuildLogObservation(text) ||
    looksLikeFlattenedKernelLogObservation(text) ||
    looksLikeCMakeWarningLogObservation(text)
  );
}

function countRepeatedBuildLogLines(text: string): number {
  return [
    ...text.matchAll(
      /(?:^|[\r\n])\s*(?:checking for a\b|building module\(s\)(?=\s|$)|building [a-z0-9_ -]*object\b|linking [a-z0-9_ -]*target\b|\[\s*\d+%]\s+(?:building|linking|generating)\b)/gi,
    ),
  ].length;
}

function looksLikeFlattenedBuildLogObservation(text: string): boolean {
  return (
    /\b(?:make|cmake|ninja|pytest|unittest|dkms)[^\r\n]{0,80}\.log\b/i.test(text) &&
    /\bbuilding module\(s\)(?=\s|$)|\b(?:building|linking) [a-z0-9_ -]*(?:object|target)\b/i.test(
      text,
    ) &&
    /\b(?:command:\s*['"]?(?:make|cmake|ninja)\b|kernelver=|checking for a [a-z0-9 -]+\.{3})/i.test(
      text,
    )
  );
}

function looksLikeFlattenedKernelLogObservation(text: string): boolean {
  if (looksLikeKernelLogDiagnosticPayload(text)) {
    return false;
  }

  return (
    countDmesgTimestampEntries(text) >= 2 ||
    (/\btotal output lines:\s*\d+\b/i.test(text) && countNumberedDmesgEntries(text) >= 2)
  );
}

function looksLikeKernelLogDiagnosticPayload(text: string): boolean {
  return /(?:^|[\r\n]|\s)(?:\d+:\s*)?\[\s*\d+(?:\.\d+)?][^\r\n]*(?:\*ERROR\*|\b(?:error|failed|failure|fault)\b)/i.test(
    text,
  );
}

function countDmesgTimestampEntries(text: string): number {
  return [...text.matchAll(/(?:^|[\r\n]|\s)\[\s*\d+(?:\.\d+)?]\s+\S/g)].length;
}

function countNumberedDmesgEntries(text: string): number {
  return [...text.matchAll(/(?:^|[\r\n]|\s)\d+:\s*\[\s*\d+(?:\.\d+)?]\s+\S/g)].length;
}

function looksLikeCMakeWarningLogObservation(text: string): boolean {
  return (
    /\btotal output lines:\s*\d+\b/i.test(text) &&
    /\bCMake (?:Deprecation )?Warning at (?:[^\s:]+\/)*CMakeLists\.txt:\d+\s+\(/i.test(text) &&
    !/\bCMake Error at\b/i.test(text)
  );
}

function looksLikeMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  const headingCount = [...normalized.matchAll(/(?:^|[\r\n])\s{0,3}#{1,6}\s+\S/g)].length;
  const listCount = [...normalized.matchAll(/(?:^|[\r\n])\s*(?:[-*]\s+\S|\d+\.\s+\S)/g)].length;
  const hasCodeFence = /(?:^|[\r\n])\s*```/.test(normalized);

  return normalized.length >= 160 && headingCount >= 2 && (listCount >= 2 || hasCodeFence);
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}
