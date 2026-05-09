import { runScriptBody } from "./script-runtime.js";

type SandboxRequest = {
  id: string;
  type: "RUN_SCRIPT";
  code: string;
  input: string;
};

const workerSource = `
const runScriptBody = ${runScriptBody.toString()};
self.onmessage = (event) => {
  const { id, code, input } = event.data;
  try {
    const output = runScriptBody(code, input);
    self.postMessage({ id, ok: true, output });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
`;

function runInWorker(id: string, code: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([workerSource], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const timeout = window.setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error("Script timed out."));
    }, 5000);

    worker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; output?: string; error?: string }>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (event.data.ok && typeof event.data.output === "string") {
        resolve(event.data.output);
        return;
      }
      reject(new Error(event.data.error || "Script failed."));
    };

    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      reject(new Error(event.message || "Script worker failed."));
    };

    worker.postMessage({ id, code, input });
  });
}

window.addEventListener("message", (event: MessageEvent<SandboxRequest>) => {
  const message = event.data;
  if (!message || message.type !== "RUN_SCRIPT") return;

  void runInWorker(message.id, message.code, message.input)
    .then((output) => {
      event.source?.postMessage({ id: message.id, ok: true, output }, { targetOrigin: "*" });
    })
    .catch((error: unknown) => {
      event.source?.postMessage(
        {
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { targetOrigin: "*" },
      );
    });
});
