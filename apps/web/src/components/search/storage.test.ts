// @vitest-environment jsdom
// Les recherches enregistrées/récentes vivaient en state React éphémère avec
// des fixtures codées en dur — perdues au reload. Ces tests verrouillent la
// persistance localStorage : round-trip, validation défensive et plafonds.
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSavedSearches,
  saveSavedSearches,
  loadRecentSearches,
  saveRecentSearches,
} from "./storage";
import type { SavedSearch, RecentSearch } from "./types";

const SAVED_KEY = "supernote.search.saved";
const RECENT_KEY = "supernote.search.recent";

const sampleSaved: SavedSearch = {
  id: "s1",
  label: "Contacts clients",
  query: "type:personne tag:client",
  filters: [{ key: "type", value: "personne" }],
  mode: "hybrid",
  savedAt: "2026-05-01T10:00:00Z",
};

const sampleRecent: RecentSearch = {
  id: "r1",
  query: "architecture monorepo",
  usedAt: "2026-05-06T17:00:00Z",
};

describe("saved searches persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved search", () => {
    saveSavedSearches([sampleSaved]);
    expect(loadSavedSearches()).toEqual([sampleSaved]);
  });

  it("returns [] when nothing is persisted", () => {
    expect(loadSavedSearches()).toEqual([]);
  });

  it("returns [] on corrupt JSON instead of throwing", () => {
    localStorage.setItem(SAVED_KEY, "{not json");
    expect(loadSavedSearches()).toEqual([]);
  });

  it("returns [] when the stored value isn't an array", () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ nope: true }));
    expect(loadSavedSearches()).toEqual([]);
  });

  it("drops entries missing required string fields", () => {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify([sampleSaved, { id: "bad", label: 42, query: "x" }, null]),
    );
    expect(loadSavedSearches()).toEqual([sampleSaved]);
  });

  it("strips unknown filter keys and falls back to a safe mode", () => {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify([
        {
          id: "s2",
          label: "L",
          query: "q",
          filters: [
            { key: "tag", value: "ok" },
            { key: "evil", value: "drop" },
            { key: "in", value: 99 },
          ],
          mode: "telepathic",
        },
      ]),
    );
    const loaded = loadSavedSearches();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.filters).toEqual([{ key: "tag", value: "ok" }]);
    expect(loaded[0]!.mode).toBe("hybrid");
    expect(loaded[0]!.savedAt).toBe(new Date(0).toISOString());
  });

  it("caps the persisted list", () => {
    const many: SavedSearch[] = Array.from({ length: 80 }, (_, i) => ({
      ...sampleSaved,
      id: `s${i}`,
    }));
    saveSavedSearches(many);
    expect(loadSavedSearches().length).toBe(50);
  });
});

describe("recent searches persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a recent search", () => {
    saveRecentSearches([sampleRecent]);
    expect(loadRecentSearches()).toEqual([sampleRecent]);
  });

  it("returns [] on corrupt JSON", () => {
    localStorage.setItem(RECENT_KEY, "nope");
    expect(loadRecentSearches()).toEqual([]);
  });

  it("drops entries without id/query", () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([sampleRecent, { id: "r2" }, { query: "q" }]),
    );
    expect(loadRecentSearches()).toEqual([sampleRecent]);
  });

  it("defaults usedAt when missing", () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: "r3", query: "q" }]));
    const loaded = loadRecentSearches();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.usedAt).toBe(new Date(0).toISOString());
  });

  it("caps the persisted list at 20", () => {
    const many: RecentSearch[] = Array.from({ length: 40 }, (_, i) => ({
      ...sampleRecent,
      id: `r${i}`,
    }));
    saveRecentSearches(many);
    expect(loadRecentSearches().length).toBe(20);
  });
});
