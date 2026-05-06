import type {
  ActionPreset,
  ExportResult,
  ExtractionProfile,
  ExtractionRecipe,
  ExtractionResult,
  TransformSpec,
} from "@extractor/shared";

// ── Content script messages ────────────────────────────────────────────────

export type ContentRequest =
  | { type: "CREATE_SNAPSHOT" }
  | { type: "RUN_RECIPE"; recipe: ExtractionRecipe }
  | { type: "SHOW_TOAST"; message: string; variant: ToastVariant };

export type ContentResponse =
  | { ok: true; snapshot: string; url: string }
  | { ok: true; result: ExtractionResult }
  | { ok: true }
  | { ok: false; error: string };

export type ToastVariant = "success" | "error" | "info";

// ── Suggested field proposal from /analyze-intent ─────────────────────────

export interface SuggestedField {
  name: string;
  description: string;
  example?: string;
}

export interface IntentAnalysis {
  pageDescription: string;
  suggestedFields: SuggestedField[];
  suggestedMode: "single" | "list";
}

// ── Background request/response ────────────────────────────────────────────

export type BackgroundRequest =
  // ── Tab / snapshot utilities ──────────────────────────────────────────
  | { type: "GET_ACTIVE_TAB" }
  | { type: "CREATE_SNAPSHOT" }

  // ── Quick Run (purely frontend, no Codex required) ────────────────────
  | { type: "LIST_PROFILES_FOR_SITE"; url: string }
  | {
      type: "RUN_PROFILE";
      profileId: string;
      /** Override the profile's saved actionPreset for this run */
      actionPresetOverride?: ActionPreset;
    }

  // ── Codex Studio — Entry A: auto-analyze page ─────────────────────────
  | { type: "ANALYZE_INTENT"; domSnapshot: string; url: string }

  // ── Codex Studio — Entry A/B: generate recipe ─────────────────────────
  | {
      type: "GENERATE_RECIPE";
      intent: string;
      domSnapshot: string;
      url: string;
      /** Confirmed field names from ANALYZE_INTENT proposal (optional) */
      confirmedFields?: string[];
    }

  // ── Codex Studio — Step 3: refine recipe based on feedback ────────────
  | {
      type: "REFINE_RECIPE";
      feedback: string;
      intent: string;
      currentRecipe: ExtractionRecipe;
      currentResult: ExtractionResult;
      domSnapshot: string;
      url: string;
    }

  // ── Codex Studio — Step 4: generate JS transform for output format ─────
  | {
      type: "GENERATE_TRANSFORM";
      outputRequest: string;
      intent: string;
      result: ExtractionResult;
    }

  // ── Codex Studio — Entry C: repair a failed profile ───────────────────
  | {
      type: "REPAIR_RECIPE";
      profileId: string;
      domSnapshot: string;
      url: string;
      userNote?: string;
    }

  // ── Profile CRUD ───────────────────────────────────────────────────────
  | { type: "LIST_ALL_PROFILES" }
  | { type: "SAVE_PROFILE"; profile: ExtractionProfile }
  | { type: "UPDATE_PROFILE"; profileId: string; updates: Partial<ExtractionProfile> }
  | { type: "DELETE_PROFILE"; profileId: string };

export type BackgroundResponse =
  | { ok: true; tab: { id: number; url: string; title: string } }
  | { ok: true; snapshot: string; url: string }
  | { ok: true; profiles: ExtractionProfile[] }
  | { ok: true; profile: ExtractionProfile }
  | { ok: true; analysis: IntentAnalysis }
  | { ok: true; recipe: ExtractionRecipe; result: ExtractionResult }
  | { ok: true; recipe: ExtractionRecipe; result: ExtractionResult; transform: TransformSpec | null; exportResult: ExportResult }
  | { ok: true; transform: TransformSpec | null; exportResult: ExportResult }
  | { ok: true; result: ExtractionResult; exportResult?: ExportResult; actionResult: ActionRunResult }
  | { ok: false; error: string };

export interface ActionRunResult {
  copied: boolean;
  downloaded: boolean;
  errors: string[];
}
