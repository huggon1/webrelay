import { describe, expect, it } from "vitest";
import { buildArtifactPrompt } from "./prompts.js";

describe("artifact prompts", () => {
  it("uses distinct auto prompt language", () => {
    expect(buildArtifactPrompt({ url: "https://x.test", domSnapshot: "<main />", mode: "auto" })).toContain(
      "did not provide an explicit intent",
    );
  });

  it("uses distinct intent prompt language", () => {
    expect(
      buildArtifactPrompt({
        url: "https://x.test",
        domSnapshot: "<main />",
        mode: "intent",
        intent: "Extract prices",
      }),
    ).toContain("Extract prices");
  });

  it("uses base profile and run result in revise mode", () => {
    const prompt = buildArtifactPrompt({
      url: "https://x.test",
      domSnapshot: "<main />",
      mode: "revise",
      userNote: "Fix empty output",
      baseProfile: {
        id: "p",
        name: "P",
        urlPattern: "*://x.test/*",
        recipe: { version: 1, mode: "single", fields: [{ name: "title", selector: "h1", value: "textContent" }] },
        script: { version: 1, code: "return input;" },
        actionPreset: { type: "copy" },
        status: "ok",
        createdAt: "2026-05-09T00:00:00.000Z",
        updatedAt: "2026-05-09T00:00:00.000Z",
        version: 1,
      },
      baseRun: { ok: false, error: "Root not found" },
    });

    expect(prompt).toContain("Existing profile");
    expect(prompt).toContain("Root not found");
  });
});
