import cors from "cors";
import express from "express";
import {
  exportResultSchema,
  executionDebugSchema,
  extractionArtifactSchema,
  extractionRecipeSchema,
  extractionResultSchema,
  transformSpecSchema,
  type ExtractionArtifact,
  type ExtractionRecipe,
  type TransformSpec,
} from "@extractor/shared";
import { z } from "zod";
import {
  artifactOutputSchema,
  generateJsonFromLLM,
  generateJsonWithSchema,
  transformOutputSchema,
} from "./llm.js";
import { buildGeneratePrompt, buildRefinePrompt, buildRepairPrompt, buildTransformPrompt } from "./prompts.js";
import { detectRiskyRequest, runTransform, safePreviewExport, validateTransformSpec } from "./transform.js";

const generateRequestSchema = z.object({
  url: z.string().url(),
  intent: z.string().min(1),
  domSnapshot: z.string().min(1),
});

const repairRequestSchema = generateRequestSchema.extend({
  oldRecipe: extractionRecipeSchema,
  debug: executionDebugSchema,
  failureReason: z.string().min(1),
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

export function createApp() {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, provider: "codex" });
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

  app.post("/repair-recipe", async (req, res) => {
    try {
      const input = repairRequestSchema.parse(req.body);
      const candidate = await generateJsonFromLLM(buildRepairPrompt(input));
      res.json({ recipe: parseRecipe(candidate) });
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json(serializeError(error));
    }
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

  return app;
}
