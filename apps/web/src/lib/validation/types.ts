export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

export type Validator = (value: string) => ValidationResult;
