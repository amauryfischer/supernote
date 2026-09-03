"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import { memo } from "react";
import { Button } from "@supernote/ui";

// Modificateur clavier affiché dans le hint — ⌘ sur Apple, Ctrl ailleurs. Un
// produit « clavier d'abord » doit montrer le vrai raccourci, pas une touche
// nue « K » précédée d'un glyphe ⌘ décoratif.
export const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";

function openPalette() {
  window.dispatchEvent(new CustomEvent("supernote:open-command-palette"));
}

/**
 * Champ de recherche factice qui ouvre la command palette. Vit dans la sidebar
 * (registre next, à la Linear) ou dans la topbar (registre héritage).
 */
export const SearchTrigger = memo(function SearchTrigger({
  className = "",
}: {
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={openPalette}
      data-tour="command-palette-btn"
      aria-label="Rechercher"
      className={`sn-search-trigger sn-pressable flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] ${className}`}
    >
      <MagnifyingGlass size={14} className="shrink-0" />
      <span className="flex-1 truncate text-left">Rechercher…</span>
      <span className="flex shrink-0 items-center gap-0.5">
        <kbd
          className="rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[10px] leading-none"
          style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
        >
          {MOD_KEY}
        </kbd>
        <kbd
          className="rounded-[var(--radius-sm)] px-1 py-0.5 font-mono text-[10px] leading-none"
          style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
        >
          K
        </kbd>
      </span>
    </Button>
  );
});
