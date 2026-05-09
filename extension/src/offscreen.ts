import type { OffscreenRequest, OffscreenResponse } from "./messages.js";

const sandboxFrame = document.getElementById("script-sandbox") as HTMLIFrameElement;
let sandboxReady = false;

sandboxFrame.addEventListener("load", () => {
  sandboxReady = true;
});

function waitForSandbox(): Promise<void> {
  if (sandboxReady) return Promise.resolve();
  return new Promise((resolve) => {
    sandboxFrame.addEventListener("load", () => resolve(), { once: true });
  });
}

function copyWithHiddenTextarea(content: string) {
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
  });
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard write failed.");
}

function runScriptInSandbox(id: string, code: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Script timed out."));
    }, 5000);

    function onMessage(event: MessageEvent) {
      if (event.source !== sandboxFrame.contentWindow) return;
      const message = event.data as { id?: string; ok?: boolean; output?: string; error?: string } | null;
      if (!message || message.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (message.ok && typeof message.output === "string") {
        resolve(message.output);
        return;
      }
      reject(new Error(message.error || "Script failed."));
    }

    window.addEventListener("message", onMessage);
    sandboxFrame.contentWindow?.postMessage({ id, type: "RUN_SCRIPT", code, input }, "*");
  });
}

chrome.runtime.onMessage.addListener(
  (message: OffscreenRequest, _sender, sendResponse: (response: OffscreenResponse) => void) => {
    if (message.type === "OFFSCREEN_COPY") {
      try {
        copyWithHiddenTextarea(message.content);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return false;
    }

    if (message.type === "OFFSCREEN_RUN_SCRIPT") {
      void waitForSandbox()
        .then(() => runScriptInSandbox(message.id, message.code, message.input))
        .then((output) => sendResponse({ ok: true, output }))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
        );
      return true;
    }

    return false;
  },
);
