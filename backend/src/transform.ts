import vm from "node:vm";
import type { ExportResult, TransformSpec } from "@extractor/shared";

const blockedCodePattern =
  /\b(require|process|globalThis|window|document|fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval|import)\b|(?:^|[^A-Za-z0-9_$])(?:fs|child_process)(?:[^A-Za-z0-9_$]|$)/;

export function detectRiskyRequest(text: string) {
  const normalized = text.toLowerCase();
  const patterns = [
    /send|post|upload|webhook|api|http|https|database|db|sql|sqlite|postgres|mysql|redis/,
    /message|email|slack|discord|telegram|notion|airtable|sheet/,
    /read.*file|write.*file|delete.*file|shell|command|powershell|bash|cmd|execute/,
    /自动.*发送|发送.*消息|数据库|写入|读取.*文件|删除.*文件|命令|脚本执行|外部服务|联网/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

export function validateTransformSpec(transform: TransformSpec) {
  if (blockedCodePattern.test(transform.code)) {
    throw new Error("Transform code contains blocked runtime capabilities.");
  }
}

export function runTransform(transform: TransformSpec, data: unknown): ExportResult {
  validateTransformSpec(transform);
  const context = vm.createContext({
    __input: structuredClone(data),
    __result: "",
  });
  const script = new vm.Script(`
    "use strict";
    __result = (function transform(input) {
      ${transform.code}
    })(__input);
  `);
  script.runInContext(context, { timeout: 250 });
  const output = context.__result;
  if (typeof output !== "string") {
    throw new Error("Transform must return a string.");
  }
  return {
    formatLabel: transform.formatLabel,
    content: output,
    warnings: [],
  };
}

export function safePreviewExport(data: unknown, warning: string): ExportResult {
  return {
    formatLabel: "Local JSON preview",
    content: JSON.stringify(data, null, 2),
    warnings: [warning],
  };
}
