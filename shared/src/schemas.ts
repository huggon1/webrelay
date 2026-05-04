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

export const extractionProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    urlPattern: z.string().min(1),
    intent: z.string().min(1),
    recipe: extractionRecipeSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    version: z.number().int().positive(),
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

export type ValueSource = z.infer<typeof valueSourceSchema>;
export type FieldRule = z.infer<typeof fieldRuleSchema>;
export type ExtractionRecipe = z.infer<typeof extractionRecipeSchema>;
export type ExtractionProfile = z.infer<typeof extractionProfileSchema>;
export type ExecutionError = z.infer<typeof executionErrorSchema>;
export type FieldDebug = z.infer<typeof fieldDebugSchema>;
export type ExecutionDebug = z.infer<typeof executionDebugSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
