/**
 * Helpers purs pour dériver les dates de journal — isolés du hook React
 * (`useDatesWithNote`) afin de rester testables sans tirer trpc/React.
 */

import type { EntitySummary } from "@supernote/ipc";

/**
 * Normalise une valeur de champ `date` (kind `date`) vers la clé calendrier
 * `YYYY-MM-DD`. Le worker peut stocker la date sous différentes formes
 * sérialisées (ISO complet, `YYYY-MM-DD`, etc.) tant qu'elles sont parsables
 * par `Date`. On extrait toujours la composante locale jour pour coller à la
 * façon dont le calendrier indexe ses cases.
 *
 * @returns la clé `YYYY-MM-DD`, ou `null` si la valeur n'est pas une date.
 */
export function toYmdKey(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Cas fréquent : la valeur est déjà au format `YYYY-MM-DD` (éventuellement
  // suffixée d'une heure). On la prend telle quelle pour éviter tout décalage
  // de fuseau introduit par `new Date(...)` sur une date « nue ».
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (ymd?.[1]) return ymd[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Construit l'ensemble des dates (`YYYY-MM-DD`) ayant une entrée de journal à
 * partir des entités `daily` retournées par `entities.list`. Les entrées sans
 * champ `date` exploitable sont ignorées.
 */
export function datesWithNoteFromEntities(
  items: ReadonlyArray<Pick<EntitySummary, "fields">>,
): Set<string> {
  const set = new Set<string>();
  for (const item of items) {
    const key = toYmdKey(item.fields?.["date"]);
    if (key) set.add(key);
  }
  return set;
}
