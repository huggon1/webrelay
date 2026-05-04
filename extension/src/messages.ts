import type {
  ExecutionDebug,
  ExtractionProfile,
  ExtractionRecipe,
  ExtractionResult,
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
  | { type: "GENERATE_RECIPE"; intent: string; domSnapshot: string; url: string }
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
  | { ok: true; result: ExtractionResult }
  | { ok: true; recipe: ExtractionRecipe }
  | { ok: true; profiles: ExtractionProfile[] }
  | { ok: true; profile: ExtractionProfile }
  | { ok: false; error: string };
