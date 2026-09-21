"use client";

import { AppShell } from "@/components/shell";
import { WritingSurface } from "@/components/writing-surface";

/**
 * Banc de test éditeur sans vault — anciennement `/` (accueil) ; utile pour
 * déboguer l'éditeur en isolation (cf. mémoire projet « boucle debug éditeur »).
 */
export default function WritingSurfaceDevPage() {
  return (
    <AppShell>
      <WritingSurface />
    </AppShell>
  );
}
