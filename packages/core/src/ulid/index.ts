import { ulid, monotonicFactory } from "ulid";

export { ulid } from "ulid";

/** ULID is 26 characters, Crockford base32 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Generate a new ULID string */
export function newId(): string {
  return ulid();
}

/** Check whether a string is a valid ULID */
export function isValidId(s: unknown): s is string {
  return typeof s === "string" && ULID_RE.test(s);
}

/** Monotonically increasing ULID factory for a batch */
export function makeMonotonicFactory(): () => string {
  const gen = monotonicFactory();
  return () => gen();
}
