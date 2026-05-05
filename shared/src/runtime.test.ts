import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  actionPresetSchema,
  createDomSnapshot,
  createUrlPattern,
  executeRecipe,
  extractionProfileSchema,
  extractionRecipeSchema,
  matchesUrlPattern,
} from "./index.js";

function doc(html: string) {
  return new JSDOM(html, { url: "https://example.com/products/123" }).window.document;
}

describe("recipe schema", () => {
  it("accepts a valid list recipe", () => {
    const result = extractionRecipeSchema.safeParse({
      version: 1,
      mode: "list",
      rootSelector: ".item",
      fields: [{ name: "title", selector: ".title", value: "textContent", required: true }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects arbitrary script-like recipes", () => {
    const result = extractionRecipeSchema.safeParse({
      version: 1,
      mode: "single",
      code: "alert(1)",
      fields: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("configuration schema", () => {
  const validProfile = {
    id: "profile-1",
    name: "Example profile",
    urlPattern: "https://example.com/products/*",
    intent: "Extract product names",
    recipe: {
      version: 1,
      mode: "single",
      fields: [{ name: "title", selector: "h1", value: "textContent", required: true }],
    },
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
    version: 1,
  };

  it("accepts supported action presets", () => {
    expect(actionPresetSchema.safeParse({ type: "copy" }).success).toBe(true);
    expect(actionPresetSchema.safeParse({ type: "download" }).success).toBe(true);
    expect(actionPresetSchema.safeParse({ type: "copy_download" }).success).toBe(true);
  });

  it("rejects unknown action preset fields and types", () => {
    expect(actionPresetSchema.safeParse({ type: "send_webhook" }).success).toBe(false);
    expect(actionPresetSchema.safeParse({ type: "copy", script: "alert(1)" }).success).toBe(false);
  });

  it("migrates old profiles to the default copy action", () => {
    const profile = extractionProfileSchema.parse(validProfile);
    expect(profile.actionPreset).toEqual({ type: "copy" });
  });
});

describe("executeRecipe", () => {
  it("extracts list data and debug counts", () => {
    const document = doc(`
      <main>
        <article class="item"><a class="title" href="/a">A</a><span class="price">$1</span></article>
        <article class="item"><a class="title" href="/b">B</a><span class="price">$2</span></article>
      </main>
    `);
    const result = executeRecipe(
      {
        version: 1,
        mode: "list",
        rootSelector: ".item",
        fields: [
          { name: "title", selector: ".title", value: "textContent", required: true },
          { name: "url", selector: ".title", value: "href", required: true },
          { name: "price", selector: ".price", value: "textContent", required: false },
        ],
      },
      document,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { title: "A", url: "https://example.com/a", price: "$1" },
      { title: "B", url: "https://example.com/b", price: "$2" },
    ]);
    expect(result.debug.rootMatchCount).toBe(2);
  });

  it("reports required empty fields", () => {
    const result = executeRecipe(
      {
        version: 1,
        mode: "single",
        fields: [{ name: "title", selector: "h1", value: "textContent", required: true }],
      },
      doc("<main><p>No title</p></main>"),
    );

    expect(result.ok).toBe(false);
    expect(result.debug.errors[0]?.code).toBe("required_empty");
  });
});

describe("createDomSnapshot", () => {
  it("removes scripts and keeps extraction-relevant attributes", () => {
    const document = doc(`
      <body>
        <script>window.secret = true</script>
        <a class="product" href="/p/1" data-id="1" onclick="x()">Name</a>
        <img src="/img.jpg" alt="Photo" />
      </body>
    `);

    const snapshot = createDomSnapshot({ document });
    expect(snapshot).not.toContain("window.secret");
    expect(snapshot).toContain('href="/p/1"');
    expect(snapshot).toContain('data-id="1"');
    expect(snapshot).toContain('src="/img.jpg"');
    expect(snapshot).not.toContain("onclick");
  });

  it("limits snapshot size", () => {
    const snapshot = createDomSnapshot({
      document: doc(`<body><p>${"x".repeat(1000)}</p></body>`),
      maxChars: 100,
    });
    expect(snapshot.length).toBe(100);
  });
});

describe("url profiles", () => {
  it("creates and matches simple wildcard URL patterns", () => {
    const pattern = createUrlPattern("https://example.com/products/123");
    expect(pattern).toBe("https://example.com/products/*");
    expect(matchesUrlPattern(pattern, "https://example.com/products/456")).toBe(true);
    expect(matchesUrlPattern(pattern, "https://example.com/articles/456")).toBe(false);
  });

  it("generalizes article slugs under the same section", () => {
    const pattern = createUrlPattern("https://example.com/articles/my-useful-post");
    expect(pattern).toBe("https://example.com/articles/*");
    expect(matchesUrlPattern(pattern, "https://example.com/articles/another-post")).toBe(true);
    expect(matchesUrlPattern(pattern, "https://other.example.com/articles/another-post")).toBe(false);
  });

  it("does not generalize static asset filenames", () => {
    const pattern = createUrlPattern("https://example.com/assets/logo.png");
    expect(pattern).toBe("https://example.com/assets/logo.png");
  });
});
