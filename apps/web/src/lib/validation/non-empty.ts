import type { ValidationResult } from "./types";

export function validateNonEmpty(value: string): ValidationResult {
  if (value.trim().length === 0) {
    return { valid: false, message: "Ce champ est requis" };
  }
  return { valid: true };
}
