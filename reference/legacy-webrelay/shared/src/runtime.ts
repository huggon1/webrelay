import type {
  ExecutionDebug,
  ExecutionError,
  ExtractionRecipe,
  ExtractionResult,
  FieldRule,
} from "./schemas.js";

type Scope = Document | Element;

function queryAll(scope: Scope, selector: string): Element[] {
  return Array.from(scope.querySelectorAll(selector));
}

function readValue(element: Element, field: FieldRule): string {
  if (field.value === "textContent") {
    return (element.textContent || "").trim();
  }
  if (field.value === "innerText") {
    return ((element as HTMLElement).innerText || element.textContent || "").trim();
  }
  if (field.value === "href") {
    const href = element.getAttribute("href") || "";
    try {
      return href ? new URL(href, element.ownerDocument.location.href).href : "";
    } catch {
      return href.trim();
    }
  }
  if (field.value === "src") {
    const src = element.getAttribute("src") || "";
    try {
      return src ? new URL(src, element.ownerDocument.location.href).href : "";
    } catch {
      return src.trim();
    }
  }
  return (element.getAttribute(field.attribute || "") || "").trim();
}

function readField(scope: Scope, field: FieldRule): { values: string[]; errors: ExecutionError[] } {
  const errors: ExecutionError[] = [];
  try {
    const matches = field.selector ? queryAll(scope, field.selector) : [scope as Element];
    const values = matches.map((element) => readValue(element, field)).filter(Boolean);
    if (field.required && values.length === 0) {
      errors.push({
        code: "required_empty",
        field: field.name,
        message: `Required field "${field.name}" produced no value.`,
      });
    }
    return { values, errors };
  } catch (error) {
    return {
      values: [],
      errors: [
        {
          code: "selector_error",
          field: field.name,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function buildFieldDebug(
  scope: Scope,
  field: FieldRule,
  values: string[],
): { name: string; selector?: string; matchCount: number; emptyCount: number } {
  let matchCount = 0;
  try {
    matchCount = field.selector ? queryAll(scope, field.selector).length : 1;
  } catch {
    matchCount = 0;
  }
  return {
    name: field.name,
    selector: field.selector,
    matchCount,
    emptyCount: Math.max(matchCount - values.length, 0),
  };
}

function executeSingle(scope: Scope, recipe: ExtractionRecipe, debug: ExecutionDebug) {
  const record: Record<string, string | string[]> = {};
  for (const field of recipe.fields) {
    const { values, errors } = readField(scope, field);
    debug.errors.push(...errors);
    debug.fields.push(buildFieldDebug(scope, field, values));
    record[field.name] = values.length <= 1 ? values[0] || "" : values;
  }
  return record;
}

export function executeRecipe(recipe: ExtractionRecipe, doc: Document = document): ExtractionResult {
  const debug: ExecutionDebug = {
    mode: recipe.mode,
    rootSelector: recipe.rootSelector,
    rootMatchCount: 0,
    fields: [],
    errors: [],
  };

  try {
    if (recipe.mode === "single") {
      const root = recipe.rootSelector ? doc.querySelector(recipe.rootSelector) : doc;
      debug.rootMatchCount = recipe.rootSelector ? (root ? 1 : 0) : 1;
      if (!root) {
        debug.errors.push({
          code: "root_not_found",
          message: `Root selector "${recipe.rootSelector}" matched no elements.`,
        });
        return { ok: false, data: {}, debug };
      }
      const data = executeSingle(root, recipe, debug);
      return { ok: debug.errors.length === 0, data, debug };
    }

    const roots = recipe.rootSelector ? queryAll(doc, recipe.rootSelector) : [];
    debug.rootMatchCount = roots.length;
    if (roots.length === 0) {
      debug.errors.push({
        code: "root_not_found",
        message: `Root selector "${recipe.rootSelector}" matched no elements.`,
      });
      return { ok: false, data: [], debug };
    }

    const data = roots.map((root) => executeSingle(root, recipe, debug));
    return { ok: debug.errors.length === 0 && data.length > 0, data, debug };
  } catch (error) {
    debug.errors.push({
      code: "runtime_error",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, data: recipe.mode === "list" ? [] : {}, debug };
  }
}
