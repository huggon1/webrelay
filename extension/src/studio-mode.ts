export function selectGenerateMode(hasBaseProfile: boolean, instructions: string) {
  if (hasBaseProfile) return "revise" as const;
  return instructions.trim() ? ("intent" as const) : ("auto" as const);
}
