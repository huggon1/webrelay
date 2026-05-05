import type {
  ActionPreset,
  ExportResult,
  ExecutionDebug,
  ExtractionArtifact,
  ExtractionProfile,
  ExtractionRecipe,
  ExtractionResult,
  TransformSpec,
} from "@extractor/shared";

export type ContentRequest =
  | { type: "CREATE_SNAPSHOT" }
  | { type: "RUN_RECIPE"; recipe: ExtractionRecipe };

export type ContentResponse =
  | { ok: true; snapshot: string; url: string }
  | { ok: true; result: ExtractionResult }
  | { ok: false; error: string };

export type BackgroundRequest =
  | { type: "GET_ACTIVE_TAB" }
  | { type: "CREATE_SNAPSHOT" }
  | { type: "RUN_RECIPE"; recipe: ExtractionRecipe }
  | { type: "RUN_PROFILE"; profileId: string; actionPreset?: ActionPreset; applyAction?: boolean }
  | { type: "GENERATE_RECIPE"; intent: string; domSnapshot: string; url: string }
  | { type: "TRANSFORM_RESULT"; intent: string; outputRequest: string; result: ExtractionResult }
  | { type: "RUN_TRANSFORM"; transform: TransformSpec; data: unknown }
  | { type: "MARK_PROFILE_USED"; profile: ExtractionProfile; actionPreset: ActionPreset }
  | {
      type: "APPLY_ACTION";
      exportResult: ExportResult;
      actionPreset: ActionPreset;
      profile?: ExtractionProfile;
    }
  | {
      type: "REFINE_ARTIFACT";
      intent: string;
      feedback: string;
      domSnapshot: string;
      url: string;
      currentRecipe: ExtractionRecipe;
      currentResult: ExtractionResult;
    }
  | {
      type: "REPAIR_RECIPE";
      intent: string;
      domSnapshot: string;
      url: string;
      oldRecipe: ExtractionRecipe;
      debug: ExecutionDebug;
      failureReason: string;
    }
  | { type: "LIST_PROFILES" }
  | { type: "SAVE_PROFILE"; profile: ExtractionProfile };

export type BackgroundResponse =
  | { ok: true; tab: { id: number; url: string; title: string } }
  | { ok: true; snapshot: string; url: string }
  | { ok: true; result: ExtractionResult; exportResult?: ExportResult; actionResult?: ActionRunResult }
  | { ok: true; recipe: ExtractionRecipe }
  | { ok: true; transform: TransformSpec | null; exportResult: ExportResult }
  | { ok: true; actionResult: ActionRunResult }
  | { ok: true; artifact: ExtractionArtifact; exportResult?: ExportResult }
  | { ok: true; profiles: ExtractionProfile[] }
  | { ok: true; profile: ExtractionProfile }
  | { ok: false; error: string };

export type ActionRunResult = {
  copied: boolean;
  downloaded: boolean;
  errors: string[];
};
