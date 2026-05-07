import { describe, it, expect } from "vitest";
import { formatDate } from "./format.js";

describe("formatDate", () => {
  const date = new Date("2024-03-15T14:05:09");

  it("formats YYYY", () => {
    expect(formatDate(date, "YYYY")).toBe("2024");
  });

  it("formats MM", () => {
    expect(formatDate(date, "MM")).toBe("03");
  });

  it("formats DD", () => {
    expect(formatDate(date, "DD")).toBe("15");
  });

  it("formats D (no leading zero)", () => {
    const d2 = new Date("2024-01-05T00:00:00");
    expect(formatDate(d2, "D")).toBe("5");
  });

  it("formats HH", () => {
    expect(formatDate(date, "HH")).toBe("14");
  });

  it("formats mm", () => {
    expect(formatDate(date, "mm")).toBe("05");
  });

  it("formats ss", () => {
    expect(formatDate(date, "ss")).toBe("09");
  });

  it("formats YYYY-MM-DD", () => {
    expect(formatDate(date, "YYYY-MM-DD")).toBe("2024-03-15");
  });

  it("formats YYYY-MM-DD HH:mm", () => {
    expect(formatDate(date, "YYYY-MM-DD HH:mm")).toBe("2024-03-15 14:05");
  });

  it("formats EEE (short day name)", () => {
    // 2024-03-15 is a Friday
    expect(formatDate(date, "EEE")).toBe("Fri");
  });

  it("formats EEEE (full day name)", () => {
    expect(formatDate(date, "EEEE")).toBe("Friday");
  });

  it("formats MMM (short month name)", () => {
    expect(formatDate(date, "MMM")).toBe("Mar");
  });

  it("formats MMMM (full month name)", () => {
    expect(formatDate(date, "MMMM")).toBe("March");
  });

  it("formats EEEE D MMMM YYYY (journal header)", () => {
    expect(formatDate(date, "EEEE D MMMM YYYY")).toBe("Friday 15 March 2024");
  });

  it("does not double-substitute YYYY within MMMM", () => {
    // MMMM contains 'MM' but should not be double-substituted
    expect(formatDate(new Date("2024-01-01"), "MMMM")).toBe("January");
  });
});
