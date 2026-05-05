import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm.js", () => ({
  generateJsonFromLLM: vi.fn(),
  generateJsonWithSchema: vi.fn(),
  transformOutputSchema: {},
  artifactOutputSchema: {},
}));

const { createApp } = await import("./app.js");
const { generateJsonFromLLM, generateJsonWithSchema } = await import("./llm.js");

const mockedGenerateJson = vi.mocked(generateJsonFromLLM);
const mockedGenerateJsonWithSchema = vi.mocked(generateJsonWithSchema);

const validRecipe = {
  version: 1,
  mode: "single",
  fields: [{ name: "title", selector: "h1", value: "textContent", required: true }],
};

const validDebug = {
  mode: "single",
  rootMatchCount: 1,
  fields: [{ name: "title", selector: "h1", matchCount: 0, emptyCount: 0 }],
  errors: [{ code: "required_empty", field: "title", message: "Missing title" }],
};

describe("backend app with Codex provider", () => {
  beforeEach(() => {
    mockedGenerateJson.mockReset();
    mockedGenerateJsonWithSchema.mockReset();
  });

  it("reports Codex provider in health", async () => {
    const response = await request(createApp()).get("/health").expect(200);
    expect(response.body).toEqual({ ok: true, provider: "codex" });
  });

  it("generates a recipe through Codex", async () => {
    mockedGenerateJson.mockResolvedValue(validRecipe);

    const response = await request(createApp())
      .post("/generate-recipe")
      .send({
        url: "https://example.com/page",
        intent: "Extract title",
        domSnapshot: "<h1>Hello</h1>",
      })
      .expect(200);

    expect(response.body.recipe).toEqual(validRecipe);
    expect(mockedGenerateJson).toHaveBeenCalledTimes(1);
  });

  it("repairs a recipe through Codex", async () => {
    const repairedRecipe = {
      version: 1,
      mode: "single",
      fields: [{ name: "title", selector: ".headline", value: "textContent", required: true }],
    };
    mockedGenerateJson.mockResolvedValue(repairedRecipe);

    const response = await request(createApp())
      .post("/repair-recipe")
      .send({
        url: "https://example.com/page",
        intent: "Extract title",
        domSnapshot: '<h1 class="headline">Hello</h1>',
        oldRecipe: validRecipe,
        debug: validDebug,
        failureReason: "Missing title",
      })
      .expect(200);

    expect(response.body.recipe).toEqual(repairedRecipe);
  });

  it("rejects Codex recipes with arbitrary code fields", async () => {
    mockedGenerateJson.mockResolvedValue({
      ...validRecipe,
      code: "alert(1)",
    });

    const response = await request(createApp())
      .post("/generate-recipe")
      .send({
        url: "https://example.com/page",
        intent: "Extract title",
        domSnapshot: "<h1>Hello</h1>",
      })
      .expect(400);

    expect(response.body.error).toContain("Unrecognized key");
  });

  it("rejects invalid list recipes without rootSelector", async () => {
    mockedGenerateJson.mockResolvedValue({
      version: 1,
      mode: "list",
      fields: [{ name: "title", selector: ".title", value: "textContent" }],
    });

    const response = await request(createApp())
      .post("/generate-recipe")
      .send({
        url: "https://example.com/page",
        intent: "Extract titles",
        domSnapshot: '<article class="item"><h2 class="title">Hello</h2></article>',
      })
      .expect(400);

    expect(response.body.error).toContain("rootSelector is required");
  });

  it("surfaces Codex failures as 500 errors", async () => {
    mockedGenerateJson.mockRejectedValue(new Error("Codex CLI is not logged in"));

    const response = await request(createApp())
      .post("/generate-recipe")
      .send({
        url: "https://example.com/page",
        intent: "Extract title",
        domSnapshot: "<h1>Hello</h1>",
      })
      .expect(500);

    expect(response.body.error).toBe("Codex CLI is not logged in");
  });

  it("generates and runs a transform for extracted data", async () => {
    mockedGenerateJsonWithSchema.mockResolvedValue({
      version: 1,
      formatLabel: "Markdown",
      outputDescription: "Title as markdown",
      code: "return `# ${input.title}`;",
    });

    const response = await request(createApp())
      .post("/transform")
      .send({
        intent: "Extract title",
        outputRequest: "Convert to markdown",
        result: {
          ok: true,
          data: { title: "Hello" },
          debug: { mode: "single", rootMatchCount: 1, fields: [], errors: [] },
        },
      })
      .expect(200);

    expect(response.body.transform.formatLabel).toBe("Markdown");
    expect(response.body.exportResult.content).toBe("# Hello");
  });

  it("returns a local preview instead of executing risky export requests", async () => {
    const response = await request(createApp())
      .post("/transform")
      .send({
        intent: "Extract title",
        outputRequest: "Send this to a database",
        result: {
          ok: true,
          data: { title: "Hello" },
          debug: { mode: "single", rootMatchCount: 1, fields: [], errors: [] },
        },
      })
      .expect(200);

    expect(response.body.transform).toBeNull();
    expect(response.body.exportResult.formatLabel).toBe("Local JSON preview");
    expect(response.body.exportResult.warnings[0]).toContain("external actions");
    expect(mockedGenerateJsonWithSchema).not.toHaveBeenCalled();
  });

  it("refines an artifact through Codex", async () => {
    mockedGenerateJsonWithSchema.mockResolvedValue({
      recipe: validRecipe,
      transform: {
        version: 1,
        formatLabel: "JSON",
        outputDescription: "Compact JSON",
        code: "return JSON.stringify(input);",
      },
      outputDescription: "Extracted title as compact JSON",
    });

    const response = await request(createApp())
      .post("/refine")
      .send({
        url: "https://example.com/page",
        intent: "Extract title",
        feedback: "Return compact JSON",
        domSnapshot: "<h1>Hello</h1>",
        currentRecipe: validRecipe,
        currentResult: {
          ok: true,
          data: { title: "Hello" },
          debug: { mode: "single", rootMatchCount: 1, fields: [], errors: [] },
        },
      })
      .expect(200);

    expect(response.body.artifact.recipe).toEqual(validRecipe);
    expect(response.body.artifact.transform.formatLabel).toBe("JSON");
  });
});
