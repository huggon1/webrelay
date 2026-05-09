import cors from "cors";
import express from "express";
import {
  baseRunSchema,
  extractionArtifactSchema,
  extractionProfileSchema,
  type CodexProgressEvent,
} from "@extractor/shared";
import { z } from "zod";
import {
  artifactOutputSchema,
  generateJsonWithSchema,
  generateJsonWithSchemaStreamed,
  intentAnalysisOutputSchema,
} from "./llm.js";
import { buildAnalyzeIntentPrompt, buildArtifactPrompt } from "./prompts.js";

const analyzeIntentRequestSchema = z.object({
  url: z.string().min(1),
  domSnapshot: z.string().min(1),
});

const generateArtifactRequestSchema = z
  .object({
    url: z.string().min(1),
    domSnapshot: z.string().min(1),
    mode: z.enum(["auto", "intent", "revise"]),
    intent: z.string().min(1).optional(),
    baseProfile: extractionProfileSchema.optional(),
    baseRun: baseRunSchema.optional(),
    userNote: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.mode === "intent" && !input.intent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intent is required in intent mode",
        path: ["intent"],
      });
    }
    if (input.mode === "revise") {
      if (!input.baseProfile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "baseProfile is required in revise mode",
          path: ["baseProfile"],
        });
      }
      if (!input.baseRun) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "baseRun is required in revise mode",
          path: ["baseRun"],
        });
      }
      if (!input.userNote && !input.intent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "userNote or intent is required in revise mode",
          path: ["userNote"],
        });
      }
    }
  });

function serializeError(error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    issues: error instanceof z.ZodError ? error.issues : undefined,
  };
}

function parseArtifact(candidate: unknown) {
  return extractionArtifactSchema.parse(candidate);
}

function writeSseEvent(res: express.Response, event: CodexProgressEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function startSse(res: express.Response) {
  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
}

async function withSse(res: express.Response, work: (emit: (event: CodexProgressEvent) => void) => Promise<void>) {
  startSse(res);
  const emit = (event: CodexProgressEvent) => writeSseEvent(res, event);
  try {
    await work(emit);
  } catch (error) {
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    res.end();
  }
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, provider: "codex" });
  });

  app.post("/analyze-intent", async (req, res) => {
    try {
      const input = analyzeIntentRequestSchema.parse(req.body);
      const candidate = await generateJsonWithSchema(buildAnalyzeIntentPrompt(input), intentAnalysisOutputSchema);
      res.json({ analysis: candidate });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/generate-artifact/stream", async (req, res) => {
    await withSse(res, async (emit) => {
      emit({ type: "stage", message: "Validating request" });
      const input = generateArtifactRequestSchema.parse(req.body);
      const candidate = await generateJsonWithSchemaStreamed(
        buildArtifactPrompt(input),
        artifactOutputSchema,
        {},
        emit,
      );
      emit({ type: "stage", message: "Validating artifact schema" });
      const artifact = parseArtifact(candidate);
      emit({ type: "artifact", artifactType: "recipe", label: "Recipe JSON", content: artifact.recipe });
      emit({ type: "artifact", artifactType: "script", label: "Script body", content: artifact.script.code });
      emit({ type: "done", result: { artifact } });
    });
  });

  return app;
}
