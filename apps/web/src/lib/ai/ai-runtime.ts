/**
 * Où l'IA locale a le droit de tourner.
 *
 * Décision produit : **aucun traitement IA sur mobile**. Le téléphone est un
 * carnet de capture — on y écrit, la synchronisation ramène le texte, et c'est
 * le poste fixe qui extrait, tague et range. Trois raisons : Ollama n'existe
 * pas sur mobile, une passe locale y coûterait la batterie, et les boucles de
 * fond sont sur le chemin du freeze mobile diagnostiqué.
 *
 * Ce garde couvre les *traitements* (extraction, classement, marges,
 * auto-titre, auto-tag), pas la consultation : les tags et suggestions déjà
 * produits restent lisibles et modifiables au doigt.
 */

/** Même seuil que le shell mobile (`useIsMobile`), gardé indépendant pour
 *  rester appelable hors React. */
const MOBILE_MAX_WIDTH = 767;

export function isAiRuntimeAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return !window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
  } catch {
    // matchMedia absent : on ne peut pas conclure « desktop », donc on
    // s'abstient plutôt que de lancer une passe sur un appareil inconnu.
    return false;
  }
}

/** Raison affichable quand l'IA est volontairement en retrait. */
export const AI_MOBILE_NOTICE =
  "IA en pause sur mobile — l'analyse se fera au retour sur l'ordinateur.";
