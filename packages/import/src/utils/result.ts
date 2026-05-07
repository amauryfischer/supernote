import type { ImportError, ImportResult } from "../types.js";

export function emptyResult(): ImportResult {
  return {
    imported: { notes: 0, contacts: 0, orgs: 0, assets: 0 },
    skipped: 0,
    errors: [],
    warnings: [],
  };
}

export function mergeResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    imported: {
      notes: a.imported.notes + b.imported.notes,
      contacts: a.imported.contacts + b.imported.contacts,
      orgs: a.imported.orgs + b.imported.orgs,
      assets: a.imported.assets + b.imported.assets,
    },
    skipped: a.skipped + b.skipped,
    errors: [...a.errors, ...b.errors],
    warnings: [...a.warnings, ...b.warnings],
  };
}

export function addError(
  result: ImportResult,
  file: string,
  message: string,
  cause?: unknown
): ImportResult {
  const error: ImportError = { file, message, cause };
  return { ...result, errors: [...result.errors, error] };
}

export function addWarning(result: ImportResult, warning: string): ImportResult {
  return { ...result, warnings: [...result.warnings, warning] };
}

export function incNotes(result: ImportResult): ImportResult {
  return {
    ...result,
    imported: { ...result.imported, notes: result.imported.notes + 1 },
  };
}

export function incContacts(result: ImportResult): ImportResult {
  return {
    ...result,
    imported: { ...result.imported, contacts: result.imported.contacts + 1 },
  };
}

export function incOrgs(result: ImportResult): ImportResult {
  return {
    ...result,
    imported: { ...result.imported, orgs: result.imported.orgs + 1 },
  };
}

export function incAssets(result: ImportResult): ImportResult {
  return {
    ...result,
    imported: { ...result.imported, assets: result.imported.assets + 1 },
  };
}

export function incSkipped(result: ImportResult): ImportResult {
  return { ...result, skipped: result.skipped + 1 };
}
