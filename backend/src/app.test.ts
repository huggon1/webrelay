import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm.js", () => ({
  generateJsonFromLLM: vi.fn(),
}));

const { createApp } = await import("./app.js");
const { generateJsonFromLLM } = await import("./llm.js");

const mockedGenerateJson = vi.mocked(generateJsonFromLLM);

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
});
