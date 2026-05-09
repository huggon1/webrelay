import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm.js", () => ({
  artifactOutputSchema: {},
  intentAnalysisOutputSchema: {},
  generateJsonWithSchema: vi.fn(),
  generateJsonWithSchemaStreamed: vi.fn(),
}));

const { createApp } = await import("./app.js");
const { generateJsonWithSchema, generateJsonWithSchemaStreamed } = await import("./llm.js");

const mockedGenerateJsonWithSchema = vi.mocked(generateJsonWithSchema);
const mockedGenerateJsonWithSchemaStreamed = vi.mocked(generateJsonWithSchemaStreamed);

const artifact = {
  recipe: {
    version: 1,
    mode: "list",
    rootSelector: ".chat-message",
    fields: [{ name: "text", selector: ".message-text", value: "textContent", required: true }],
  },
  script: {
    version: 1,
    code: "const messages = JSON.parse(input); return messages.map((m) => m.text).join('\\n');",
  },
  outputDescription: "Markdown transcript",
};

const profile = {
  id: "profile-1",
  name: "Chat",
  urlPattern: "file:///*",
  recipe: artifact.recipe,
  script: artifact.script,
  actionPreset: { type: "copy" },
  status: "ok",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
  version: 1,
};

describe("backend app", () => {
  beforeEach(() => {
    mockedGenerateJsonWithSchema.mockReset();
    mockedGenerateJsonWithSchemaStreamed.mockReset();
  });

  it("reports Codex provider", async () => {
    const response = await request(createApp()).get("/health").expect(200);
    expect(response.body).toEqual({ ok: true, provider: "codex" });
  });

  it("streams an auto artifact", async () => {
    mockedGenerateJsonWithSchemaStreamed.mockResolvedValue(artifact);
    const response = await request(createApp())
      .post("/generate-artifact/stream")
      .send({
        url: "file:///chatbot.html",
        domSnapshot: "<article class='chat-message'>hello</article>",
        mode: "auto",
      })
      .expect(200);

    expect(response.text).toContain('"type":"done"');
    expect(response.text).toContain('"artifact"');
    expect(mockedGenerateJsonWithSchemaStreamed.mock.calls[0]?.[0]).toContain("did not provide an explicit intent");
  });

  it("streams an intent artifact with user intent in prompt", async () => {
    mockedGenerateJsonWithSchemaStreamed.mockResolvedValue(artifact);
    await request(createApp())
      .post("/generate-artifact/stream")
      .send({
        url: "file:///chatbot.html",
        domSnapshot: "<article class='chat-message'>hello</article>",
        mode: "intent",
        intent: "Extract chat as markdown",
      })
      .expect(200);

    expect(mockedGenerateJsonWithSchemaStreamed.mock.calls[0]?.[0]).toContain("Extract chat as markdown");
  });

  it("streams a revise artifact with base run context", async () => {
    mockedGenerateJsonWithSchemaStreamed.mockResolvedValue(artifact);
    await request(createApp())
      .post("/generate-artifact/stream")
      .send({
        url: "file:///chatbot.html",
        domSnapshot: "<article class='chat-message'>hello</article>",
        mode: "revise",
        baseProfile: profile,
        baseRun: { ok: true, output: "### user", scriptInput: "[]" },
        userNote: "Rename user to Human",
      })
      .expect(200);

    const prompt = mockedGenerateJsonWithSchemaStreamed.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("Existing profile");
    expect(prompt).toContain("Rename user to Human");
  });

  it("rejects revise requests without base profile", async () => {
    const response = await request(createApp())
      .post("/generate-artifact/stream")
      .send({
        url: "file:///chatbot.html",
        domSnapshot: "<article class='chat-message'>hello</article>",
        mode: "revise",
        userNote: "Fix it",
      })
      .expect(200);

    expect(response.text).toContain('"type":"error"');
    expect(mockedGenerateJsonWithSchemaStreamed).not.toHaveBeenCalled();
  });
});
