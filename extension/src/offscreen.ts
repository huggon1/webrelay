type OffscreenCopyRequest = {
  type: "OFFSCREEN_COPY";
  content: string;
};

type OffscreenTransformRequest = {
  type: "OFFSCREEN_TRANSFORM";
  id: string;
  transform: { code: string; formatLabel: string };
  data: unknown;
};

type OffscreenRequest = OffscreenCopyRequest | OffscreenTransformRequest;

function copyWithHiddenTextarea(content: string) {
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("document.execCommand('copy') returned false.");
}

// ── Sandbox transform relay ────────────────────────────────────────────────

const sandboxFrame = document.getElementById("transform-sandbox") as HTMLIFrameElement;
let sandboxReady = false;
const pendingTransforms = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

sandboxFrame.addEventListener("load", () => { sandboxReady = true; }, { once: true });

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== sandboxFrame.contentWindow) return;
  const msg = event.data as { id?: string; ok?: boolean; exportResult?: unknown; error?: string } | null;
  if (!msg?.id) return;
  const pending = pendingTransforms.get(msg.id);
  if (!pending) return;
  pendingTransforms.delete(msg.id);
  if (msg.ok) {
    pending.resolve(msg.exportResult);
  } else {
    pending.reject(new Error(msg.error ?? "Sandbox transform failed."));
  }
});

function waitForSandbox(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (sandboxReady) { resolve(); return; }
    sandboxFrame.addEventListener("load", () => resolve(), { once: true });
  });
}

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: OffscreenRequest, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_COPY") {
    try {
      copyWithHiddenTextarea(message.content);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return false;
  }

  if (message.type === "OFFSCREEN_TRANSFORM") {
    const { id, transform, data } = message;
    void waitForSandbox().then(() => {
      const timeoutId = window.setTimeout(() => {
        pendingTransforms.delete(id);
        sendResponse({ ok: false, error: "Transform sandbox timed out." });
      }, 5000);

      pendingTransforms.set(id, {
        resolve: (exportResult) => {
          window.clearTimeout(timeoutId);
          sendResponse({ ok: true, exportResult });
        },
        reject: (error: Error) => {
          window.clearTimeout(timeoutId);
          sendResponse({ ok: false, error: error.message });
        },
      });

      sandboxFrame.contentWindow?.postMessage({ id, type: "RUN_TRANSFORM", transform, data }, "*");
    });
    return true; // keep channel open for async response
  }

  return false;
});
