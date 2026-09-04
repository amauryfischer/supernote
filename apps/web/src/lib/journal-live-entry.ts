/**
 * Registre du seul écrivain autorisé sur une entrée de journal.
 *
 * L'entrée du jour a deux écrivains possibles : le `JournalEditor` ouvert
 * (page d'accueil) et la capture rapide. Les faire écrire tous les deux via
 * `useDailyEntity` les met en concurrence sur la même entité : la capture
 * partirait du corps en cache React Query, qui ignore la frappe encore en
 * debounce, et le debounce écraserait ensuite la capture. Tant qu'un éditeur
 * est monté sur la date, il est donc le seul à écrire — la capture lui remet
 * son texte et le laisse persister.
 */

/** Ajoute `text` au tampon vivant de l'éditeur, à sa suite. */
type AppendToLiveEntry = (text: string) => void;

const writers = new Map<string, AppendToLiveEntry>();

/**
 * Déclare l'éditeur vivant de `date`. Renvoie le désenregistrement, à appeler
 * au démontage.
 */
export function registerLiveJournalEntry(date: string, append: AppendToLiveEntry): () => void {
  writers.set(date, append);
  return () => {
    // Un autre éditeur a pu prendre la place entre-temps (changement de date
    // aller-retour, transition de route qui monte la page suivante avant de
    // démonter la précédente) : ne retirer que sa propre fonction.
    if (writers.get(date) === append) writers.delete(date);
  };
}

/**
 * Remet `text` à l'éditeur ouvert sur `date`. Renvoie `false` si personne
 * n'écoute — l'appelant doit alors écrire lui-même.
 */
export function appendToLiveJournalEntry(date: string, text: string): boolean {
  const append = writers.get(date);
  if (!append) return false;
  append(text);
  return true;
}
