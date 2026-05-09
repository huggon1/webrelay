import { describe, expect, it } from "vitest";
import { selectGenerateMode } from "./studio-mode.js";

describe("selectGenerateMode", () => {
  it("uses auto without base profile or instructions", () => {
    expect(selectGenerateMode(false, "  ")).toBe("auto");
  });

  it("uses intent without base profile and with instructions", () => {
    expect(selectGenerateMode(false, "extract the chat")).toBe("intent");
  });

  it("uses revise whenever a base profile is selected", () => {
    expect(selectGenerateMode(true, "fix labels")).toBe("revise");
  });
});
