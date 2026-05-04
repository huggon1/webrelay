import { describe, expect, it } from "vitest";
import { extractionRecipeSchema } from "@extractor/shared";
import { parseCodexFinalResponse, recipeOutputSchema } from "./llm.js";

describe("Codex recipe output", () => {
  it("parses strict JSON final responses", () => {
    const parsed = parseCodexFinalResponse(
      JSON.stringify({
        version: 1,
        mode: "single",
        fields: [{ name: "title", selector: "h1", value: "textContent", required: true }],
      }),
    );

    expect(extractionRecipeSchema.safeParse(parsed).success).toBe(true);
  });

  it("parses fenced JSON defensively", () => {
    const parsed = parseCodexFinalResponse(`\`\`\`json
{"version":1,"mode":"list","rootSelector":".item","fields":[{"name":"title","selector":".title","value":"textContent"}]}
\`\`\``);

    expect(extractionRecipeSchema.safeParse(parsed).success).toBe(true);
  });

  it("normalizes Codex nullable optional fields for Zod recipe validation", () => {
    const parsed = parseCodexFinalResponse(
      JSON.stringify({
        version: 1,
        mode: "single",
        rootSelector: null,
        fields: [
          {
            name: "title",
            selector: "h1",
            value: "textContent",
            attribute: null,
            required: true,
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      version: 1,
      mode: "single",
      fields: [{ name: "title", selector: "h1", value: "textContent", required: true }],
    });
    expect(extractionRecipeSchema.safeParse(parsed).success).toBe(true);
  });

  it("throws on non-JSON final responses", () => {
    expect(() => parseCodexFinalResponse("Here is your recipe")).toThrow(
      "Codex response was not valid JSON",
    );
  });

  it("keeps the JSON schema closed to arbitrary code fields", () => {
    const fieldSchema = recipeOutputSchema.properties.fields.items;
    expect(recipeOutputSchema.additionalProperties).toBe(false);
    expect(recipeOutputSchema.required).toEqual(["version", "mode", "rootSelector", "fields"]);
    expect(fieldSchema.additionalProperties).toBe(false);
    expect(fieldSchema.required).toEqual(["name", "selector", "value", "attribute", "required"]);
    expect(Object.keys(fieldSchema.properties)).not.toContain("code");
  });
});
