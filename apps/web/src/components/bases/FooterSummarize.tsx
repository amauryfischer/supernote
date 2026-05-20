"use client";

/**
 * FooterSummarize — ligne agrégats par colonne sous le DataGrid.
 *
 * Affichée juste avant le footer compteur. Chaque cellule expose un picker
 * d'opération (sum / avg / count…) et persiste le choix dans
 * `view.summarize[fieldId]` via `views.update`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Field } from "@supernote/core";
import type { SummarizeOp, View } from "@supernote/ipc";
import { Button } from "@heroui/react";
import {
  availableSummarizeOps,
  computeSummarize,
  summarizeOpLabel,
} from "./aggregations";

type SummarizeMap = Record<string, SummarizeOp | undefined>;

interface FooterSummarizeProps {
  view: View;
  fields: Field[];
  visibleIds: string[];
  colWidths: Record<string, number>;
  /** entité brute (mêmes valeurs `fields` que celles passées au DataGrid). */
  rows: Array<{ fields: Record<string, unknown> }>;
  onUpdate: (summarize: SummarizeMap) => void;
}

export function FooterSummarize({
  view,
  fields,
  visibleIds,
  colWidths,
  rows,
  onUpdate,
}: FooterSummarizeProps) {
  const summarize: SummarizeMap = useMemo(
    () => (view.summarize ?? {}) as SummarizeMap,
    [view.summarize],
  );

  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of fields) m.set(f.id, f);
    return m;
  }, [fields]);

  // Picker state ---------------------------------------------------------------
  const [openFid, setOpenFid] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleSelect = (fid: string, op: SummarizeOp) => {
    const next: SummarizeMap = { ...summarize };
    if (op === "none") {
      delete next[fid];
    } else {
      next[fid] = op;
    }
    onUpdate(next);
    setOpenFid(null);
    setAnchor(null);
  };

  return (
    <>
      <tr
        style={{
          backgroundColor: "var(--surface-1)",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {/* index col */}
        <td
          className="sticky left-0"
          style={{
            width: 36,
            minWidth: 36,
            borderRight: "1px solid var(--border-subtle)",
            backgroundColor: "var(--surface-1)",
          }}
        />
        {visibleIds.map((fid, idx) => {
          const field = fieldById.get(fid);
          if (!field) return <td key={fid} />;
          const op = summarize[fid] ?? "none";
          const values = rows.map((r) => r.fields[fid]);
          const { label } = computeSummarize(op, field, values);
          const colW = colWidths[fid] ?? 160;
          const isPrimary = idx === 0;
          return (
            <td
              key={fid}
              className="cursor-pointer px-2 py-1.5 text-[11px] hover:bg-[var(--surface-2)]"
              style={{
                width: colW,
                minWidth: colW,
                maxWidth: colW,
                borderRight: "1px solid var(--border-subtle)",
                color: "var(--text-muted)",
                position: isPrimary ? "sticky" : "relative",
                left: isPrimary ? 36 : undefined,
                backgroundColor: isPrimary ? "var(--surface-1)" : undefined,
                zIndex: isPrimary ? 5 : undefined,
              }}
              onClick={(e) => {
                setAnchor(e.currentTarget as HTMLElement);
                setOpenFid(fid);
              }}
              title="Choisir une agrégation"
            >
              {label === null ? (
                <span style={{ opacity: 0.5 }}>Calculer…</span>
              ) : (
                <span>
                  <span style={{ opacity: 0.6, marginRight: 4 }}>
                    {summarizeOpLabel(op)}
                  </span>
                  <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
                    {label}
                  </span>
                </span>
              )}
            </td>
          );
        })}
        {/* trailing add-field col + spacer */}
        <td style={{ borderRight: "1px solid var(--border-subtle)" }} />
        <td />
      </tr>

      {openFid && anchor && (
        <SummarizePicker
          anchor={anchor}
          field={fieldById.get(openFid)!}
          currentOp={(summarize[openFid] ?? "none") as SummarizeOp}
          onSelect={(op) => handleSelect(openFid, op)}
          onClose={() => {
            setOpenFid(null);
            setAnchor(null);
          }}
        />
      )}
    </>
  );
}

// ── Popover sélecteur d'opération ───────────────────────────────────────────

interface SummarizePickerProps {
  anchor: HTMLElement;
  field: Field;
  currentOp: SummarizeOp;
  onSelect: (op: SummarizeOp) => void;
  onClose: () => void;
}

function SummarizePicker({
  anchor,
  field,
  currentOp,
  onSelect,
  onClose,
}: SummarizePickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const ops = useMemo(() => availableSummarizeOps(field), [field]);

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const update = () => {
      const r = anchor.getBoundingClientRect();
      setPos({ left: r.left, top: r.top - 4 });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [onClose]);

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

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="sn-col-menu"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        transform: "translateY(-100%)",
        zIndex: 9999,
        minWidth: 180,
      }}
      role="menu"
    >
      {ops.map((op) => (
        <Button
          key={op}
          variant="ghost"
          size="sm"
          className="sn-col-menu-item"
          onPress={() => onSelect(op)}
          aria-pressed={op === currentOp}
        >
          <span>{summarizeOpLabel(op)}</span>
          {op === currentOp && (
            <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>
          )}
        </Button>
      ))}
    </div>,
    document.body,
  );
}
