"use client";

/**
 * ColumnHeaderMenu — popover ancré sur un <th> de DataGrid.
 *
 * Fournit : renommer, trier (asc/desc/effacer), masquer, supprimer une colonne.
 * Se ferme au clic extérieur et à Escape.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Button } from "@heroui/react";
import {
  SortAscending,
  SortDescending,
  EyeSlash,
  Trash,
  PencilSimple,
  X,
  FunctionIcon,
} from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import type { SortClause } from "@supernote/ipc";
import { FormulaInputEditor } from "./FormulaInputEditor";

type FormulaOutputKind = "text" | "number" | "date" | "bool";

// ── Types publics ─────────────────────────────────────────────────────────────

export interface ColumnHeaderMenuProps {
  /** Élément <th> servant d'ancre pour positionner le menu. */
  anchorEl: HTMLElement | null;
  /** Champ cible du menu. */
  field: Field;
  /** État de tri actuel pour ce champ (undefined = pas de tri). */
  currentSort: SortClause | undefined;
  /** Base courante (utile pour suggérer des snippets cross-base). */
  base: EntityType;
  /** Appelé quand l'utilisateur choisit de trier (direction ou null pour effacer). */
  onSort: (direction: "asc" | "desc" | null) => void;
  /** Appelé quand l'utilisateur confirme un renommage. */
  onRename: (newLabel: string) => void;
  /** Appelé pour masquer la colonne. */
  onHide: () => void;
  /** Appelé pour supprimer la colonne (après confirmation). */
  onDelete: () => void;
  /** Ouvre l'éditeur de colonnes ciblé sur ce champ. */
  onEditField: () => void;
  /** Convertit la colonne courante en formule (remplace son kind, garde id/name/label). */
  onConvertToFormula: (expression: string, outputKind: FormulaOutputKind, outputFormat?: string) => void;
  /** Ferme le menu. */
  onClose: () => void;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ColumnHeaderMenu({
  anchorEl,
  field,
  currentSort,
  base,
  onSort,
  onRename,
  onHide,
  onDelete,
  onEditField,
  onConvertToFormula,
  onClose,
}: ColumnHeaderMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Phase locale : "menu" | "rename" | "confirm-delete" | "formula"
  const [phase, setPhase] = useState<"menu" | "rename" | "confirm-delete" | "formula">("menu");
  const [renameValue, setRenameValue] = useState(field.label || field.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Position fixed via getBoundingClientRect du <th> anchor ─────────────────
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorEl, phase]);

  const portalStyle: React.CSSProperties = pos
    ? { position: "fixed", left: pos.left, top: pos.top, zIndex: 9999 }
    : { position: "fixed", left: -9999, top: -9999, zIndex: 9999 };

  // ── Fermeture au clic extérieur ───────────────────────────────────────────
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  // ── Fermeture à Escape ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  // ── Focus auto sur l'input renommer ──────────────────────────────────────
  useEffect(() => {
    if (phase === "rename") {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [phase]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== (field.label || field.name)) {
      onRename(trimmed);
    }
    onClose();
  }, [renameValue, field.label, field.name, onRename, onClose]);

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // évite collision avec navigation grille
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // ── Rendu menu principal ──────────────────────────────────────────────────

  if (phase === "rename") {
    return createPortal((
      <div ref={menuRef} style={portalStyle} onClick={(e) => e.stopPropagation()} className="sn-col-menu" role="dialog" aria-label="Renommer la colonne">
        <input
          ref={renameInputRef}
          className="sn-col-menu-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={commitRename}
          placeholder="Nom de la colonne"
          aria-label="Nom de la colonne"
        />
      </div>
    ), document.body);
  }

  if (phase === "confirm-delete") {
    return createPortal((
      <div ref={menuRef} style={portalStyle} onClick={(e) => e.stopPropagation()} className="sn-col-menu" role="dialog" aria-label="Confirmer la suppression">
        <div style={{ padding: "8px 12px", color: "var(--text-secondary)", fontSize: 12 }}>
          Supprimer « {field.label || field.name} » ?
        </div>
        <div className="sn-col-menu-separator" />
        <Button
          variant="ghost"
          size="sm"
          className="sn-col-menu-item sn-col-menu-item--danger"
          onPress={() => { onDelete(); onClose(); }}
        >
          <Trash size={13} /> Supprimer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="sn-col-menu-item"
          onPress={() => setPhase("menu")}
        >
          <X size={13} /> Annuler
        </Button>
      </div>
    ), document.body);
  }

  if (phase === "formula") {
    const isFormula = field.kind === "formula";
    const existingExpr = isFormula ? (field as { expression?: string }).expression ?? "" : "";
    const existingOut = isFormula
      ? ((field as { outputKind?: "text" | "number" | "date" | "bool" }).outputKind ?? "text")
      : "text";
    const initialExpr = existingExpr || `{${field.name || field.id}}`;
    const existingFmt = isFormula ? (field as { outputFormat?: string }).outputFormat : undefined;
    return createPortal((
      <div
        ref={menuRef}
        style={{ ...portalStyle, padding: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="sn-col-menu"
        role="dialog"
        aria-label="Insérer une formule"
      >
        <FormulaInputEditor
          base={base}
          initialExpression={initialExpr}
          initialOutputKind={existingOut}
          initialOutputFormat={existingFmt}
          onSubmit={(expression, outputKind, outputFormat) => {
            onConvertToFormula(expression, outputKind, outputFormat);
            onClose();
          }}
          onCancel={() => setPhase("menu")}
        />
      </div>
    ), document.body);
  }

  return createPortal((
    <div ref={menuRef} style={portalStyle} onClick={(e) => e.stopPropagation()} className="sn-col-menu" role="menu">
      {/* Renommer */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => setPhase("rename")}
      >
        <PencilSimple size={13} /> Renommer
      </Button>

      {/* Éditer le champ (ouvre la sidebar) */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => { onEditField(); onClose(); }}
      >
        <PencilSimple size={13} /> Modifier le champ…
      </Button>

      {/* Formule */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => setPhase("formula")}
      >
        <FunctionIcon size={13} /> Convertir en formule…
      </Button>

      <div className="sn-col-menu-separator" />

      {/* Tri */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => { onSort("asc"); onClose(); }}
        aria-pressed={currentSort?.direction === "asc"}
      >
        <SortAscending size={13} /> Trier croissant
        {currentSort?.direction === "asc" && (
          <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => { onSort("desc"); onClose(); }}
        aria-pressed={currentSort?.direction === "desc"}
      >
        <SortDescending size={13} /> Trier décroissant
        {currentSort?.direction === "desc" && (
          <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>
        )}
      </Button>
      {currentSort && (
        <Button
          variant="ghost"
          size="sm"
          className="sn-col-menu-item"
  
          onPress={() => { onSort(null); onClose(); }}
        >
          <X size={13} /> Effacer le tri
        </Button>
      )}

      <div className="sn-col-menu-separator" />

      {/* Masquer */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item"

        onPress={() => { onHide(); onClose(); }}
      >
        <EyeSlash size={13} /> Masquer la colonne
      </Button>

      <div className="sn-col-menu-separator" />

      {/* Supprimer */}
      <Button
        variant="ghost"
        size="sm"
        className="sn-col-menu-item sn-col-menu-item--danger"

        onPress={() => setPhase("confirm-delete")}
      >
        <Trash size={13} /> Supprimer la colonne
      </Button>
    </div>
  ), document.body);
}
