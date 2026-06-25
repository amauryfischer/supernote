/**
 * mail-eisenhower — logique PURE de mapping entre les quadrants de la matrice
 * d'Eisenhower et les champs d'une entité `todo` de base.
 *
 * Modèle mental (identique à `components/todos/TodoMatrix.tsx`, calqué pour
 * rester cohérent) — deux axes binaires :
 *   - Urgence    ← le flag `urgent` (booléen).
 *   - Importance ← le champ `importance` (échelle 4 niveaux), réduit à un binaire
 *                  « important = high | critical », sinon non-important.
 *
 *        │ URGENT              │ PAS URGENT
 *   ─────┼─────────────────────┼─────────────────────
 *   IMP. │ Faire (do)          │ Planifier (schedule)
 *   ¬IMP.│ Déléguer (delegate) │ Éliminer (eliminate)
 *
 * Ce module ne fait AUCUN effet de bord (ni réseau, ni localStorage) : il traduit
 * dans les deux sens un quadrant ↔ les champs persistés du todo. Le store des
 * liaisons thread ↔ todo vit dans `mail-todo-binding.ts`.
 */

/** Les quatre quadrants de la matrice d'Eisenhower. */
export type EisenhowerQuadrant = "do" | "schedule" | "delegate" | "eliminate";

/** Définition d'un quadrant : identifiant, libellé FR, et axes binaires. */
export interface EisenhowerQuadrantDef {
  id: EisenhowerQuadrant;
  label: string;
  urgent: boolean;
  important: boolean;
}

/**
 * Les quadrants dans l'ordre de lecture de la grille 2×2 (colonne urgente
 * d'abord) : `do`, `schedule`, `delegate`, `eliminate`. Cet ordre est celui
 * attendu par l'UI (boutons / grille) pour rester aligné avec `TodoMatrix`.
 */
export const QUADRANTS: readonly EisenhowerQuadrantDef[] = [
  { id: "do", label: "Faire", urgent: true, important: true },
  { id: "schedule", label: "Planifier", urgent: false, important: true },
  { id: "delegate", label: "Déléguer", urgent: true, important: false },
  { id: "eliminate", label: "Éliminer", urgent: false, important: false },
];

/**
 * Champs `todo` à écrire pour matérialiser un quadrant. On collapse l'importance
 * sur deux valeurs canoniques (`high` / `low`) — suffisant pour reclasser une
 * tâche créée depuis un email, et cohérent avec `quadrantOf` (high ⇒ important,
 * low ⇒ non-important). PUR.
 *
 *   - do        = urgent + high
 *   - schedule  = !urgent + high
 *   - delegate  = urgent + low
 *   - eliminate = !urgent + low
 */
export function quadrantToTodoFields(q: EisenhowerQuadrant): {
  urgent: boolean;
  importance: "high" | "low";
} {
  switch (q) {
    case "do":
      return { urgent: true, importance: "high" };
    case "schedule":
      return { urgent: false, importance: "high" };
    case "delegate":
      return { urgent: true, importance: "low" };
    case "eliminate":
      return { urgent: false, importance: "low" };
    default: {
      // Exhaustivité : un nouveau quadrant sans branche → erreur TS ici.
      const never: never = q;
      throw new Error(`Quadrant Eisenhower inconnu : ${String(never)}`);
    }
  }
}

/**
 * Détermine le quadrant d'une tâche à partir de ses axes bruts. Inverse de
 * `quadrantToTodoFields` et cohérent avec `TodoMatrix.quadrantOf` :
 * « important » ⇔ `importance === "high" || importance === "critical"`. Toute
 * autre valeur (`medium`, `low`, vide, inconnue) est traitée comme
 * non-importante. PUR.
 */
export function quadrantOf(urgent: boolean, importance: string): EisenhowerQuadrant {
  const important = importance === "high" || importance === "critical";
  if (urgent && important) return "do";
  if (!urgent && important) return "schedule";
  if (urgent && !important) return "delegate";
  return "eliminate";
}
