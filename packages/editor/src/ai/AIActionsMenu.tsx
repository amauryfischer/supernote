// ============================================================
// AIActionsMenu — palette d'actions IA (HeroUI v3 Popover + ListBox)
// ============================================================

import { useState, useMemo } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  ListBox,
  ListBoxItem,
  Input,
  Button,
  Spinner,
} from "@heroui/react";
import { AI_ACTIONS_MVP, type AIActionId } from "@supernote/ai/actions";

/** Icône sparkle inline — évite la dépendance @phosphor-icons/react. */
function SparkleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M208,144a16,16,0,0,1-16,16H144v48a16,16,0,0,1-32,0V160H64a16,16,0,0,1,0-32h48V80a16,16,0,0,1,32,0v48h48A16,16,0,0,1,208,144Z" />
    </svg>
  );
}

export interface AIActionsMenuProps {
  /** Contrôle l'ouverture programmatique (clic droit, shortcut). */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Position absolue x/y pour ouverture programmatique. */
  anchorPosition?: { x: number; y: number } | null;
  busy: boolean;
  onRun: (id: AIActionId) => void;
}

export function AIActionsMenu({
  isOpen,
  onOpenChange,
  anchorPosition,
  busy,
  onRun,
}: AIActionsMenuProps) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return AI_ACTIONS_MVP;
    return AI_ACTIONS_MVP.filter((a) =>
      a.label.toLowerCase().includes(q),
    );
  }, [filter]);

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <PopoverTrigger>
        {/* Fallback trigger pour l'usage toolbar-natif ; ignoré quand
            le composant est contrôlé via isOpen depuis l'extérieur. */}
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Actions IA"
        >
          <SparkleIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        placement="bottom start"
        style={
          anchorPosition
            ? {
                position: "fixed",
                left: anchorPosition.x,
                top: anchorPosition.y,
              }
            : undefined
        }
      >
        <div className="flex flex-col gap-2 p-2 w-64">
          <Input
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {busy && (
            <div className="flex items-center gap-2 text-xs text-default-500">
              <Spinner />
              <span>Génération en cours…</span>
            </div>
          )}
          <ListBox
            aria-label="Actions IA"
            items={filtered}
          >
            {(item) => (
              <ListBoxItem
                key={item.id}
                id={item.id}
                onAction={() => {
                  if (busy) return;
                  onRun(item.id);
                  onOpenChange?.(false);
                }}
              >
                <div className="flex flex-col">
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span className="text-xs text-default-400">
                      {item.shortcut}
                    </span>
                  )}
                </div>
              </ListBoxItem>
            )}
          </ListBox>
        </div>
      </PopoverContent>
    </Popover>
  );
}
