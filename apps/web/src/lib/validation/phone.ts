import type { ValidationResult } from "./types";

const PHONE_RE = /^[+]?[0-9\s().\-]{6,25}$/;

export function validatePhone(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!PHONE_RE.test(trimmed)) {
    return { valid: false, message: "Numéro invalide" };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) {
    return { valid: false, message: "Numéro invalide" };
  }
  return { valid: true };
}
