"use client";

/**
 * StackedColumns — navigation empilée à la Andy Matuschak.
 *
 * Cliquer un [[wikilink]] dans une colonne n'ouvre pas la page : il empile la
 * note cible dans une nouvelle colonne à droite. Cliquer un lien dans la
 * colonne de profondeur D tronque la pile au-delà de D puis ajoute la cible
 * (on suit un chemin). Les colonnes défilent horizontalement et se ferment
 * indépendamment.
 *
 * Tant qu'aucune colonne n'est empilée, le rendu est identique à l'éditeur
 * seul (aucune régression de layout pour la lecture normale).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ArrowSquareOut } from "@phosphor-icons/react";
import { Button, Spinner } from "@heroui/react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import type { Note } from "./fixtures";
import { NoteEditor } from "./NoteEditor";
import { useNote } from "./hooks";

interface StackEntry {
  /** Profondeur de cette colonne (1 = première empilée ; 0 = primaire). */
  depth: number;
  /** id résolu, ou null tant que la résolution est en cours. */
  id: string | null;
  /** Cible wikilink brute (affichée pendant la résolution). */
  target: string;
}

export function StackedColumns({
  primaryNote,
  dimBlocks,
}: {
  primaryNote: Note;
  dimBlocks?: boolean;
}): React.JSX.Element {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // Réinitialise la pile quand la note primaire change (navigation de page).
  useEffect(() => {
    setStack([]);
  }, [primaryNote.id]);

  const resolveAndPush = useCallback(
    async (target: string, sourceDepth: number) => {
      const newDepth = sourceDepth + 1;
      // Tronque tout ce qui est plus profond que la colonne source, ajoute un
      // placeholder à newDepth, puis résout le titre → id.
      setStack((prev) => [
        ...prev.filter((e) => e.depth < newDepth),
        { depth: newDepth, id: null, target },
      ]);
      try {
        const res = await utils.entities.search.fetch({ query: target, limit: 1 });
        const id = res.items?.[0]?.id ?? null;
        setStack((prev) =>
          prev.map((e) =>
            e.depth === newDepth && e.target === target ? { ...e, id } : e,
          ),
        );
      } catch {
        setStack((prev) =>
          prev.filter((e) => !(e.depth === newDepth && e.target === target)),
        );
      }
    },
    [utils],
  );

  // Écoute les clics wikilink remontés (bubbling) depuis n'importe quelle colonne.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ target?: string }>;
      const target = ce.detail?.target;
      if (!target) return;
      const origin = (e.target as HTMLElement | null)?.closest?.("[data-col-depth]");
      const raw = origin ? Number(origin.getAttribute("data-col-depth")) : 0;
      const sourceDepth = Number.isFinite(raw) ? raw : 0;
      void resolveAndPush(target, sourceDepth);
    };
    root.addEventListener("supernote:wikilink-click", handler as EventListener);
    return () => root.removeEventListener("supernote:wikilink-click", handler as EventListener);
  }, [resolveAndPush]);

  // Ferme la colonne `depth` et toutes celles à sa droite.
  const closeFrom = useCallback((depth: number) => {
    setStack((prev) => prev.filter((e) => e.depth < depth));
  }, []);

  const stacked = stack.length > 0;

  return (
    <div
      ref={rootRef}
      className={
        stacked
          ? "flex h-full min-h-0 flex-1 overflow-x-auto"
          : "flex h-full min-h-0 flex-1 flex-col"
      }
    >
      {/* Colonne primaire */}
      <div
        data-col-depth={0}
        className={
          stacked
            ? "flex h-full min-w-[640px] max-w-[760px] shrink-0 flex-col overflow-hidden"
            : "flex h-full min-h-0 flex-1 flex-col"
        }
        style={stacked ? { borderRight: "1px solid var(--border-subtle)" } : undefined}
      >
        <NoteEditor note={primaryNote} dimBlocks={dimBlocks} />
      </div>

      {/* Colonnes empilées */}
      {stack.map((entry) => (
        <StackColumn
          key={`${entry.depth}:${entry.target}`}
          entry={entry}
          onClose={() => closeFrom(entry.depth)}
        />
      ))}
    </div>
  );
}

function StackColumn({
  entry,
  onClose,
}: {
  entry: StackEntry;
  onClose: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const { note, isLoading } = useNote(entry.id ?? "");

  return (
    <div
      data-col-depth={entry.depth}
      className="flex h-full min-w-[560px] max-w-[680px] shrink-0 flex-col overflow-hidden"
      style={{ borderRight: "1px solid var(--border-subtle)", background: "var(--surface-0)" }}
    >
      {/* Barre de colonne : titre + actions */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
      >
        <span className="truncate text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {note ? note.title || "Sans titre" : entry.target}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {note && (
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label="Ouvrir en pleine page"
              onPress={() => router.push(`/notes/${note.id}`)}
              className="h-6 w-6 min-w-0"
            >
              <ArrowSquareOut size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Fermer la colonne"
            onPress={onClose}
            className="h-6 w-6 min-w-0"
          >
            <X size={13} />
          </Button>
        </span>
      </div>

      {/* Contenu */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {entry.id === null || isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner aria-label="Chargement" />
          </div>
        ) : note ? (
          <NoteEditor note={note} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--text-muted)" }}>
            Note introuvable : [[{entry.target}]]
          </div>
        )}
      </div>
    </div>
  );
}
