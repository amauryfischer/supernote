"use client";

import { AppShell } from "@/components/shell";
import { WritingSurface } from "@/components/writing-surface";

/**
 * Banc de test éditeur sans vault — anciennement `/` (accueil). Déplacé ici
 * quand `/journal` a pris la place d'accueil ; toujours utile pour déboguer
 * l'éditeur en isolation (cf. mémoire projet « boucle debug éditeur »).
 */
export default function WritingSurfaceDevPage() {
  return (
    <AppShell>
      <WritingSurface />
    </AppShell>
  );
}
