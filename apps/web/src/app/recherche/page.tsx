"use client";

import { SectionStub } from "@/components/section-stub";
import { MagnifyingGlass } from "@phosphor-icons/react";

export default function RecherchePage() {
  return (
    <SectionStub
      icon={MagnifyingGlass}
      title="Recherche"
      description="Full-text + sémantique sur tout le vault. Filtres composables, opérateurs booléens, vues sauvegardables."
      hint="Engine packages/search prêt (SQLite FTS5 + embeddings ONNX all-MiniLM-L6-v2 + hybrid RRF)."
    />
  );
}
