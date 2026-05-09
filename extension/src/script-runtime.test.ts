import { afterEach, describe, expect, it, vi } from "vitest";
import { runScriptBody, runScriptBodyWithTimeout } from "./script-runtime.js";

describe("script runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns string output", () => {
    expect(runScriptBody("return input.toUpperCase();", "hello")).toBe("HELLO");
  });

  it("surfaces script throws", () => {
    expect(() => runScriptBody('throw new Error("bad script");', "hello")).toThrow("bad script");
  });

  it("rejects non-string output", () => {
    expect(() => runScriptBody("return { ok: true };", "hello")).toThrow("Script must return a string");
  });

  it("rejects oversized output", () => {
    expect(() => runScriptBody('return "abcdef";', "hello", 3)).toThrow("Script output is too large");
  });

  it("times out long-running scripts in a worker", async () => {
    class SilentWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal("Worker", SilentWorker);
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => {},
    });

    await expect(runScriptBodyWithTimeout("while (true) {}", "hello", 50)).rejects.toThrow("Script timed out");
  });
});
