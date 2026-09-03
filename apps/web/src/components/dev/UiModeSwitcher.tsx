"use client";

import { Button } from "@supernote/ui";
import { useUiMode, type UiMode } from "@/hooks/useUiMode";

const OPTIONS: ReadonlyArray<{ value: UiMode; label: string }> = [
  { value: "next", label: "Refonte" },
  { value: "legacy", label: "Héritage" },
];

/**
 * Bascule de comparaison entre l'ancien registre visuel et la refonte
 * Linear/Raycast. Monté hors production uniquement (cf. RootLayout). Se retire
 * en une étape : supprimer ce dossier, la ligne de montage dans RootLayout et
 * le bloc `data-ui` d'index.html.
 *
 * L'état vit sur `<html data-ui>` (pré-peint), miroité en localStorage et
 * forçable par `?ui=next|legacy` pour scripter les captures.
 */
export function UiModeSwitcher() {
  const { mode, setMode } = useUiMode();

  return (
    <div
      role="group"
      aria-label="Registre visuel"
      className="fixed right-3 bottom-[calc(72px+env(safe-area-inset-bottom,0px))] flex items-center gap-0.5 rounded-lg p-0.5 shadow-md md:bottom-3"
      style={{
        zIndex: "var(--z-tooltip, 600)",
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border)",
      }}
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode(opt.value)}
            aria-pressed={active}
            className="h-6 rounded-md px-2 text-[11px] font-medium"
            style={{
              backgroundColor: active ? "var(--surface-3)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
