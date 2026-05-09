import type { BaseRun, ExtractionProfile } from "@extractor/shared";

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
  "script": {
    "version": 1,
    "code": "JavaScript function body"
  },
  "outputDescription"?: "One sentence describing the output"
}
The script body is executed as function transform(input: string): string.
The script receives only input, a pretty JSON string from recipe result data.
The script must return a string.
The script may use JSON.parse(input), string/array/object methods, loops, conditionals, and local helpers.
Forbidden in script: imports, require, process, globalThis, window, document, fetch, XMLHttpRequest, WebSocket, filesystem, shell commands, eval, Function, timers, browser automation, Chrome APIs, external network calls.
Do not make the script copy, download, store, or send data. It formats the string output only.
Prefer robust semantic selectors over brittle long nth-child selectors.
For list extraction, rootSelector should match each repeated item, and field selectors should be relative to that root.
`;

function pageSection(input: { url: string; domSnapshot: string }) {
  return `
URL:
${input.url}

Page DOM snapshot:
${input.domSnapshot}
`;
}

export function buildArtifactPrompt(input: {
  url: string;
  domSnapshot: string;
  mode: "auto" | "intent" | "revise";
  intent?: string;
  baseProfile?: ExtractionProfile;
  baseRun?: BaseRun;
  userNote?: string;
}) {
  if (input.mode === "auto") {
    return `
Generate a reusable WebRelay extraction profile for the current page.

The user did not provide an explicit intent. Infer the most useful repeated or single content on the page and choose a clear output format, usually Markdown for human-readable content and CSV-like text only when the page is clearly tabular.

${pageSection(input)}

${artifactContract}
`;
  }

  if (input.mode === "intent") {
    return `
Generate a reusable WebRelay extraction profile for the current page.

User intent:
${input.intent}

Focus on the requested information and format the final string so it is immediately useful for copy/download.

${pageSection(input)}

${artifactContract}
`;
  }

  return `
Revise an existing WebRelay extraction profile for the current page.

User requested change or problem description:
${input.userNote || input.intent || "Improve the profile for the current page."}

Existing profile:
${JSON.stringify(input.baseProfile, null, 2)}

Result from running the existing profile on the current page:
${JSON.stringify(input.baseRun, null, 2)}

Use the existing profile and run result to understand what currently happens. If the run failed, fix the likely recipe or script issue. If the user asks for an output change, keep the recipe when possible and adjust the script. If the user asks to capture different page content, update the recipe and script together.

${pageSection(input)}

${artifactContract}
`;
}

export function buildAnalyzeIntentPrompt(input: { url: string; domSnapshot: string }) {
  return `
Analyze this webpage and suggest the most useful extraction targets.

${pageSection(input)}

Return only strict JSON. Do not use markdown.
The JSON must match this TypeScript shape:
{
  "pageDescription": "One sentence describing the type and content of this page",
  "suggestedMode": "single" | "list",
  "suggestedFields": [
    {
      "name": "camelCase field name",
      "description": "What this field contains",
      "example": "Short example value or null"
    }
  ]
}
Suggest 3-8 useful fields. Use list mode for repeated items and single mode for one primary entity.
`;
}
