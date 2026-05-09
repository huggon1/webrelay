export const MAX_SCRIPT_OUTPUT_LENGTH = 1_000_000;

export function runScriptBody(code: string, input: string, maxOutputLength = 1_000_000) {
  const transform = new Function("input", '"use strict";\n' + code) as (input: string) => unknown;
  const output = transform(input);
  if (typeof output !== "string") {
    throw new Error("Script must return a string.");
  }
  if (output.length > maxOutputLength) {
    throw new Error("Script output is too large.");
  }
  return output;
}

export function runScriptBodyWithTimeout(code: string, input: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const workerSource = `
      const runScriptBody = ${runScriptBody.toString()};
      self.onmessage = (event) => {
        const { code, input } = event.data;
        try {
          self.postMessage({ ok: true, output: runScriptBody(code, input) });
        } catch (error) {
          self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      };
    `;
    const blob = new Blob([workerSource], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error("Script timed out."));
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<{ ok: boolean; output?: string; error?: string }>) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (event.data.ok && typeof event.data.output === "string") {
        resolve(event.data.output);
        return;
      }
      reject(new Error(event.data.error || "Script failed."));
    };

    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(event.message || "Script worker failed."));
    };

    worker.postMessage({ code, input });
  });
}
