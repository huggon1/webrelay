import cors from "cors";
import express from "express";
import {
  exportResultSchema,
  extractionArtifactSchema,
  extractionRecipeSchema,
  extractionResultSchema,
  transformSpecSchema,
  type CodexProgressEvent,
  type ExtractionArtifact,
  type ExtractionRecipe,
  type TransformSpec,
} from "@extractor/shared";
import { z } from "zod";
import {
  artifactOutputSchema,
  generateJsonFromLLM,
  generateJsonFromLLMStreamed,
  generateJsonWithSchema,
  generateJsonWithSchemaStreamed,
  intentAnalysisOutputSchema,
  transformOutputSchema,
} from "./llm.js";
import { buildAnalyzeIntentPrompt, buildGeneratePrompt, buildRefinePrompt, buildRepairPrompt, buildTransformPrompt } from "./prompts.js";
import { detectRiskyRequest, runTransform, safePreviewExport, validateTransformSpec } from "./transform.js";

const generateRequestSchema = z.object({
  url: z.string().url(),
  intent: z.string().min(1),
  domSnapshot: z.string().min(1),
  confirmedFields: z.array(z.string().min(1)).optional(),
});

const analyzeIntentRequestSchema = z.object({
  url: z.string().url(),
  domSnapshot: z.string().min(1),
});

const repairRequestSchema = z.object({
  url: z.string().url(),
  intent: z.string().min(1),
  domSnapshot: z.string().min(1),
  oldRecipe: extractionRecipeSchema,
  userNote: z.string().optional(),
});

const transformRequestSchema = z.object({
  intent: z.string().min(1),
  outputRequest: z.string().min(1),
  result: extractionResultSchema,
});

const runTransformRequestSchema = z.object({
  transform: transformSpecSchema,
  data: z.unknown(),
});

const refineRequestSchema = generateRequestSchema.extend({
  feedback: z.string().min(1),
  currentRecipe: extractionRecipeSchema,
  currentResult: extractionResultSchema,
});

function parseRecipe(candidate: unknown): ExtractionRecipe {
  return extractionRecipeSchema.parse(candidate);
}

function parseTransform(candidate: unknown): TransformSpec {
  const transform = transformSpecSchema.parse(candidate);
  validateTransformSpec(transform);
  return transform;
}

function parseArtifact(candidate: unknown): ExtractionArtifact {
  const artifact = extractionArtifactSchema.parse(candidate);
  if (artifact.transform) validateTransformSpec(artifact.transform);
  return artifact;
}

function serializeError(error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    issues: error instanceof z.ZodError ? error.issues : undefined,
  };
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
      const raw = candidate as { pageDescription: string; suggestedMode: string; suggestedFields: { name: string; description: string; example: string | null }[] };
      const analysis = {
        pageDescription: raw.pageDescription,
        suggestedMode: raw.suggestedMode as "single" | "list",
        suggestedFields: raw.suggestedFields.map((f) => ({
          name: f.name,
          description: f.description,
          example: f.example ?? undefined,
        })),
      };
      res.json({ analysis });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/generate-recipe", async (req, res) => {
    try {
      const input = generateRequestSchema.parse(req.body);
      const candidate = await generateJsonFromLLM(buildGeneratePrompt(input));
      res.json({ recipe: parseRecipe(candidate) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/generate-recipe/stream", async (req, res) => {
    await withSse(res, async (emit) => {
      emit({ type: "stage", message: "Validating request" });
      const input = generateRequestSchema.parse(req.body);
      const candidate = await generateJsonFromLLMStreamed(buildGeneratePrompt(input), {}, emit);
      emit({ type: "stage", message: "Validating recipe schema" });
      const recipe = parseRecipe(candidate);
      emit({ type: "artifact", artifactType: "recipe", label: "Recipe JSON", content: recipe });
      emit({ type: "done", result: { recipe } });
    });
  });

  app.post("/repair-recipe", async (req, res) => {
    try {
      const input = repairRequestSchema.parse(req.body);
      const candidate = await generateJsonFromLLM(buildRepairPrompt(input), {});
      res.json({ recipe: parseRecipe(candidate) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/repair-recipe/stream", async (req, res) => {
    await withSse(res, async (emit) => {
      emit({ type: "stage", message: "Validating request" });
      const input = repairRequestSchema.parse(req.body);
      const candidate = await generateJsonFromLLMStreamed(buildRepairPrompt(input), {}, emit);
      emit({ type: "stage", message: "Validating recipe schema" });
      const recipe = parseRecipe(candidate);
      emit({ type: "artifact", artifactType: "recipe", label: "Repaired recipe JSON", content: recipe });
      emit({ type: "done", result: { recipe } });
    });
  });

  app.post("/transform", async (req, res) => {
    try {
      const input = transformRequestSchema.parse(req.body);
      if (detectRiskyRequest(input.outputRequest)) {
        const warning =
          "This request appears to involve external actions or local system access. WebRelay v1 only creates a local preview; configure external actions in a later trusted workflow.";
        res.json({ transform: null, exportResult: safePreviewExport(input.result.data, warning) });
        return;
      }
      const candidate = await generateJsonWithSchema(buildTransformPrompt(input), transformOutputSchema, {
        allowTransformCode: true,
      });
      const transform = parseTransform(candidate);
      res.json({ transform, exportResult: exportResultSchema.parse(runTransform(transform, input.result.data)) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/transform/stream", async (req, res) => {
    await withSse(res, async (emit) => {
      emit({ type: "stage", message: "Validating request" });
      const input = transformRequestSchema.parse(req.body);
      if (detectRiskyRequest(input.outputRequest)) {
        const warning =
          "This request appears to involve external actions or local system access. WebRelay v1 only creates a local preview; configure external actions in a later trusted workflow.";
        const exportResult = safePreviewExport(input.result.data, warning);
        emit({ type: "artifact", artifactType: "result", label: "Local JSON preview", content: exportResult.content });
        emit({ type: "done", result: { transform: null, exportResult } });
        return;
      }
      const candidate = await generateJsonWithSchemaStreamed(buildTransformPrompt(input), transformOutputSchema, {
        allowTransformCode: true,
      }, emit);
      emit({ type: "stage", message: "Validating transform schema" });
      const transform = parseTransform(candidate);
      emit({ type: "artifact", artifactType: "transform", label: "Transform code", content: transform.code });
      emit({ type: "stage", message: "Running local transform preview" });
      const exportResult = exportResultSchema.parse(runTransform(transform, input.result.data));
      emit({ type: "artifact", artifactType: "result", label: "Formatted preview", content: exportResult.content });
      emit({ type: "done", result: { transform, exportResult } });
    });
  });

  app.post("/run-transform", async (req, res) => {
    try {
      const input = runTransformRequestSchema.parse(req.body);
      res.json({ exportResult: exportResultSchema.parse(runTransform(input.transform, input.data)) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/refine", async (req, res) => {
    try {
      const input = refineRequestSchema.parse(req.body);
      if (detectRiskyRequest(input.feedback)) {
        const warning =
          "This feedback appears to request external actions or local system access. WebRelay v1 keeps refinement local and returns a preview-only artifact.";
        res.json({
          artifact: {
            recipe: input.currentRecipe,
            outputDescription: "Preview-only artifact; external actions were not configured.",
          },
          exportResult: safePreviewExport(input.currentResult.data, warning),
        });
        return;
      }
      const candidate = await generateJsonWithSchema(buildRefinePrompt(input), artifactOutputSchema, {
        allowTransformCode: true,
      });
      res.json({ artifact: parseArtifact(candidate) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
  });

  app.post("/refine/stream", async (req, res) => {
    await withSse(res, async (emit) => {
      emit({ type: "stage", message: "Validating request" });
      const input = refineRequestSchema.parse(req.body);
      if (detectRiskyRequest(input.feedback)) {
        const warning =
          "This feedback appears to request external actions or local system access. WebRelay v1 keeps refinement local and returns a preview-only artifact.";
        const exportResult = safePreviewExport(input.currentResult.data, warning);
        const artifact = {
          recipe: input.currentRecipe,
          outputDescription: "Preview-only artifact; external actions were not configured.",
        };
        emit({ type: "artifact", artifactType: "recipe", label: "Current recipe JSON", content: input.currentRecipe });
        emit({ type: "artifact", artifactType: "result", label: "Local JSON preview", content: exportResult.content });
        emit({ type: "done", result: { artifact, exportResult } });
        return;
      }
      const candidate = await generateJsonWithSchemaStreamed(buildRefinePrompt(input), artifactOutputSchema, {
        allowTransformCode: true,
      }, emit);
      emit({ type: "stage", message: "Validating artifact schema" });
      const artifact = parseArtifact(candidate);
      emit({ type: "artifact", artifactType: "recipe", label: "Recipe JSON", content: artifact.recipe });
      if (artifact.transform) {
        emit({ type: "artifact", artifactType: "transform", label: "Transform code", content: artifact.transform.code });
      }
      emit({ type: "done", result: { artifact } });
    });
  });

  return app;
}
