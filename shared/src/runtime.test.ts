import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  createUrlPattern,
  executeRecipe,
  extractionProfileSchema,
  extractionRecipeSchema,
  matchesUrlPattern,
} from "./index.js";

function doc(html: string) {
  return new JSDOM(html, { url: "https://example.com/chatbot.html" }).window.document;
}

describe("recipe schema", () => {
  it("accepts a valid list recipe", () => {
    expect(
      extractionRecipeSchema.safeParse({
        version: 1,
        mode: "list",
        rootSelector: ".chat-message",
        fields: [{ name: "text", selector: ".message-text", value: "textContent", required: true }],
      }).success,
    ).toBe(true);
  });

  it("rejects list recipes without rootSelector", () => {
    expect(
      extractionRecipeSchema.safeParse({
        version: 1,
        mode: "list",
        fields: [{ name: "text", selector: ".message-text", value: "textContent" }],
      }).success,
    ).toBe(false);
  });
});

describe("profile schema", () => {
  it("requires a script for new profiles", () => {
    const base = {
      id: "profile-1",
      name: "Chat to Markdown",
      urlPattern: "*://example.com/*",
      recipe: {
        version: 1,
        mode: "list",
        rootSelector: ".chat-message",
        fields: [{ name: "text", selector: ".message-text", value: "textContent", required: true }],
      },
      actionPreset: { type: "copy" },
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
      version: 1,
    };

    expect(extractionProfileSchema.safeParse(base).success).toBe(false);
    expect(
      extractionProfileSchema.safeParse({
        ...base,
        script: { version: 1, code: "return input;" },
      }).success,
    ).toBe(true);
  });
});

describe("executeRecipe", () => {
  it("extracts chatbot messages with debug counts", () => {
    const result = executeRecipe(
      {
        version: 1,
        mode: "list",
        rootSelector: ".chat-message",
        fields: [
          { name: "role", value: "attribute", attribute: "data-role", required: true },
          { name: "time", selector: ".message-time", value: "textContent", required: true },
          { name: "text", selector: ".message-text", value: "textContent", required: true },
        ],
      },
      doc(`
        <article class="chat-message" data-role="user">
          <time class="message-time">09:00</time>
          <div class="message-text">Summarize this.</div>
        </article>
        <article class="chat-message" data-role="assistant">
          <time class="message-time">09:01</time>
          <div class="message-text">Summary.</div>
        </article>
      `),
    );

    expect(result.ok).toBe(true);
    expect(result.debug.rootMatchCount).toBe(2);
    expect(result.data).toEqual([
      { role: "user", time: "09:00", text: "Summarize this." },
      { role: "assistant", time: "09:01", text: "Summary." },
    ]);
  });
});

describe("url profiles", () => {
  it("matches hostname-wide URL patterns", () => {
    const pattern = createUrlPattern("https://example.com/chatbot.html");
    expect(pattern).toBe("*://example.com/*");
    expect(matchesUrlPattern(pattern, "https://example.com/other")).toBe(true);
    expect(matchesUrlPattern(pattern, "https://other.example.com/chatbot.html")).toBe(false);
  });

  it("supports local file test pages", () => {
    const pattern = createUrlPattern("file:///D:/extractor/test-pages/chatbot.html");
    expect(pattern).toBe("file:///*");
    expect(matchesUrlPattern(pattern, "file:///D:/extractor/test-pages/other.html")).toBe(true);
    expect(matchesUrlPattern(pattern, "https://example.com/chatbot.html")).toBe(false);
  });
});
