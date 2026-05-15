import type { ValidationResult } from "./types";

// RFC 5322 simplifié : local-part raisonnable + domaine avec au moins un point + TLD ≥ 2 lettres.
const EMAIL_RE =
  /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export function validateEmail(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!EMAIL_RE.test(trimmed)) {
    return { valid: false, message: "Email invalide" };
  }
  return { valid: true };
}
