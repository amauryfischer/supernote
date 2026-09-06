/**
 * Registre des notes ouvertes dans un éditeur.
 *
 * L'URL ne suffit pas : une note atteinte par `[[wikilink]]` vit dans une
 * colonne empilée (`StackedColumns`) où elle est éditable sans jamais
 * apparaître dans `/notes/<id>`. Le tri de l'inbox lit ce registre pour ne
 * jamais déplacer une note sous les doigts de l'utilisateur.
 *
 * Le compteur de références est indispensable : un aller-retour de wikilinks
 * A→B→A monte deux colonnes sur le MÊME id (elles sont clées par profondeur,
 * pas par id) et fermer l'une d'elles retirerait l'id du registre alors que
 * l'autre affiche toujours la note.
 */

import { useEffect } from "react";

const openIds = new Map<string, number>();

/** Ids actuellement montés dans un éditeur, quel que soit le conteneur. */
export function getOpenNoteIds(): readonly string[] {
  return [...openIds.keys()];
}

/**
 * Déclare une note ouverte le temps du montage. Appelé depuis `NoteEditor` :
 * c'est le seul point de passage, donc toute surface qui monte un éditeur est
 * couverte sans avoir à y penser.
 */
export function useRegisterOpenNote(id: string | null | undefined): void {
  useEffect(() => {
    if (!id) return undefined;
    openIds.set(id, (openIds.get(id) ?? 0) + 1);
    return () => {
      const next = (openIds.get(id) ?? 1) - 1;
      if (next <= 0) openIds.delete(id);
      else openIds.set(id, next);
    };
  }, [id]);
}
