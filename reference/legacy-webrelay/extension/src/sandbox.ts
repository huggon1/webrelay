import { runTransform } from "./transform-runtime.js";
import type { TransformSpec } from "@extractor/shared";

type SandboxRequest = {
  id: string;
  type: "RUN_TRANSFORM";
  transform: unknown;
  data: unknown;
};

window.addEventListener("message", (event: MessageEvent<SandboxRequest>) => {
  const message = event.data;
  if (!message || message.type !== "RUN_TRANSFORM") return;

  try {
    const exportResult = runTransform(message.transform as TransformSpec, message.data);
    event.source?.postMessage({ id: message.id, ok: true, exportResult }, { targetOrigin: event.origin });
  } catch (error) {
    event.source?.postMessage(
      {
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { targetOrigin: event.origin },
    );
  }
});
