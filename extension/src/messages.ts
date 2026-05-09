import type {
  ActionPreset,
  BaseRun,
  CodexProgressEvent,
  ExtractionArtifact,
  ExtractionProfile,
  ExtractionRecipe,
  ExtractionResult,
  ScriptConfig,
} from "@extractor/shared";

export type ToastVariant = "success" | "error" | "info";

export type ContentRequest =
  | { type: "CREATE_SNAPSHOT" }
  | { type: "RUN_RECIPE"; recipe: ExtractionRecipe }
  | { type: "SHOW_TOAST"; message: string; variant: ToastVariant };

export type ContentResponse =
  | { ok: true; snapshot: string; url: string }
  | { ok: true; result: ExtractionResult }
  | { ok: true }
  | { ok: false; error: string };

export type ActionRunResult = {
  copied: boolean;
  downloaded: boolean;
  errors: string[];
};

export type ProfileRunResult = {
  profile: ExtractionProfile;
  extraction: ExtractionResult;
  scriptInput: string;
  output: string;
  actionResult: ActionRunResult;
};

export type BackgroundRequest =
  | { type: "GET_ACTIVE_TAB" }
  | { type: "CREATE_SNAPSHOT" }
  | { type: "LIST_PROFILES_FOR_SITE"; url: string }
  | { type: "LIST_ALL_PROFILES" }
  | { type: "SAVE_PROFILE"; profile: ExtractionProfile }
  | { type: "UPDATE_PROFILE"; profileId: string; updates: Partial<ExtractionProfile> }
  | { type: "DELETE_PROFILE"; profileId: string }
  | { type: "RUN_PROFILE"; profileId: string; actionPresetOverride?: ActionPreset }
  | { type: "RUN_PROFILE_PREVIEW"; profile: ExtractionProfile }
  | { type: "RUN_SCRIPT_PREVIEW"; script: ScriptConfig; input: string }
  | { type: "START_STUDIO_GENERATE"; request: GenerateArtifactRequest; tabId: number; tabUrl: string }
  | { type: "GET_STUDIO_JOB" }
  | { type: "CANCEL_STUDIO_JOB" }
  | { type: "CLEAR_STUDIO_JOB" };

export type BackgroundResponse =
  | { ok: true; tab: { id: number; url: string; title: string } }
  | { ok: true; snapshot: string; url: string; tabId: number }
  | { ok: true; profiles: ExtractionProfile[] }
  | { ok: true; profile: ExtractionProfile }
  | { ok: true; run: ProfileRunResult }
  | { ok: true; extraction: ExtractionResult; scriptInput: string; output: string }
  | { ok: true; output: string }
  | { ok: true; job: StudioJob | null }
  | { ok: false; error: string };

export type GenerateMode = "auto" | "intent" | "revise";

export type GenerateArtifactRequest = {
  url: string;
  domSnapshot: string;
  mode: GenerateMode;
  intent?: string;
  baseProfile?: ExtractionProfile;
  baseRun?: BaseRun;
  userNote?: string;
};

export type GenerateArtifactResult = {
  artifact: ExtractionArtifact;
};

export type StudioJobStatus = "idle" | "running" | "done" | "error" | "cancelled";

export type StudioPreview = {
  extraction: ExtractionResult;
  scriptInput: string;
  output: string;
};

export type StudioJob = {
  id: string;
  status: StudioJobStatus;
  request: GenerateArtifactRequest;
  tabId: number;
  tabUrl: string;
  events: CodexProgressEvent[];
  artifact?: ExtractionArtifact;
  outputDescription?: string;
  candidateProfile?: ExtractionProfile;
  preview?: StudioPreview;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type StreamEventHandler = (event: CodexProgressEvent) => void;

export type OffscreenRequest =
  | { type: "OFFSCREEN_COPY"; content: string }
  | { type: "OFFSCREEN_RUN_SCRIPT"; id: string; code: string; input: string };

export type OffscreenResponse =
  | { ok: true }
  | { ok: true; output: string }
  | { ok: false; error: string };
