import { describe, it, expect } from "vitest";
import { createAgeEngine } from "../src/index.js";

const engine = createAgeEngine();
const PASSPHRASE = "correct-horse-battery-staple-test";
const WRONG_PASSPHRASE = "wrong-passphrase-never-matches";

describe("createAgeEngine", () => {
  // ── encrypt / decrypt round-trip ─────────────────────────────────────────

  it("round-trips a simple string", async () => {
    const plain = "Hello, Supernote!";
    const cipher = await engine.encrypt(plain, PASSPHRASE);
    const result = await engine.decrypt(cipher, PASSPHRASE);
    expect(result).toBe(plain);
  });

  it("round-trips a multi-line markdown body", async () => {
    const plain = "# My private note\n\nSecrets here.\n- item 1\n- item 2\n";
    const cipher = await engine.encrypt(plain, PASSPHRASE);
    const result = await engine.decrypt(cipher, PASSPHRASE);
    expect(result).toBe(plain);
  });

  it("round-trips an empty string", async () => {
    const cipher = await engine.encrypt("", PASSPHRASE);
    const result = await engine.decrypt(cipher, PASSPHRASE);
    expect(result).toBe("");
  });

  // ── ciphertext format ────────────────────────────────────────────────────

  it("ciphertext starts with the age armor header", async () => {
    const cipher = await engine.encrypt("test", PASSPHRASE);
    expect(cipher.startsWith("-----BEGIN AGE ENCRYPTED FILE-----")).toBe(true);
  });

  it("ciphertext ends with the age armor footer", async () => {
    const cipher = await engine.encrypt("test", PASSPHRASE);
    expect(cipher.trimEnd().endsWith("-----END AGE ENCRYPTED FILE-----")).toBe(
      true,
    );
  });

  it("produces different ciphertexts for the same plaintext (nonce-based)", async () => {
    const c1 = await engine.encrypt("same text", PASSPHRASE);
    const c2 = await engine.encrypt("same text", PASSPHRASE);
    expect(c1).not.toBe(c2);
  });

  // ── isEncrypted detection ─────────────────────────────────────────────────

  it("isEncrypted returns true for age-encrypted content", async () => {
    const cipher = await engine.encrypt("detect me", PASSPHRASE);
    expect(engine.isEncrypted(cipher)).toBe(true);
  });

  it("isEncrypted returns false for plain markdown", () => {
    const plain = "# Title\n\nNormal content.";
    expect(engine.isEncrypted(plain)).toBe(false);
  });

  it("isEncrypted returns false for empty string", () => {
    expect(engine.isEncrypted("")).toBe(false);
  });

  // ── error conditions ─────────────────────────────────────────────────────

  it("decrypt with wrong passphrase throws", async () => {
    const cipher = await engine.encrypt("secret", PASSPHRASE);
    await expect(engine.decrypt(cipher, WRONG_PASSPHRASE)).rejects.toThrow();
  });

  it("encrypt with empty passphrase throws", async () => {
    await expect(engine.encrypt("x", "")).rejects.toThrow(
      "Passphrase must not be empty",
    );
  });

  it("decrypt non-encrypted content throws", async () => {
    await expect(engine.decrypt("not encrypted", PASSPHRASE)).rejects.toThrow();
  });
});
