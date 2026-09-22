"use client";

import { AppShell, useMobileTitle } from "@/components/shell";
import { KnowledgeGraph } from "@/components/graph-page";

export default function CartePage() {
  useMobileTitle("Carte des liens");
  return (
    <AppShell>
      <KnowledgeGraph />
    </AppShell>
  );
}
