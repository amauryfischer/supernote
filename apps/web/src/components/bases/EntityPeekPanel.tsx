"use client";

/**
 * EntityPeekPanel — fiche d'entité en side-peek (le geste signature de Notion).
 *
 * Panneau droit ancré au shell (~380px), overlay plein écran sur mobile. Rendu
 * depuis `AppShell` / `MobileShell` quand `ShellChromeContext.entityPeek !== null`.
 *
 * Contrairement à `ColumnEditorSidebar`, le peek ne reçoit qu'un couple
 * `{ baseId, entityId }` : il charge donc lui-même le schéma (`schemas.get`) et
 * l'entité (`entities.get`, endpoint worker existant) — ce qui le rend
 * déclenchable depuis n'importe quelle surface (grille, carte, palette, bloc
 * inline) sans prop-drilling.
 *
 * Édition inline : chaque champ est un `<Cell>` éditable. Le commit passe par
 * `useEntityMutations().update` (déjà optimiste sur toutes les vues ouvertes) ;
 * on patche EN PLUS le cache `entities.get` de façon optimiste pour que la
 * fiche reflète la modif instantanément (le hook ne touche que `queryForView`).
 */

import { useCallback, useMemo, useRef } from "react";
import { Button } from "@heroui/react";
import { X, Trash, Copy, ArrowSquareOut } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useConfirm } from "@/lib/confirm";
import { Cell } from "./Cell";
import { useEntityMutations } from "./hooks";
import { deriveCardTitle } from "./entity-summary";

interface EntityPeekPanelProps {
  baseId: string;
  entityId: string;
}

/** Route de détail par type — miroir de `entityHref` de la palette de commandes. */
function entityHref(entityId: string, typeId: string): string {
  const t = typeId.toLowerCase();
  if (t === "personne" || t === "contact") return `/contacts/${entityId}`;
  return `/notes/${entityId}`;
}

export function EntityPeekPanel({ baseId, entityId }: EntityPeekPanelProps) {
  const { closeEntityPeek } = useShellChrome();
  const isMobile = useIsMobile();
  const router = useRouter();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const mut = useEntityMutations(baseId);

  const { data: ipcBase } = trpc.schemas.get.useQuery({ id: baseId });
  const { data: entity, isLoading } = trpc.entities.get.useQuery({ id: entityId });
  const base = useMemo(() => (ipcBase ? ipcEntityTypeToCore(ipcBase) : null), [ipcBase]);

  // Handler d'édition stable : ref sur la mutation (identité change à chaque
  // render trpc) pour ne pas invalider le memo des <Cell>.
  const updateRef = useRef(mut.update);
  updateRef.current = mut.update;

  const handleChange = useCallback(
    (fieldId: string, next: unknown) => {
      // Patch optimiste du cache `entities.get` (la source de CE panneau) —
      // `useEntityMutations` ne patche que `queryForView`.
      utils.entities.get.setData({ id: entityId }, (prev) =>
        prev
          ? {
              ...prev,
              // Le cache `entities.get` type les valeurs sans `undefined`
              // (contrairement à FieldValue) — une cellule vidée = null.
              fields: {
                ...prev.fields,
                [fieldId]: next as string | number | boolean | string[] | null,
              },
            }
          : prev,
      );
      updateRef.current.mutate(
        { id: entityId, fields: { [fieldId]: next as never } },
        {
          // Le hook partagé n'invalide que `queryForView` ; on rafraîchit en
          // plus la source de CE panneau pour récupérer les champs dérivés
          // recalculés par le worker (formule / rollup / lookup).
          onSettled: () => {
            void utils.entities.get.invalidate({ id: entityId });
          },
        },
      );
    },
    [utils, entityId],
  );

  const duplicate = useCallback(() => {
    if (!entity) return;
    mut.create.mutate({
      typeId: baseId,
      fields: entity.fields as Record<string, never>,
      body: entity.body ?? "",
    });
    closeEntityPeek();
  }, [entity, mut.create, baseId, closeEntityPeek]);

  const remove = useCallback(async () => {
    const ok = await confirm({
      title: "Supprimer cette entrée ?",
      body: <>L&apos;entrée sera déplacée dans la corbeille.</>,
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    mut.delete.mutate({ id: entityId });
    closeEntityPeek();
  }, [confirm, mut.delete, entityId, closeEntityPeek]);

  const openNote = useCallback(() => {
    if (!entity) return;
    closeEntityPeek();
    router.push(entityHref(entityId, entity.typeId));
  }, [entity, entityId, router, closeEntityPeek]);

  const title = base && entity ? deriveCardTitle(entity, base) : "Fiche";
  const canOpenNote = Boolean(entity && (entity.filePath || entity.body));

  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        width: isMobile ? "100%" : 380,
        minWidth: isMobile ? 0 : 380,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4"
        style={{ height: "var(--header-height)", borderColor: "var(--border-subtle)" }}
      >
        <span
          className="flex-1 truncate text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </span>
        <Tooltip content="Fermer">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={closeEntityPeek}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="Fermer la fiche"
          >
            <X size={13} />
          </Button>
        </Tooltip>
      </div>

      {/* Corps : liste des champs éditables */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading || !base || !entity ? (
          <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {isLoading ? "Chargement…" : "Entrée introuvable."}
          </p>
        ) : base.fields.length === 0 ? (
          <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            Aucun champ à afficher.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {base.fields.map((field) => (
              <div key={field.id} className="flex flex-col gap-1">
                <span
                  className="sn-eyebrow sn-eyebrow--compact"
                >
                  {field.label || field.name}
                </span>
                <div className="min-w-0">
                  <Cell
                    field={field}
                    value={entity.fields[field.id]}
                    onChange={(next) => handleChange(field.id, next)}
                    rowFields={entity.fields}
                    baseFields={base.fields}
                    readOnly={mut.readOnly}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pied : actions */}
      {entity && (
        <div
          className="flex shrink-0 flex-col gap-1.5 border-t px-3 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {canOpenNote && (
            <Button
              variant="ghost"
              size="sm"
              onPress={openNote}
              className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <ArrowSquareOut size={13} /> Ouvrir la note
            </Button>
          )}
          {!mut.readOnly && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onPress={duplicate}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--text-secondary)" }}
              >
                <Copy size={13} /> Dupliquer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onPress={remove}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(239,68,68,0.08)]"
                style={{ color: "#EF4444" }}
              >
                <Trash size={13} /> Supprimer
              </Button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
