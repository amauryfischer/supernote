export interface ResolverActionMeta {
  id: string;
  defaultCombo: string;
  reserved?: boolean;
}

export interface BindingConflict {
  combo: string;
  actionIds: string[];
  kind: "duplicate" | "reserved" | "native";
}

export interface ResolvedBindings {
  bindings: Record<string, string>; // combo -> actionId
  byAction: Record<string, string>; // actionId -> combo
  conflicts: BindingConflict[];
}

// Combos non réassignables (édition/clipboard) — un override dessus est bloqué côté UI.
const RESERVED = new Set(["mod+z", "mod+shift+z", "mod+c", "mod+v", "mod+x", "mod+a"]);
// Nav OS native qu'on déconseille d'écraser (avertissement, pas blocage).
const NATIVE = new Set([
  "alt+left", "alt+right", "ctrl+left", "ctrl+right",
  "home", "end", "mod+home", "mod+end", "mod+up", "mod+down",
]);

export function resolveBindings(
  meta: ReadonlyArray<ResolverActionMeta>,
  overrides: Record<string, string>,
): ResolvedBindings {
  const byAction: Record<string, string> = {};
  const actionToMeta = new Map<string, ResolverActionMeta>();
  for (const a of meta) {
    actionToMeta.set(a.id, a);
    const combo = (overrides[a.id] ?? a.defaultCombo).trim().toLowerCase();
    if (combo) byAction[a.id] = combo;
  }

  const bindings: Record<string, string> = {};
  const comboToActions = new Map<string, string[]>();
  for (const [actionId, combo] of Object.entries(byAction)) {
    bindings[combo] = actionId; // dernier gagne ; doublon signalé ci-dessous
    comboToActions.set(combo, [...(comboToActions.get(combo) ?? []), actionId]);
  }

  const conflicts: BindingConflict[] = [];
  for (const [combo, actionIds] of comboToActions) {
    if (actionIds.length > 1) conflicts.push({ combo, actionIds, kind: "duplicate" });
    // Only flag as reserved if at least one action is NOT marked reserved
    const hasReservedAction = actionIds.some((id) => actionToMeta.get(id)?.reserved);
    if (RESERVED.has(combo) && !hasReservedAction) {
      conflicts.push({ combo, actionIds, kind: "reserved" });
    } else if (!RESERVED.has(combo) && NATIVE.has(combo)) {
      conflicts.push({ combo, actionIds, kind: "native" });
    }
  }

  return { bindings, byAction, conflicts };
}
