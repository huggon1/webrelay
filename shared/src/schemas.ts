import { z } from "zod";

export const valueSourceSchema = z.enum([
  "textContent",
  "innerText",
  "attribute",
  "href",
  "src",
]);

export const fieldRuleSchema = z
  .object({
    name: z.string().min(1),
    selector: z.string().min(1).optional(),
    value: valueSourceSchema,
    attribute: z.string().min(1).optional(),
    required: z.boolean().default(false),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.value === "attribute" && !field.attribute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attribute is required when value is attribute",
        path: ["attribute"],
      });
    }
  });

export const extractionRecipeSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["single", "list"]),
    rootSelector: z.string().min(1).optional(),
    fields: z.array(fieldRuleSchema).min(1),
  })
  .strict()
  .superRefine((recipe, ctx) => {
    if (recipe.mode === "list" && !recipe.rootSelector) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "rootSelector is required in list mode",
        path: ["rootSelector"],
      });
    }
  });

export const scriptConfigSchema = z
  .object({
    version: z.literal(1),
    code: z.string().min(1),
  })
  .strict();

export const extractionArtifactSchema = z
  .object({
    recipe: extractionRecipeSchema,
    script: scriptConfigSchema,
    outputDescription: z.string().min(1).optional(),
  })
  .strict();

export const actionPresetSchema = z
  .object({
    type: z.enum(["copy", "download", "copy_download"]),
  })
  .strict();

export const extractionProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    urlPattern: z.string().min(1),
    recipe: extractionRecipeSchema,
    script: scriptConfigSchema,
    actionPreset: actionPresetSchema,
    status: z.enum(["ok", "possibly_failed"]).default("ok"),
    lastRunAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    version: z.number().int().positive(),
  })
  .strict();

export const lastUsedStateSchema = z
  .object({
    siteId: z.string().min(1),
    profileId: z.string().min(1),
    urlPattern: z.string().min(1),
    lastRunAt: z.string().datetime(),
    lastActionPreset: actionPresetSchema,
  })
  .strict();

export const executionErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  })
  .strict();

export const fieldDebugSchema = z
  .object({
    name: z.string(),
    selector: z.string().optional(),
    matchCount: z.number().int().nonnegative(),
    emptyCount: z.number().int().nonnegative(),
  })
  .strict();

export const executionDebugSchema = z
  .object({
    mode: z.enum(["single", "list"]),
    rootSelector: z.string().optional(),
    rootMatchCount: z.number().int().nonnegative(),
    fields: z.array(fieldDebugSchema),
    errors: z.array(executionErrorSchema),
  })
  .strict();

export const extractionResultSchema = z
  .object({
    ok: z.boolean(),
    data: z.unknown(),
    debug: executionDebugSchema,
  })
  .strict();

export const baseRunSchema = z
  .object({
    ok: z.boolean(),
    extraction: extractionResultSchema.optional(),
    scriptInput: z.string().optional(),
    output: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();

export type ValueSource = z.infer<typeof valueSourceSchema>;
export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type ExtractionRecipe = z.infer<typeof extractionRecipeSchema>;
export type ScriptConfig = z.infer<typeof scriptConfigSchema>;
export type ExtractionArtifact = z.infer<typeof extractionArtifactSchema>;
export type ActionPreset = z.infer<typeof actionPresetSchema>;
export type ExtractionProfile = z.infer<typeof extractionProfileSchema>;
export type LastUsedState = z.infer<typeof lastUsedStateSchema>;
export type ExecutionError = z.infer<typeof executionErrorSchema>;
export type FieldDebug = z.infer<typeof fieldDebugSchema>;
export type ExecutionDebug = z.infer<typeof executionDebugSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type BaseRun = z.infer<typeof baseRunSchema>;
