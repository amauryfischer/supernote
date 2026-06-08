"use client";

/**
 * DataGrid — Coda/Notion-style editable grid for a Base + View.
 *
 * One column per visible Field (resolved via view.visibleFields / hiddenFields).
 * One row per Entity returned by `views.queryForView`. Cell edits are
 * committed immediately via `entities.update`; the query is invalidated so
 * every other open view of the same Base re-renders.
 *
 * Phase 1: no virtualization, no column resizing.
 * Phase 2: navigation clavier, copier/coller, multi-sélection lignes.
 * Phase 3: menu colonne (⋯), resize, drag-reorder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@heroui/react";
import { Plus, Trash, ArrowUp, ArrowDown, CaretDown } from "@phosphor-icons/react";
import type { EntityType, Field, SelectOption } from "@supernote/core";
import type { View, SortClause } from "@supernote/ipc";
import { useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { coreFieldToIpc } from "@/components/schemas/adapters";
import { Cell, type AdvanceDir } from "./Cell";
import {
  useEntitiesForView,
  useEntityMutations,
  useViewMutations,
  resolveVisibleFieldIds,
} from "./hooks";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { FooterSummarize } from "./FooterSummarize";
import { resolveConditionalFormat, cfStyleToCss } from "./conditional-format";
import { FieldKindIcon } from "./FieldKindIcon";
import { useShellChrome } from "@/components/shell/shell-chrome-context";

type SummarizeOp = NonNullable<View["summarize"]>[string];

// ── Transitions motion (tokens partagés, --sn-dur-1 = 90ms) ──────────────────
// La grille est dense : on veut un fondu *rapide & subtil* sur le survol/focus,
// pas le --sn-dur-2 (150ms) des composites globaux qui paraîtrait pâteux ici.
// On compose donc à partir des primitives globales (durées + easing) déjà
// définies dans globals.css — on ne redéfinit aucun token, on les consomme.
//
// Couleurs (survol header, sélection ligne, lignes d'action) :
const GRID_COLOR_TRANSITION =
  "background-color var(--sn-dur-1) var(--sn-ease-standard)," +
  " color var(--sn-dur-1) var(--sn-ease-standard)";
// Cellule : bordure focus (box-shadow) + bg sélection de la colonne primaire.
// Tokenise le `transition: box-shadow 100ms ease` du CSS .sn-datagrid-cell.
const GRID_CELL_TRANSITION =
  "box-shadow var(--sn-dur-1) var(--sn-ease-standard)," +
  " background-color var(--sn-dur-1) var(--sn-ease-standard)";

// Reduced-motion : la grille change toujours d'état, elle cesse juste de
// *bouger*. Le filet de sécurité global de globals.css ne couvre que les
// classes utilitaires (.sn-motion-*), pas les transitions inline — on gère
// donc le respect de prefers-reduced-motion ici, à la source.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

interface DataGridProps {
  base: EntityType;
  view: View;
  /** Bounded height. The grid scrolls within it; the page handles the chrome. */
  maxHeight?: string;
}

// ── Largeurs colonnes — localStorage ─────────────────────────────────────────

function colWidthsKey(baseId: string, viewId: string): string {
  return `supernote:datagrid:colWidths:${baseId}:${viewId}`;
}

function loadColWidths(baseId: string, viewId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(colWidthsKey(baseId, viewId));
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveColWidths(baseId: string, viewId: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(colWidthsKey(baseId, viewId), JSON.stringify(widths));
  } catch {
    // localStorage plein ou désactivé — pas bloquant
  }
}

// ── Composant principal ───────────────────────────────────────────────────────

export function DataGrid({ base, view, maxHeight }: DataGridProps) {
  // Transitions motion résolues (vide si reduced-motion → état change, sans mvt).
  const reducedMotion = usePrefersReducedMotion();
  const colorTransition = reducedMotion ? undefined : GRID_COLOR_TRANSITION;
  const cellTransition = reducedMotion ? undefined : GRID_CELL_TRANSITION;

  const allFieldIds = useMemo(() => base.fields.map((f) => f.id), [base.fields]);
  const visibleIds = useMemo(
    () => resolveVisibleFieldIds(view, allFieldIds),
    [view, allFieldIds],
  );
  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of base.fields) m.set(f.id, f);
    return m;
  }, [base.fields]);

  const { data, isLoading, isError } = useEntitiesForView(
    base.id,
    view.filters,
    view.sorts,
  );
  const mut = useEntityMutations(base.id);
  const { update: updateView } = useViewMutations();
  const { toast } = useToast();
  const { openColumnEditor } = useShellChrome();

  // Mutation schéma (renommer colonne, supprimer colonne)
  const utils = trpc.useUtils();
  const updateSchema = trpc.schemas.update.useMutation({
    onSuccess: () => {
      void utils.schemas.list.invalidate();
      void utils.schemas.get.invalidate({ id: base.id });
    },
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);

  // ── Largeurs colonnes (resize) ─────────────────────────────────────────────
  // Hydratation depuis localStorage au montage (initializer = exécuté une fois).
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    loadColWidths(base.id, view.id),
  );

  // Sauvegarde dès que colWidths change (les writes sont sur mouseup, donc rares)
  useEffect(() => {
    saveColWidths(base.id, view.id, colWidths);
  }, [colWidths, base.id, view.id]);

  // ── Menu colonne ──────────────────────────────────────────────────────────
  const [openMenuFid, setOpenMenuFid] = useState<string | null>(null);
  const [openMenuAnchor, setOpenMenuAnchor] = useState<HTMLElement | null>(null);
  const [rowMenu, setRowMenu] = useState<{ entityId: string; x: number; y: number } | null>(null);

  // dragJustEndedRef : après un dragend, supprime le click suivant (qui sinon
  // ouvrirait le menu alors qu'on vient de finir un drag-reorder).
  const dragJustEndedRef = useRef(false);

  const closeMenu = useCallback(() => { setOpenMenuFid(null); setOpenMenuAnchor(null); }, []);

  // ── Multi-sélection lignes ─────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Nettoyage IDs fantômes
  useEffect(() => {
    const currentIds = new Set(items.map((e) => e.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => currentIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [items]);

  // ── Auto-edit : nonce + target ─────────────────────────────────────────────
  // pendingEditTarget : (entityId, fieldId) à passer en édition au prochain
  // render qui inclut cette entité. Le nonce monotone force le useEffect
  // côté Cell à se déclencher même si la cible précédente était la même.
  const [editNonce, setEditNonce] = useState(0);
  const [pendingEditTarget, setPendingEditTarget] = useState<
    | { entityId: string; fieldId: string }
    | null
  >(null);
  // Map (entityId::fieldId) → nonce courant ; le Cell de cette adresse
  // recevra forceEditKey=nonce et passera en édition.
  const forceEditKeys = useMemo(() => {
    if (!pendingEditTarget) return new Map<string, number>();
    return new Map<string, number>([
      [`${pendingEditTarget.entityId}::${pendingEditTarget.fieldId}`, editNonce],
    ]);
  }, [pendingEditTarget, editNonce]);

  // Demande d'auto-edit en attente d'une entité encore non rendue (création).
  // Quand l'entité apparaît dans items, on déclenche pendingEditTarget.
  const pendingNewEntityRef = useRef<{ entityId: string; fieldId: string } | null>(null);

  useEffect(() => {
    const pending = pendingNewEntityRef.current;
    if (!pending) return;
    if (items.some((e) => e.id === pending.entityId)) {
      pendingNewEntityRef.current = null;
      setPendingEditTarget(pending);
      setEditNonce((n) => n + 1);
    }
  }, [items]);

  // Scroll la cellule cible dans le viewport quand la cible change.
  useEffect(() => {
    if (!pendingEditTarget) return;
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const row = wrap.querySelector<HTMLElement>(
      `tr[data-row-id="${pendingEditTarget.entityId}"]`,
    );
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pendingEditTarget, editNonce]);

  // Première colonne éditable (skip readonly comme createdAt/formula/etc.).
  const firstEditableFieldId = useMemo(() => {
    const readonlyKinds = new Set([
      "createdAt",
      "updatedAt",
      "createdBy",
      "autoNumber",
      "formula",
      "rollup",
      "lookup",
    ]);
    for (const fid of visibleIds) {
      const f = fieldById.get(fid);
      if (f && !readonlyKinds.has(f.kind)) return fid;
    }
    return visibleIds[0];
  }, [visibleIds, fieldById]);

  const addRow = useCallback(() => {
    mut.create.mutate(
      {
        typeId: base.id,
        fields: {},
        body: "",
      },
      {
        onSuccess: (created) => {
          const id =
            created && typeof created === "object" && "id" in created
              ? (created as { id: string }).id
              : null;
          if (id && firstEditableFieldId) {
            pendingNewEntityRef.current = {
              entityId: id,
              fieldId: firstEditableFieldId,
            };
          }
        },
      },
    );
  }, [mut.create, base.id, firstEditableFieldId]);

  // ── Ajouter une colonne (text par défaut, label "Colonne N") ──────────────
  // Le menu colonne reste accessible pour changer kind/nom après création.
  const addColumn = useCallback(() => {
    const id = `f_${crypto.randomUUID().slice(0, 8)}`;
    // Nom interne unique : on dérive depuis un compteur basé sur les noms
    // existants (évite collision si l'utilisateur a déjà supprimé/ajouté).
    let n = base.fields.length + 1;
    const existingNames = new Set(base.fields.map((f) => f.name));
    while (existingNames.has(`field_${n}`)) n++;
    const newField: Field = {
      id,
      name: `field_${n}`,
      label: `Colonne ${n}`,
      kind: "text",
      required: false,
      unique: false,
    };
    const nextFields = [...base.fields, newField];
    updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
    // Si la vue a un ordre explicite, l'étendre. Sinon resolveVisibleFieldIds
    // dérivera automatiquement le nouvel id depuis base.fields.
    if (view.visibleFields.length > 0) {
      updateView.mutate({ id: view.id, visibleFields: [...view.visibleFields, id] });
    }
    // Ouvre directement le menu sur la nouvelle colonne pour pouvoir renommer.
    setOpenMenuFid(id);
  }, [base.fields, base.id, view.id, view.visibleFields, updateSchema, updateView]);

  // Cache handlers stables (évite React.memo(Cell) cache miss)
  const updateRef = useRef(mut.update);
  updateRef.current = mut.update;
  const handlerCacheRef = useRef(
    new Map<string, (next: unknown, advance?: AdvanceDir) => void>(),
  );
  const [justEdited, setJustEdited] = useState<{ entityId: string; fieldId: string; ts: number } | null>(null);
  const justEditedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // computeAdvanceRef : indirection pour éviter d'invalider le cache de handlers
  // quand items / visibleIds changent. Pointé vers la dernière fonction via
  // l'effet plus bas — les handlers stables capturent juste la ref.
  const computeAdvanceRef = useRef<
    (entityId: string, fieldId: string, advance: AdvanceDir) => void
  >(() => {});

  const getCellHandler = useCallback(
    (entityId: string, fieldId: string) => {
      const key = `${entityId}::${fieldId}`;
      const cache = handlerCacheRef.current;
      const cached = cache.get(key);
      if (cached) return cached;
      const handler = (next: unknown, advance?: AdvanceDir) => {
        updateRef.current.mutate({
          id: entityId,
          fields: { [fieldId]: next as never },
        });
        setJustEdited({ entityId, fieldId, ts: Date.now() });
        if (justEditedTimer.current) clearTimeout(justEditedTimer.current);
        justEditedTimer.current = setTimeout(() => setJustEdited(null), 1400);
        if (advance) computeAdvanceRef.current(entityId, fieldId, advance);
      };
      cache.set(key, handler);
      return handler;
    },
    [],
  );

  // Track rows déjà rendues → animation "enter" seulement sur nouvelles
  const seenRowsRef = useRef<Set<string>>(new Set());
  const isFreshRow = useCallback((id: string) => {
    if (seenRowsRef.current.has(id)) return false;
    seenRowsRef.current.add(id);
    return true;
  }, []);

  // ── Tri colonnes ──────────────────────────────────────────────────────────
  // sortByField(fieldId) : cycle asc → desc → none.
  // sortByField(fieldId, "asc"|"desc") : force la direction.
  // sortByField(fieldId, null) : efface le tri.
  const sortByField = useCallback(
    (fieldId: string, direction?: "asc" | "desc" | null) => {
      const current = view.sorts.find((s) => s.fieldId === fieldId);
      let next: SortClause[];
      if (direction === null) {
        // Effacer le tri
        next = view.sorts.filter((s) => s.fieldId !== fieldId);
      } else if (direction === "asc" || direction === "desc") {
        // Forcer une direction
        const without = view.sorts.filter((s) => s.fieldId !== fieldId);
        next = [{ fieldId, direction }];
        // Conserve les autres tris (le menu ne fait que changer ce champ)
        // Note: on remplace tout par un tri unique sur ce champ pour
        // rester cohérent avec la logique précédente.
        void without;
      } else {
        // Cycle : none → asc → desc → none
        if (!current) {
          next = [{ fieldId, direction: "asc" }];
        } else if (current.direction === "asc") {
          next = [{ fieldId, direction: "desc" }];
        } else {
          next = view.sorts.filter((s) => s.fieldId !== fieldId);
        }
      }
      updateView.mutate({ id: view.id, sorts: next });
    },
    [view.id, view.sorts, updateView],
  );

  // ── Renommer colonne ──────────────────────────────────────────────────────
  const renameColumn = useCallback(
    (fieldId: string, newLabel: string) => {
      const nextFields = base.fields.map((f) =>
        f.id === fieldId ? { ...f, label: newLabel } : f,
      );
      updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
    },
    [base.fields, base.id, updateSchema],
  );

  // ── Masquer colonne ───────────────────────────────────────────────────────
  const hideColumn = useCallback(
    (fieldId: string) => {
      const nextVisible = visibleIds.filter((id) => id !== fieldId);
      const currentHidden = view.hiddenFields ?? [];
      const nextHidden = currentHidden.includes(fieldId)
        ? currentHidden
        : [...currentHidden, fieldId];
      updateView.mutate({ id: view.id, visibleFields: nextVisible, hiddenFields: nextHidden });
    },
    [visibleIds, view.id, view.hiddenFields, updateView],
  );

  // ── Convertir colonne en formule ──────────────────────────────────────────
  const convertToFormula = useCallback(
    (fieldId: string, expression: string, outputKind: "text" | "number" | "date" | "bool", outputFormat?: string) => {
      const nextFields = base.fields.map((f) =>
        f.id === fieldId
          ? {
              id: f.id,
              name: f.name,
              label: f.label,
              required: f.required ?? false,
              unique: f.unique ?? false,
              kind: "formula" as const,
              expression,
              outputKind,
              outputFormat,
            }
          : f,
      );
      updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
    },
    [base.fields, base.id, updateSchema],
  );

  // ── Supprimer colonne ─────────────────────────────────────────────────────
  const deleteColumn = useCallback(
    (fieldId: string) => {
      const nextFields = base.fields.filter((f) => f.id !== fieldId);
      const nextVisible = visibleIds.filter((id) => id !== fieldId);
      const currentHidden = view.hiddenFields ?? [];
      const nextHidden = currentHidden.filter((id) => id !== fieldId);
      updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
      updateView.mutate({ id: view.id, visibleFields: nextVisible, hiddenFields: nextHidden });
    },
    [base.fields, base.id, visibleIds, view.id, view.hiddenFields, updateSchema, updateView],
  );

  // ── Suppression avec undo ─────────────────────────────────────────────────
  const deleteWithUndo = useCallback(
    (entityId: string) => {
      const snapshot = items.find((e) => e.id === entityId);
      if (!snapshot) return;
      mut.delete.mutate({ id: entityId });
      toast({
        title: "Entrée supprimée",
        duration: 5000,
        action: {
          label: "Annuler",
          onClick: () => {
            mut.create.mutate({
              typeId: base.id,
              fields: snapshot.fields as Record<string, never>,
              body: "",
            });
          },
        },
      });
    },
    [items, mut.delete, mut.create, base.id, toast],
  );

  const bulkDeleteWithUndo = useCallback(
    (ids: string[]) => {
      const snapshots = ids
        .map((id) => items.find((e) => e.id === id))
        .filter(Boolean) as typeof items;
      if (snapshots.length === 0) return;
      for (const e of snapshots) {
        mut.delete.mutate({ id: e.id });
      }
      toast({
        title: `${snapshots.length} entrée${snapshots.length > 1 ? "s" : ""} supprimée${snapshots.length > 1 ? "s" : ""}`,
        duration: 5000,
        action: {
          label: "Annuler",
          onClick: () => {
            for (const e of snapshots) {
              mut.create.mutate({
                typeId: base.id,
                fields: e.fields as Record<string, never>,
                body: "",
              });
            }
          },
        },
      });
    },
    [items, mut.delete, mut.create, base.id, toast],
  );

  // ── Suppr / Backspace sur lignes sélectionnées ────────────────────────────
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable)
      ) {
        return;
      }
      if (!wrapperRef.current?.contains(active) && active !== document.body) {
        return;
      }
      e.preventDefault();
      const ids = Array.from(selectedIds);
      setSelectedIds(new Set());
      if (ids.length === 1 && ids[0]) {
        deleteWithUndo(ids[0]);
      } else {
        bulkDeleteWithUndo(ids);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds, deleteWithUndo, bulkDeleteWithUndo]);

  // ── Navigation + copier/coller clavier ───────────────────────────────────
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fieldByIdRef = useRef(fieldById);
  fieldByIdRef.current = fieldById;
  const visibleIdsRef = useRef(visibleIds);
  visibleIdsRef.current = visibleIds;

  // Advance après commit (Tab / Shift+Tab / Enter / Shift+Enter).
  // Cherche dynamiquement la prochaine cellule éditable et déclenche
  // l'auto-edit. Si on dépasse la dernière ligne avec Tab, crée une row.
  useEffect(() => {
    const readonlyKinds = new Set([
      "createdAt",
      "updatedAt",
      "createdBy",
      "autoNumber",
      "formula",
      "rollup",
      "lookup",
    ]);
    const isEditableAt = (col: number) => {
      const fid = visibleIdsRef.current[col];
      if (!fid) return false;
      const f = fieldByIdRef.current.get(fid);
      return !!f && !readonlyKinds.has(f.kind);
    };
    computeAdvanceRef.current = (entityId, fieldId, advance) => {
      const currentItems = itemsRef.current;
      const currentVisible = visibleIdsRef.current;
      const rowIdx = currentItems.findIndex((e) => e.id === entityId);
      const colIdx = currentVisible.indexOf(fieldId);
      if (rowIdx < 0 || colIdx < 0) return;
      const lastRow = currentItems.length - 1;
      const lastCol = currentVisible.length - 1;
      let nr = rowIdx;
      let nc = colIdx;
      const step = (): boolean => {
        // Avance une fois selon `advance`. Retourne false si on est tombé
        // hors grille (Tab après dernière col + dernière ligne, ou
        // Shift+Tab avant première col + première ligne).
        if (advance === "tab") {
          nc += 1;
          if (nc > lastCol) {
            nc = 0;
            nr += 1;
          }
        } else if (advance === "shift-tab") {
          nc -= 1;
          if (nc < 0) {
            nc = lastCol;
            nr -= 1;
          }
        } else if (advance === "enter") {
          nr += 1;
        } else if (advance === "shift-enter") {
          nr -= 1;
        }
        return nr >= 0 && nr <= lastRow;
      };
      // Avance d'au moins une étape. Si la cible est readonly, continue.
      let safety = currentVisible.length * 2 + 4;
      do {
        const ok = step();
        if (!ok) {
          if (advance === "tab" || advance === "enter") {
            addRow();
          }
          return;
        }
      } while (!isEditableAt(nc) && --safety > 0);
      if (safety <= 0) return;
      const nextEntity = currentItems[nr];
      const nextFid = currentVisible[nc];
      if (!nextEntity || !nextFid) return;
      setPendingEditTarget({ entityId: nextEntity.id, fieldId: nextFid });
      setEditNonce((n) => n + 1);
    };
  }, [addRow]);

  const handleWrapperKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;

      // ── Navigation flèches ────────────────────────────────────────────────
      const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      if (isArrow && target.hasAttribute("data-cell-display")) {
        const td = target.closest("td[data-cell-row]") as HTMLElement | null;
        if (!td) return;
        const rowIdx = Number(td.dataset.cellRow);
        const colIdx = Number(td.dataset.cellCol);
        const rowCount = itemsRef.current.length;
        const colCount = visibleIds.length;

        let nextRow = rowIdx;
        let nextCol = colIdx;

        if (e.key === "ArrowDown") {
          nextRow = Math.min(rowIdx + 1, rowCount - 1);
        } else if (e.key === "ArrowUp") {
          nextRow = Math.max(rowIdx - 1, 0);
        } else if (e.key === "ArrowRight") {
          if (colIdx < colCount - 1) {
            nextCol = colIdx + 1;
          } else if (rowIdx < rowCount - 1) {
            nextRow = rowIdx + 1;
            nextCol = 0;
          }
        } else if (e.key === "ArrowLeft") {
          if (colIdx > 0) {
            nextCol = colIdx - 1;
          } else if (rowIdx > 0) {
            nextRow = rowIdx - 1;
            nextCol = colCount - 1;
          }
        }

        if (nextRow !== rowIdx || nextCol !== colIdx) {
          e.preventDefault();
          const nextTd = wrapperRef.current?.querySelector<HTMLElement>(
            `td[data-cell-row="${nextRow}"][data-cell-col="${nextCol}"] [data-cell-display]`,
          );
          nextTd?.focus();
        }
        return;
      }

      // ── Copier Cmd/Ctrl+C ─────────────────────────────────────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && target.hasAttribute("data-cell-display")) {
        const td = target.closest("td[data-field-id]") as HTMLElement | null;
        if (!td) return;
        const tr = td.closest("tr[data-row-id]") as HTMLElement | null;
        if (!tr) return;
        const entityId = tr.dataset.rowId!;
        const fieldId = td.dataset.fieldId!;
        const entity = itemsRef.current.find((e) => e.id === entityId);
        if (!entity) return;
        const value = entity.fields[fieldId];
        const text = serializeCellValue(value);
        e.preventDefault();
        void navigator.clipboard.writeText(text);
        return;
      }

      // ── Coller Cmd/Ctrl+V ─────────────────────────────────────────────────
      if ((e.metaKey || e.ctrlKey) && e.key === "v" && target.hasAttribute("data-cell-display")) {
        const td = target.closest("td[data-field-id]") as HTMLElement | null;
        if (!td) return;
        const tr = td.closest("tr[data-row-id]") as HTMLElement | null;
        if (!tr) return;
        const entityId = tr.dataset.rowId!;
        const fieldId = td.dataset.fieldId!;
        const field = fieldByIdRef.current.get(fieldId);
        if (!field) return;
        if (READONLY_PASTE_KINDS.has(field.kind)) return;
        e.preventDefault();
        void navigator.clipboard.readText().then((text) => {
          const parsed = parsePasteValue(text, field);
          if (parsed === SKIP) return;
          const handler = getCellHandler(entityId, fieldId);
          handler(parsed);
        });
        return;
      }
    },
    [visibleIds.length, getCellHandler],
  );

  // ── Drag-reorder colonnes ─────────────────────────────────────────────────
  // dragOverFid : fieldId du th survolé (null = aucun).
  // dropSide : "before" | "after" selon la moitié du th survolée.
  const [dragOverFid, setDragOverFid] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<"before" | "after">("before");
  const draggingFidRef = useRef<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLTableCellElement>, fid: string) => {
    draggingFidRef.current = fid;
    e.dataTransfer.setData("text/plain", fid);
    e.dataTransfer.effectAllowed = "move";
    // Classe CSS ajoutée via state pour éviter de perdre la ref
    (e.currentTarget as HTMLElement).classList.add("sn-datagrid-th--dragging");
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLTableCellElement>) => {
    (e.currentTarget as HTMLElement).classList.remove("sn-datagrid-th--dragging");
    draggingFidRef.current = null;
    setDragOverFid(null);
    // Bloque le click suivant (qui sinon ouvrirait le menu)
    dragJustEndedRef.current = true;
    setTimeout(() => { dragJustEndedRef.current = false; }, 100);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLTableCellElement>, fid: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDragOverFid(fid);
    setDropSide(side);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverFid(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLTableCellElement>, targetFid: string) => {
      e.preventDefault();
      const sourceFid = e.dataTransfer.getData("text/plain");
      if (!sourceFid || sourceFid === targetFid) {
        setDragOverFid(null);
        return;
      }
      // Calcule le nouvel ordre
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const insertAfter = e.clientX >= rect.left + rect.width / 2;
      const without = visibleIds.filter((id) => id !== sourceFid);
      const targetIdx = without.indexOf(targetFid);
      const insertAt = insertAfter ? targetIdx + 1 : targetIdx;
      const nextOrder = [...without];
      nextOrder.splice(insertAt, 0, sourceFid);
      setDragOverFid(null);
      updateView.mutate({ id: view.id, visibleFields: nextOrder });
    },
    [visibleIds, view.id, updateView],
  );

  // ── Resize colonnes ───────────────────────────────────────────────────────
  // On attache les listeners sur document (mouseup global, mousemove global)
  // pour que le drag fonctionne même si la souris sort du handle.
  const resizeStateRef = useRef<{
    fid: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, fid: string, currentWidth: number) => {
      e.stopPropagation(); // ne pas ouvrir le menu
      e.preventDefault();
      resizeStateRef.current = { fid, startX: e.clientX, startWidth: currentWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (mv: MouseEvent) => {
        if (!resizeStateRef.current) return;
        const { fid: rFid, startX, startWidth } = resizeStateRef.current;
        const delta = mv.clientX - startX;
        const next = Math.max(60, Math.min(600, startWidth + delta));
        setColWidths((prev) => ({ ...prev, [rFid]: next }));
      };

      const onUp = () => {
        resizeStateRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [],
  );

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={wrapperRef}
      className="overflow-auto"
      style={{
        maxHeight: maxHeight ?? "100%",
        backgroundColor: "var(--surface-0)",
      }}
      onKeyDown={handleWrapperKeyDown}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-row-id]")) setSelectedIds(new Set());
      }}
    >
      <table
        className={`sn-datagrid sn-datagrid--${view.rowHeight ?? "normal"} w-full border-collapse text-sm`}
        style={{ userSelect: "none" }}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          // Laisse les éléments éditables (input/textarea/contenteditable) faire leur sélection.
          if (
            t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable ||
            t.closest("input, textarea, [contenteditable]")
          ) return;
          // Pas de double-click → on prévient la sélection texte du browser.
          if (e.detail >= 2) return;
          e.preventDefault();
        }}
      >
        <thead
          className="sticky top-0 z-10"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          <tr>
            {/* Colonne index */}
            <th
              className="sticky left-0 border-b border-r px-2 py-2 text-left text-xs font-medium"
              style={{
                width: 36,
                minWidth: 36,
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
                backgroundColor: "var(--surface-1)",
              }}
            >
              #
            </th>

            {visibleIds.map((fid, headerColIdx) => {
              const f = fieldById.get(fid);
              if (!f) return null;
              const sort = view.sorts.find((s) => s.fieldId === fid);
              const colW = colWidths[fid] ?? columnMinWidth(f);
              const isPrimary = headerColIdx === 0;

              // Classes CSS pour le drag-over visuel
              let dropClass = "";
              if (dragOverFid === fid && draggingFidRef.current !== fid) {
                dropClass = dropSide === "before"
                  ? " sn-datagrid-th--drop-before"
                  : " sn-datagrid-th--drop-after";
              }

              return (
                <th
                  key={fid}
                  draggable
                  data-field-id={fid}
                  className={`group/header relative cursor-pointer border-b border-r px-3 text-left text-[12px] font-semibold hover:bg-[var(--surface-2)]${dropClass}${isPrimary ? " sn-datagrid-primary-col" : ""}`}
                  style={{
                    width: colW,
                    minWidth: colW,
                    maxWidth: colW,
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                    position: isPrimary ? "sticky" : "relative",
                    left: isPrimary ? 36 : undefined,
                    backgroundColor: isPrimary ? "var(--surface-1)" : undefined,
                    zIndex: isPrimary ? 11 : undefined,
                    // Survol header : fondu couleur subtil & rapide (--sn-dur-1).
                    transition: colorTransition,
                  }}
                  title="Clic gauche : trier (asc → desc → aucun) · Clic droit : options"
                  onClick={(e) => {
                    if (dragJustEndedRef.current) return;
                    // Clic sur la caret ▼ : la propagation est stoppée par
                    // le bouton lui-même (cf. plus bas). Donc ici on est
                    // forcément sur le label → cycle de tri.
                    void e;
                    sortByField(fid);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (dragJustEndedRef.current) return;
                    setOpenMenuAnchor(e.currentTarget as HTMLElement);
                    setOpenMenuFid(fid);
                  }}
                  onDragStart={(e) => handleDragStart(e, fid)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(e, fid)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, fid)}
                >
                  {/* Libellé + icône type + indicateur tri + chevron menu */}
                  <span className="inline-flex w-full items-center gap-1.5 select-none">
                    <span
                      className="inline-flex items-center justify-center"
                      style={{ color: "var(--text-muted)" }}
                      aria-hidden
                    >
                      <FieldKindIcon kind={f.kind} size={11} />
                    </span>
                    <span className="truncate">{f.label || f.name}</span>
                    {sort && (
                      sort.direction === "asc" ? (
                        <ArrowUp size={11} weight="bold" style={{ color: "var(--accent)" }} />
                      ) : (
                        <ArrowDown size={11} weight="bold" style={{ color: "var(--accent)" }} />
                      )
                    )}
                    <button
                      type="button"
                      aria-label="Options de la colonne"
                      className="ml-auto rounded p-0.5 hover:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      style={{ color: "var(--text-muted)", opacity: 0.55, transition: colorTransition }}
                      draggable={false}
                      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        const th = (e.currentTarget as HTMLElement).closest("th");
                        setOpenMenuAnchor(th as HTMLElement | null);
                        setOpenMenuFid((prev) => (prev === fid ? null : fid));
                      }}
                    >
                      <CaretDown size={10} weight="bold" />
                    </button>
                  </span>

                  {/* Menu popover */}
                  {openMenuFid === fid && (
                    <ColumnHeaderMenu
                      anchorEl={openMenuAnchor}
                      field={f}
                      currentSort={sort}
                      base={base}
                      onSort={(dir) => sortByField(fid, dir)}
                      onRename={(label) => renameColumn(fid, label)}
                      onHide={() => hideColumn(fid)}
                      onDelete={() => deleteColumn(fid)}
                      onEditField={() => { openColumnEditor(base, view, { focusFieldId: fid }); closeMenu(); }}
                      onConvertToFormula={(expression, outputKind, outputFormat) => {
                        convertToFormula(fid, expression, outputKind, outputFormat);
                        closeMenu();
                      }}
                      onClose={closeMenu}
                    />
                  )}

                  {/* Handle resize (bord droit) */}
                  <span
                    className="sn-datagrid-resize-handle"
                    onMouseDown={(e) => handleResizeMouseDown(e, fid, colW)}
                    onClick={(e) => e.stopPropagation()}
                    role="separator"
                    aria-label="Redimensionner la colonne"
                  />
                </th>
              );
            })}

            {/* Bouton « + ajouter une colonne » */}
            <th
              className="border-b px-2 py-2 text-xs cursor-pointer hover:bg-[var(--surface-2)]"
              style={{
                width: 36,
                minWidth: 36,
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
                transition: colorTransition,
              }}
              title="Ajouter une colonne"
              onClick={addColumn}
            >
              <Plus size={12} />
            </th>

            {/* Colonne actions (trailing) */}
            <th
              className="border-b px-1 py-2 text-xs"
              style={{
                width: 44,
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
              }}
            />
          </tr>
        </thead>

        <tbody>
          {isLoading && (
            <>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={`skel-${i}`}>
                  <td
                    className="sticky left-0 border-r px-2 py-2"
                    style={{
                      borderColor: "var(--border-subtle)",
                      backgroundColor: "var(--surface-0)",
                    }}
                  >
                    <div className="sn-datagrid-skeleton" style={{ width: 14 }} />
                  </td>
                  {visibleIds.map((fid) => (
                    <td
                      key={fid}
                      className="border-r px-2 py-2"
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <div className="sn-datagrid-skeleton" style={{ width: `${40 + ((i * 13) % 50)}%` }} />
                    </td>
                  ))}
                  <td />
                  <td />
                </tr>
              ))}
            </>
          )}
          {isError && (
            <tr>
              <td
                colSpan={visibleIds.length + 3}
                className="px-3 py-8 text-center text-xs"
                style={{ color: "#EF4444" }}
              >
                Erreur de chargement
              </td>
            </tr>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <tr>
              <td
                colSpan={visibleIds.length + 3}
                className="px-3 py-8 text-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Aucune entrée. Cliquez sur « + Nouvelle entrée » en bas.
              </td>
            </tr>
          )}
          {items.map((entity, idx) => {
            const isSelected = selectedIds.has(entity.id);
            const fresh = isFreshRow(entity.id);
            const isLastRow = idx === items.length - 1;
            return (
              <tr
                key={entity.id}
                className={`sn-datagrid-row group${fresh ? " sn-datagrid-row--enter" : ""}`}
                data-row-id={entity.id}
                data-selected={isSelected || undefined}
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
                onContextMenu={(e) => {
                  // Laisse le contextmenu natif sur les inputs/textareas (édition cellule).
                  const t = e.target as HTMLElement;
                  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
                  e.preventDefault();
                  setRowMenu({ entityId: entity.id, x: e.clientX, y: e.clientY });
                }}
              >
                <td
                  className="sticky left-0 cursor-pointer border-r px-1 py-1 text-xs select-none"
                  style={{
                    borderColor: "var(--border-subtle)",
                    color: isSelected ? "var(--accent)" : "var(--text-muted)",
                    backgroundColor: isSelected ? "var(--surface-2)" : "var(--surface-0)",
                    fontWeight: isSelected ? 600 : 400,
                    width: 36,
                    minWidth: 36,
                    userSelect: "none",
                    // Sélection : fondu bg/couleur tokenisé (suit la ligne).
                    transition: colorTransition,
                  }}
                  onMouseDown={(e) => { e.preventDefault(); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey && lastSelectedIdRef.current) {
                      const lastIdx = items.findIndex((i) => i.id === lastSelectedIdRef.current);
                      const range = items
                        .slice(Math.min(lastIdx, idx), Math.max(lastIdx, idx) + 1)
                        .map((i) => i.id);
                      setSelectedIds((prev) => new Set([...prev, ...range]));
                    } else if (e.metaKey || e.ctrlKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(entity.id)) next.delete(entity.id);
                        else next.add(entity.id);
                        return next;
                      });
                    } else {
                      setSelectedIds((prev) => {
                        if (prev.size === 1 && prev.has(entity.id)) return new Set();
                        return new Set([entity.id]);
                      });
                    }
                    lastSelectedIdRef.current = entity.id;
                  }}
                  title="Cliquer pour sélectionner · Shift/Ctrl pour multi-sélection · Suppr pour supprimer"
                >
                  <div className="flex h-full items-center justify-center">
                    {isSelected ? (
                      <span style={{ color: "var(--accent)" }}>✓</span>
                    ) : (
                      <span>{idx + 1}</span>
                    )}
                  </div>
                </td>

                {visibleIds.map((fid, colIdx) => {
                  const f = fieldById.get(fid);
                  if (!f) return null;
                  const isLastCol = colIdx === visibleIds.length - 1;
                  const isPrimaryCol = colIdx === 0;
                  const justEditedHere =
                    justEdited?.entityId === entity.id && justEdited?.fieldId === fid;
                  const cf = resolveConditionalFormat(
                    entity.fields[fid],
                    entity.fields,
                    fid,
                    (view.conditionalFormats ?? []) as never,
                  );
                  const cfCss = cfStyleToCss(cf.cellStyle ?? cf.rowStyle);
                  return (
                    <td
                      key={fid}
                      data-cell-row={idx}
                      data-cell-col={colIdx}
                      data-field-id={fid}
                      className={`sn-datagrid-cell border-r p-0${justEditedHere ? " sn-datagrid-cell--just-edited" : ""}${isPrimaryCol ? " sn-datagrid-primary-col" : ""}`}
                      style={{
                        borderColor: "var(--border-subtle)",
                        verticalAlign: "top",
                        position: isPrimaryCol ? "sticky" : undefined,
                        left: isPrimaryCol ? 36 : undefined,
                        backgroundColor: cfCss.backgroundColor ?? (isPrimaryCol
                          ? (isSelected ? "var(--surface-2)" : "var(--surface-0)")
                          : undefined),
                        color: cfCss.color,
                        fontWeight: cfCss.fontWeight,
                        fontStyle: cfCss.fontStyle,
                        zIndex: isPrimaryCol ? 1 : undefined,
                        // Bordure focus cellule + bg sélection (col. primaire) :
                        // fondu rapide & subtil (--sn-dur-1). Tokenise le
                        // box-shadow CSS et inclut bg pour la col. sticky.
                        transition: cellTransition,
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Tab" &&
                          !e.shiftKey &&
                          isLastRow &&
                          isLastCol
                        ) {
                          e.preventDefault();
                          addRow();
                        }
                      }}
                    >
                      <Cell
                        field={f}
                        value={entity.fields[fid]}
                        onChange={getCellHandler(entity.id, fid)}
                        forceEditKey={forceEditKeys.get(`${entity.id}::${fid}`)}
                        rowFields={entity.fields}
                        baseFields={base.fields as unknown as Field[]}
                      />
                    </td>
                  );
                })}

                {/* Cellule vide alignée sous la colonne « + » du header */}
                <td />

                <td className="px-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded p-1 opacity-0 transition-opacity hover:bg-[var(--surface-2)] group-hover:opacity-100"
                    aria-label="Supprimer la ligne"
                    onPress={() => deleteWithUndo(entity.id)}
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Trash size={14} />
                  </Button>
                </td>
              </tr>
            );
          })}

          {/* + Nouvelle entrée — toute la ligne est cliquable */}
          <tr
            className="cursor-pointer hover:bg-[var(--surface-2)]"
            style={{ transition: colorTransition }}
            onClick={addRow}
          >
            <td
              colSpan={visibleIds.length + 3}
              className="px-2 py-2"
              style={{ borderTop: "1px solid var(--border-subtle)" }}
            >
              <span
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                <Plus size={12} /> Nouvelle entrée
              </span>
            </td>
          </tr>

          {/* Footer Summarize (par colonne) */}
          {!isLoading && items.length > 0 && (
            <FooterSummarize
              view={view}
              fields={base.fields as unknown as Field[]}
              visibleIds={visibleIds}
              colWidths={colWidths}
              rows={items.map((e) => ({ fields: e.fields ?? {} }))}
              onUpdate={(summarize) => {
                updateView.mutate({
                  id: view.id,
                  summarize: summarize as Record<string, SummarizeOp>,
                });
              }}
            />
          )}

          {/* Footer compteur */}
          {!isLoading && items.length > 0 && (
            <tr>
              <td
                colSpan={visibleIds.length + 3}
                className="px-2 py-1.5 text-[11px]"
                style={{
                  borderTop: "1px solid var(--border-subtle)",
                  color: "var(--text-muted)",
                  backgroundColor: "var(--surface-1)",
                }}
              >
                {items.length} entrée{items.length > 1 ? "s" : ""}
                {selectedIds.size > 0 && (
                  <span style={{ marginLeft: 8, color: "var(--accent)" }}>
                    · {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
                  </span>
                )}
                {view.filters.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    · {view.filters.length} filtre{view.filters.length > 1 ? "s" : ""} actif{view.filters.length > 1 ? "s" : ""}
                  </span>
                )}
                {view.sorts.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    · trié par {view.sorts.length} colonne{view.sorts.length > 1 ? "s" : ""}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rowMenu && createPortal(
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          isMultiSelected={selectedIds.size > 1 && selectedIds.has(rowMenu.entityId)}
          selectedCount={selectedIds.size}
          onDuplicate={() => {
            const ent = items.find((e) => e.id === rowMenu.entityId);
            if (ent) mut.create.mutate({ typeId: base.id, fields: ent.fields as Record<string, never>, body: "" });
            setRowMenu(null);
          }}
          onDelete={() => {
            if (selectedIds.size > 1 && selectedIds.has(rowMenu.entityId)) {
              for (const id of selectedIds) deleteWithUndo(id);
              setSelectedIds(new Set());
            } else {
              deleteWithUndo(rowMenu.entityId);
            }
            setRowMenu(null);
          }}
          onClose={() => setRowMenu(null)}
        />,
        document.body,
      )}
    </div>
  );
}

// ── RowContextMenu ────────────────────────────────────────────────────────────

function RowContextMenu({
  x, y, isMultiSelected, selectedCount, onDuplicate, onDelete, onClose,
}: {
  x: number; y: number; isMultiSelected: boolean; selectedCount: number;
  onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 9999,
        minWidth: 180,
        backgroundColor: "var(--surface-0)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        padding: "4px 0",
        fontSize: 12,
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onPress={onDuplicate}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-secondary)" }}
      >
        Dupliquer
      </Button>
      <div style={{ height: 1, backgroundColor: "var(--border-subtle)", margin: "2px 0" }} />
      <Button
        variant="ghost"
        size="sm"
        onPress={onDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[rgba(239,68,68,0.08)]"
        style={{ color: "#EF4444" }}
      >
        {isMultiSelected ? `Supprimer ${selectedCount} entrées` : "Supprimer"}
      </Button>
    </div>
  );
}

// ── Sérialisation valeur → texte (pour Cmd+C) ─────────────────────────────

function serializeCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ── Parsing coller → valeur typée (pour Cmd+V) ────────────────────────────

/** Sentinelle : signifie "ne pas coller" (parse échoué ou champ en lecture seule). */
const SKIP = Symbol("SKIP");

const READONLY_PASTE_KINDS = new Set<Field["kind"]>([
  "createdAt",
  "updatedAt",
  "createdBy",
  "autoNumber",
  "formula",
  "rollup",
  "lookup",
]);

const BOOL_TRUTHY = new Set(["true", "1", "oui", "yes", "x", "✓"]);

function parsePasteValue(text: string, field: Field): unknown | typeof SKIP {
  const s = text.trim();
  switch (field.kind) {
    case "text":
    case "longtext":
    case "markdown":
    case "url":
    case "email":
    case "phone":
    case "color":
      return s;

    case "number":
    case "currency":
    case "percent":
    case "duration":
    case "rating":
    case "progress": {
      const n = Number(s);
      return Number.isNaN(n) ? SKIP : n;
    }

    case "bool":
      return BOOL_TRUTHY.has(s.toLowerCase());

    case "date":
    case "datetime": {
      const d = new Date(s);
      return d.toString() === "Invalid Date" ? SKIP : d.toISOString();
    }

    case "select":
    case "status": {
      const opts = (field as { options: SelectOption[] }).options;
      const lower = s.toLowerCase();
      const match = opts.find(
        (o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower,
      );
      return match ? match.value : SKIP;
    }

    case "multiselect": {
      const opts = (field as { options: SelectOption[] }).options;
      const parts = s.split(",").map((p) => p.trim().toLowerCase());
      const values = parts
        .map((p) => opts.find((o) => o.value.toLowerCase() === p || o.label.toLowerCase() === p))
        .filter(Boolean)
        .map((o) => o!.value);
      return values.length > 0 ? values : SKIP;
    }

    default:
      return SKIP;
  }
}

// ── Largeur minimale colonnes ─────────────────────────────────────────────

function columnMinWidth(field: Field): number {
  switch (field.kind) {
    case "bool":
      return 64;
    case "rating":
      return 100;
    case "number":
    case "currency":
    case "percent":
    case "duration":
      return 110;
    case "date":
    case "datetime":
      return 140;
    case "longtext":
    case "markdown":
      return 260;
    case "select":
    case "multiselect":
    case "status":
      return 140;
    default:
      return 160;
  }
}
