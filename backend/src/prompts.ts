import type { ExecutionDebug, ExtractionRecipe } from "@extractor/shared";

const recipeContract = `
Return only strict JSON. Do not use markdown.
The JSON must match this TypeScript shape:
{
  "version": 1,
  "mode": "single" | "list",
  "rootSelector"?: "CSS selector; required for list mode",
  "fields": [
    {
      "name": "stable camelCase or snake_case field name",
      "selector"?: "CSS selector relative to rootSelector for list mode",
      "value": "textContent" | "innerText" | "attribute" | "href" | "src",
      "attribute"?: "attribute name when value is attribute",
      "required"?: boolean
    }
  ]
}
Never generate JavaScript code. Never add keys outside this shape.
Prefer robust semantic selectors over brittle long nth-child selectors.
For list extraction, rootSelector should match each repeated item.
You may reason internally over multiple steps, but your final answer must contain only the JSON recipe.
Do not modify files, run commands, or perform any browser automation.
`;

export function buildGeneratePrompt(input: {
  url: string;
  intent: string;
  domSnapshot: string;
}) {
  return `
You generate a reusable browser content extraction recipe for the current page.

URL:
${input.url}

User extraction intent:
${input.intent}

Page DOM snapshot:
${input.domSnapshot}

${recipeContract}
`;
}

export function buildRepairPrompt(input: {
  url: string;
  intent: string;
  domSnapshot: string;
  oldRecipe: ExtractionRecipe;
  debug: ExecutionDebug;
  failureReason: string;
}) {
  return `
Repair this extraction recipe for the current page. Keep the user's intent, but update selectors and fields so the recipe succeeds.

URL:
${input.url}

User extraction intent:
${input.intent}

Failure reason:
${input.failureReason}

Old recipe:
${JSON.stringify(input.oldRecipe, null, 2)}

Execution debug:
${JSON.stringify(input.debug, null, 2)}

Current page DOM snapshot:
${input.domSnapshot}

${recipeContract}
`;
}
