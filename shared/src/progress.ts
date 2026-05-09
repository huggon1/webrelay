export type CodexUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

export type CodexProgressEvent =
  | {
      type: "stage";
      message: string;
    }
  | {
      type: "reasoning";
      message: string;
    }
  | {
      type: "artifact";
      artifactType: "recipe" | "script" | "result" | "raw";
      label: string;
      content: unknown;
    }
  | {
      type: "usage";
      usage: CodexUsage;
    }
  | {
      type: "error";
      message: string;
      stage?: string;
    }
  | {
      type: "done";
      result: unknown;
    };
