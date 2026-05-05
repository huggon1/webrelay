import type { ExportResult, TransformSpec } from "@extractor/shared";

const blockedCodePattern =
  /\b(require|process|globalThis|window|document|fetch|XMLHttpRequest|WebSocket|eval|setTimeout|setInterval|import|chrome)\b|(?:^|[^A-Za-z0-9_$])(?:fs|child_process)(?:[^A-Za-z0-9_$]|$)/;

export function validateTransformSpec(transform: TransformSpec) {
  if (blockedCodePattern.test(transform.code)) {
    throw new Error("Transform code contains blocked runtime capabilities.");
  }
}

export function runTransform(transform: TransformSpec, data: unknown): ExportResult {
  validateTransformSpec(transform);
  const transformFunction = new Function(
    "input",
    `"use strict";\n${transform.code}`,
  ) as (input: unknown) => unknown;
  const output = transformFunction(structuredClone(data));
  if (typeof output !== "string") {
    throw new Error("Transform must return a string.");
  }
  return {
    formatLabel: transform.formatLabel,
    content: output,
    warnings: [],
  };
}

export function safePreviewExport(data: unknown, warning?: string): ExportResult {
  return {
    formatLabel: "JSON",
    content: JSON.stringify(data, null, 2),
    warnings: warning ? [warning] : [],
  };
}
