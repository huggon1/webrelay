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

export const transformOutputSchema = {
  type: "object",
  properties: {
    version: { type: "number", const: 1 },
    formatLabel: { type: "string", minLength: 1 },
    outputDescription: { type: "string", minLength: 1 },
    code: { type: "string", minLength: 1 },
  },
  required: ["version", "formatLabel", "outputDescription", "code"],
  additionalProperties: false,
} as const;

export const artifactOutputSchema = {
  type: "object",
  properties: {
    recipe: recipeOutputSchema,
    transform: {
      anyOf: [transformOutputSchema, { type: "null" }],
    },
    outputDescription: {
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    },
  },
  required: ["recipe", "transform", "outputDescription"],
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

export function parseCodexJsonResponse(finalResponse: string) {
  return normalizeJsonCandidate(parseJsonText(finalResponse));
}

function normalizeRecipeCandidate(candidate: unknown) {
  return normalizeJsonCandidate(candidate);
}

function normalizeJsonCandidate(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const normalized: Record<string, unknown> = { ...(candidate as Record<string, unknown>) };
  if (normalized.rootSelector === null) delete normalized.rootSelector;
  if (normalized.transform === null) delete normalized.transform;
  if (normalized.outputDescription === null) delete normalized.outputDescription;
  if (normalized.recipe && typeof normalized.recipe === "object" && !Array.isArray(normalized.recipe)) {
    normalized.recipe = normalizeJsonCandidate(normalized.recipe);
  }
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

function buildCodexPrompt(prompt: string, options: { allowTransformCode?: boolean } = {}) {
  const codeRule = options.allowTransformCode
    ? "- You may generate only the requested transform function body. Do not include imports, network calls, filesystem access, shell commands, timers, eval, Function constructors, or browser automation."
    : "- Do not generate JavaScript or TypeScript code.";
  return `
You are being used inside a local backend for a browser extension.

Hard constraints:
- Do not modify files.
- Do not run shell commands.
- Do not use web search.
${codeRule}
- Do not output markdown or explanations.
- Your final response must be one JSON object that matches the provided output schema.

Task:
${prompt}
`;
}

export async function generateJsonWithSchema(
  prompt: string,
  outputSchema: object,
  options: CodexJsonOptions & { allowTransformCode?: boolean } = {},
) {
  const codex = new Codex();
  const thread = codex.startThread(buildThreadOptions(options));
  const turn = await thread.run(buildCodexPrompt(prompt, options), {
    outputSchema,
  });
  return parseCodexJsonResponse(turn.finalResponse);
}

export async function generateJsonFromLLM(prompt: string, options: CodexJsonOptions = {}) {
  return generateJsonWithSchema(prompt, recipeOutputSchema, options);
}
