import { Codex, type ModelReasoningEffort, type ThreadOptions } from "@openai/codex-sdk";

export const recipeOutputSchema = {
  type: "object",
  properties: {
    version: { type: "number", const: 1 },
    mode: { type: "string", enum: ["single", "list"] },
    rootSelector: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
    fields: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          selector: {
            anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
          },
          value: {
            type: "string",
            enum: ["textContent", "innerText", "attribute", "href", "src"],
          },
          attribute: {
            anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
          },
          required: { type: "boolean" },
        },
        required: ["name", "selector", "value", "attribute", "required"],
        additionalProperties: false,
      },
    },
  },
  required: ["version", "mode", "rootSelector", "fields"],
  additionalProperties: false,
} as const;

export type CodexJsonOptions = {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  workingDirectory?: string;
};

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

export function parseCodexFinalResponse(finalResponse: string) {
  return normalizeRecipeCandidate(parseJsonText(finalResponse));
}

function normalizeRecipeCandidate(candidate: unknown) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const recipe = candidate as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...recipe };
  if (normalized.rootSelector === null) delete normalized.rootSelector;
  if (Array.isArray(normalized.fields)) {
    normalized.fields = normalized.fields.map((field) => {
      if (!field || typeof field !== "object" || Array.isArray(field)) return field;
      const normalizedField: Record<string, unknown> = { ...(field as Record<string, unknown>) };
      if (normalizedField.selector === null) delete normalizedField.selector;
      if (normalizedField.attribute === null) delete normalizedField.attribute;
      return normalizedField;
    });
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
    workingDirectory:
      options.workingDirectory || process.env.CODEX_WORKING_DIRECTORY || process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    model: options.model || process.env.CODEX_MODEL || undefined,
    modelReasoningEffort:
      options.modelReasoningEffort || resolveReasoningEffort(process.env.CODEX_REASONING_EFFORT),
  };
}

function buildCodexPrompt(prompt: string) {
  return `
You are being used inside a local backend for a browser extension.

Hard constraints:
- Do not modify files.
- Do not run shell commands.
- Do not use web search.
- Do not generate JavaScript or TypeScript code.
- Do not output markdown or explanations.
- Your final response must be one JSON object that matches the provided output schema.

Task:
${prompt}
`;
}

export async function generateJsonFromLLM(prompt: string, options: CodexJsonOptions = {}) {
  const codex = new Codex();
  const thread = codex.startThread(buildThreadOptions(options));
  const turn = await thread.run(buildCodexPrompt(prompt), {
    outputSchema: recipeOutputSchema,
  });
  return parseCodexFinalResponse(turn.finalResponse);
}
