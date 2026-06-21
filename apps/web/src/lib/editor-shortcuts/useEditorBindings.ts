"use client";
import { useMemo, useRef } from "react";
import { ACTION_META } from "@supernote/editor";
import { useSettings } from "@/components/settings/SettingsContext";
import { resolveBindings, type ResolvedBindings } from "./resolve";

/**
 * Résout les bindings éditeur (défauts du registre + overrides settings) et
 * expose : la résolution complète (pour l'UI), un getter vivant pour
 * l'extension Tiptap, et une clé qui change quand l'ensemble des combos change
 * — sert de clé de remount éditeur pour que tout rebind prenne effet.
 */
export function useEditorBindings(): {
  resolved: ResolvedBindings;
  getBindings: () => Record<string, string>;
  bindingsKey: string;
} {
  const { settings } = useSettings();
  const overrides = settings.editorShortcuts;
  const resolved = useMemo(() => resolveBindings(ACTION_META, overrides), [overrides]);
  const ref = useRef(resolved.bindings);
  ref.current = resolved.bindings;
  const getBindings = useMemo(() => () => ref.current, []);
  const bindingsKey = useMemo(
    () => Object.entries(resolved.bindings).sort().map(([c, a]) => `${c}:${a}`).join("|"),
    [resolved.bindings],
  );
  return { resolved, getBindings, bindingsKey };
}
