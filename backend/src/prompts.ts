import type { ExecutionDebug, ExtractionRecipe, ExtractionResult } from "@extractor/shared";

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

const transformContract = `
Return only strict JSON. Do not use markdown.
The JSON must match this TypeScript shape:
{
  "version": 1,
  "formatLabel": "Short human-readable output format label",
  "outputDescription": "One sentence describing the final output",
  "code": "JavaScript function body that transforms input into a string"
}
The code is the body of function transform(input). It must return a string.
Allowed: JSON.stringify, Array/Object/String/Number methods, template literals, loops, conditionals, local helper functions.
Forbidden: imports, require, process, globalThis, window, document, fetch, XMLHttpRequest, WebSocket, filesystem, shell commands, eval, Function, timers, browser automation, external network calls.
If the user asks for markdown, CSV, JSON, or a custom text structure, implement that format in the function body.
If the request is unclear, choose a readable local preview format and describe it in outputDescription.
`;

const artifactContract = `
Return only strict JSON. Do not use markdown.
The JSON must match this TypeScript shape:
{
  "recipe": {
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
  },
  "transform": null | {
    "version": 1,
    "formatLabel": "Short human-readable output format label",
    "outputDescription": "One sentence describing the final output",
    "code": "JavaScript function body that transforms input into a string"
  },
  "outputDescription": null | "One sentence describing what the artifact produces"
}
Keep the existing recipe if the user's feedback only changes output formatting.
Update the recipe if the user's feedback changes what should be captured from the page.
Transform code is the body of function transform(input). It must return a string.
Forbidden in transform code: imports, require, process, globalThis, window, document, fetch, XMLHttpRequest, WebSocket, filesystem, shell commands, eval, Function, timers, browser automation, external network calls.
Never add keys outside this shape.
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

export function buildTransformPrompt(input: {
  intent: string;
  outputRequest: string;
  result: ExtractionResult;
}) {
  return `
Generate a reusable local output transform for extracted webpage data.

Original extraction intent:
${input.intent}

User output request:
${input.outputRequest}

Extraction result data:
${JSON.stringify(input.result.data, null, 2)}

Execution debug:
${JSON.stringify(input.result.debug, null, 2)}

${transformContract}
`;
}

export function buildRefinePrompt(input: {
  url: string;
  intent: string;
  feedback: string;
  domSnapshot: string;
  currentRecipe: ExtractionRecipe;
  currentResult: ExtractionResult;
}) {
  return `
Refine the current webpage extraction artifact based on the user's latest feedback.

URL:
${input.url}

Original extraction intent:
${input.intent}

User feedback:
${input.feedback}

Current recipe:
${JSON.stringify(input.currentRecipe, null, 2)}

Current extraction result:
${JSON.stringify(input.currentResult.data, null, 2)}

Current execution debug:
${JSON.stringify(input.currentResult.debug, null, 2)}

Current page DOM snapshot:
${input.domSnapshot}

${artifactContract}
`;
}
