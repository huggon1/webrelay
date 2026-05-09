import { Codex, type ModelReasoningEffort, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import type { CodexProgressEvent } from "@extractor/shared";

export const fieldRuleOutputSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    selector: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    value: { type: "string", enum: ["textContent", "innerText", "attribute", "href", "src"] },
    attribute: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    required: { type: "boolean" },
  },
  required: ["name", "selector", "value", "attribute", "required"],
  additionalProperties: false,
} as const;

export const recipeOutputSchema = {
  type: "object",
  properties: {
    version: { type: "number", const: 1 },
    mode: { type: "string", enum: ["single", "list"] },
    rootSelector: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    fields: { type: "array", minItems: 1, items: fieldRuleOutputSchema },
  },
  required: ["version", "mode", "rootSelector", "fields"],
  additionalProperties: false,
} as const;

export const artifactOutputSchema = {
  type: "object",
  properties: {
    recipe: recipeOutputSchema,
    script: {
      type: "object",
      properties: {
        version: { type: "number", const: 1 },
        code: { type: "string", minLength: 1 },
      },
      required: ["version", "code"],
      additionalProperties: false,
    },
    outputDescription: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
  },
  required: ["recipe", "script", "outputDescription"],
  additionalProperties: false,
} as const;

export const intentAnalysisOutputSchema = {
  type: "object",
  properties: {
    pageDescription: { type: "string", minLength: 1 },
    suggestedMode: { type: "string", enum: ["single", "list"] },
    suggestedFields: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          example: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["name", "description", "example"],
        additionalProperties: false,
      },
    },
  },
  required: ["pageDescription", "suggestedMode", "suggestedFields"],
  additionalProperties: false,
} as const;

export type CodexJsonOptions = {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  workingDirectory?: string;
};

export type CodexProgressCallback = (event: CodexProgressEvent) => void;

function parseJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Codex returned an empty response.");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) return JSON.parse(match[1].trim()) as unknown;
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    }
    throw new Error("Codex response was not valid JSON.");
  }
}

export function parseCodexJsonResponse(finalResponse: string) {
  return normalizeJsonCandidate(parseJsonText(finalResponse));
}

function normalizeJsonCandidate(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const normalized: Record<string, unknown> = { ...(candidate as Record<string, unknown>) };
  for (const key of ["rootSelector", "selector", "attribute", "outputDescription"]) {
    if (normalized[key] === null) delete normalized[key];
  }
  if (normalized.recipe && typeof normalized.recipe === "object" && !Array.isArray(normalized.recipe)) {
    normalized.recipe = normalizeJsonCandidate(normalized.recipe);
  }
  if (Array.isArray(normalized.fields)) {
    normalized.fields = normalized.fields.map(normalizeJsonCandidate);
  }
  return normalized;
}

function resolveReasoningEffort(value: string | undefined): ModelReasoningEffort | undefined {
  if (!value) return undefined;
  if (["minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as ModelReasoningEffort;
  }
  throw new Error(`Invalid CODEX_REASONING_EFFORT: ${value}`);
}

function buildThreadOptions(options: CodexJsonOptions = {}): ThreadOptions {
  return {
    workingDirectory: options.workingDirectory || process.env.CODEX_WORKING_DIRECTORY || process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    model: options.model || process.env.CODEX_MODEL || undefined,
    modelReasoningEffort: options.modelReasoningEffort || resolveReasoningEffort(process.env.CODEX_REASONING_EFFORT),
  };
}

function buildCodexPrompt(prompt: string) {
  return `
You are being used inside a local backend for a browser extension.

Hard constraints:
- Do not modify files.
- Do not run shell commands.
- Do not use web search.
- Do not output markdown or explanations.
- Your final response must be one JSON object that matches the provided output schema.
- You may generate a JavaScript function body only for the script.code field, and it must accept input: string and return a string.

Task:
${prompt}
`;
}

export async function collectFinalResponseFromEvents(
  events: AsyncIterable<ThreadEvent>,
  onProgress?: CodexProgressCallback,
) {
  let finalResponse = "";
  const seenReasoning = new Set<string>();

  for await (const event of events) {
    if (event.type === "thread.started") {
      onProgress?.({ type: "stage", message: `Codex thread started: ${event.thread_id}` });
      continue;
    }
    if (event.type === "turn.started") {
      onProgress?.({ type: "stage", message: "Generating profile artifact" });
      continue;
    }
    if (event.type === "item.completed" || event.type === "item.updated") {
      const item = event.item;
      if (item.type === "reasoning" && item.text.trim()) {
        const key = `${item.id}:${item.text}`;
        if (!seenReasoning.has(key)) {
          seenReasoning.add(key);
          onProgress?.({ type: "reasoning", message: item.text });
        }
      }
      if (event.type === "item.completed" && item.type === "agent_message") {
        finalResponse = item.text;
      }
      if (event.type === "item.completed" && item.type === "error") {
        onProgress?.({ type: "error", message: item.message });
      }
      continue;
    }
    if (event.type === "turn.completed") {
      onProgress?.({ type: "usage", usage: event.usage });
      continue;
    }
    if (event.type === "turn.failed") throw new Error(event.error.message);
    if (event.type === "error") throw new Error(event.message);
  }

  if (!finalResponse.trim()) throw new Error("Codex did not return a final response.");
  return finalResponse;
}

export async function generateJsonWithSchema(
  prompt: string,
  outputSchema: object,
  options: CodexJsonOptions = {},
) {
  const codex = new Codex();
  const thread = codex.startThread(buildThreadOptions(options));
  const turn = await thread.run(buildCodexPrompt(prompt), { outputSchema });
  return parseCodexJsonResponse(turn.finalResponse);
}

export async function generateJsonWithSchemaStreamed(
  prompt: string,
  outputSchema: object,
  options: CodexJsonOptions = {},
  onProgress?: CodexProgressCallback,
) {
  const codex = new Codex();
  const thread = codex.startThread(buildThreadOptions(options));
  onProgress?.({ type: "stage", message: "Starting read-only Codex thread" });
  const { events } = await thread.runStreamed(buildCodexPrompt(prompt), { outputSchema });
  const finalResponse = await collectFinalResponseFromEvents(events, onProgress);
  onProgress?.({ type: "stage", message: "Parsing structured JSON" });
  return parseCodexJsonResponse(finalResponse);
}
