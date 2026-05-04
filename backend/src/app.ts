import cors from "cors";
import express from "express";
import {
  executionDebugSchema,
  extractionRecipeSchema,
  type ExtractionRecipe,
} from "@extractor/shared";
import { z } from "zod";
import { generateJsonFromLLM } from "./llm.js";
import { buildGeneratePrompt, buildRepairPrompt } from "./prompts.js";

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

function parseRecipe(candidate: unknown): ExtractionRecipe {
  return extractionRecipeSchema.parse(candidate);
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

  return app;
}
