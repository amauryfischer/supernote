// ============================================================
// Cosine similarity tests
// ============================================================

import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "./cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const a = new Float32Array([1.0, 0.0, 0.0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = new Float32Array([1.0, 0.0, 0.0]);
    const b = new Float32Array([0.0, 1.0, 0.0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it("returns -1.0 for opposite vectors", () => {
    const a = new Float32Array([1.0, 0.0, 0.0]);
    const b = new Float32Array([-1.0, 0.0, 0.0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vectors", () => {
    const a = new Float32Array([0.0, 0.0, 0.0]);
    const b = new Float32Array([0.0, 0.0, 0.0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("returns 0 for vectors of different length", () => {
    const a = new Float32Array([1.0, 0.0]);
    const b = new Float32Array([1.0, 0.0, 0.0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("handles normalized vectors correctly", () => {
    const a = new Float32Array([0.6, 0.8]);
    const b = new Float32Array([0.6, 0.8]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
  });
});
