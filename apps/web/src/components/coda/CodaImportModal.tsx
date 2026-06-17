"use client";

/**
 * Coda import wizard: browse docs → expand tables → pick → import.
 *
 * Talks to the same-origin Coda proxy via `lib/coda/client` (never coda.io
 * directly). The actual schema/entity/relation creation is delegated to
 * `importCodaTables`. Read-only result: each picked table becomes a Coda-mirror
 * base.
 */

import { useEffect, useState } from "react";
import { Button, Checkbox, Spinner } from "@heroui/react";
import { Modal, useToast } from "@supernote/ui";
import { CaretRight, CaretDown, Table as TableIcon } from "@phosphor-icons/react";
import { listDocs, listTables } from "@/lib/coda/client";
import { importCodaTables, type ImportTarget, type ImportProgress } from "@/lib/coda/import";
import type { CodaDoc, CodaTable } from "@/lib/coda/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (baseIds: string[]) => void;
}

export function CodaImportModal({ isOpen, onClose, onImported }: Props) {
  const { toast } = useToast();
  const [docs, setDocs] = useState<CodaDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tablesByDoc, setTablesByDoc] = useState<Record<string, CodaTable[]>>({});
  const [loadingTables, setLoadingTables] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, ImportTarget>>(new Map());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  // Load the doc list when the wizard opens.
  useEffect(() => {
    if (!isOpen) return;
    setLoadingDocs(true);
    void listDocs().then((res) => {
      setLoadingDocs(false);
      if (res.ok) setDocs(res.value);
      else toast({ title: `Coda : ${res.error.message}`, variant: "danger" });
    });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDoc = async (doc: CodaDoc) => {
    if (expanded === doc.id) {
      setExpanded(null);
      return;
    }
    setExpanded(doc.id);
    if (tablesByDoc[doc.id]) return;
    setLoadingTables(doc.id);
    const res = await listTables(doc.id);
    setLoadingTables(null);
    if (res.ok) {
      // Skip views — only base tables import cleanly.
      const tables = res.value.filter((t) => t.tableType !== "view");
      setTablesByDoc((m) => ({ ...m, [doc.id]: tables }));
    } else {
      toast({ title: `Coda : ${res.error.message}`, variant: "danger" });
    }
  };

  const toggleTable = (doc: CodaDoc, table: CodaTable) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(table.id)) next.delete(table.id);
      else
        next.set(table.id, {
          docId: doc.id,
          docName: doc.name,
          tableId: table.id,
          tableName: table.name,
        });
      return next;
    });
  };

  const runImport = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setProgress(null);
    const res = await importCodaTables([...selected.values()], setProgress);
    setImporting(false);
    setProgress(null);
    if (res.ok) {
      toast({ title: `Import Coda terminé — ${res.value.baseIds.length} base(s)` });
      onImported?.(res.value.baseIds);
      setSelected(new Map());
      onClose();
    } else {
      toast({ title: `Échec de l'import : ${res.error.message}`, variant: "danger" });
    }
  };

  const progressLabel = progress
    ? `${PHASE_LABEL[progress.phase]}${progress.label ? ` · ${progress.label}` : ""} (${progress.done}/${progress.total})`
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !importing) onClose();
      }}
      title="Importer depuis Coda"
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {progressLabel ?? `${selected.size} table(s) sélectionnée(s)`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onPress={onClose} isDisabled={importing}>
              Annuler
            </Button>
            <Button
              size="sm"
              onPress={() => void runImport()}
              isDisabled={selected.size === 0 || importing}
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {importing ? "Import…" : `Importer (${selected.size})`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto">
        {loadingDocs ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
            <Spinner size="sm" /> Chargement des docs Coda…
          </div>
        ) : docs.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Aucun doc Coda accessible avec ce token.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {docs.map((doc) => {
              const open = expanded === doc.id;
              const tables = tablesByDoc[doc.id] ?? [];
              return (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => void toggleDoc(doc)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--surface-2)]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {open ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    <span className="font-medium">{doc.name}</span>
                  </button>
                  {open && (
                    <div className="ml-5 flex flex-col gap-0.5 border-l pl-2" style={{ borderColor: "var(--border-subtle)" }}>
                      {loadingTables === doc.id ? (
                        <div className="flex items-center gap-2 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                          <Spinner size="sm" /> Chargement des tables…
                        </div>
                      ) : tables.length === 0 ? (
                        <p className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                          Aucune table.
                        </p>
                      ) : (
                        tables.map((table) => (
                          <label
                            key={table.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                          >
                            <Checkbox
                              isSelected={selected.has(table.id)}
                              onChange={() => toggleTable(doc, table)}
                              aria-label={`Importer ${table.name}`}
                            />
                            <TableIcon size={13} style={{ color: "var(--text-muted)" }} />
                            <span>{table.name}</span>
                          </label>
                        ))
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

const PHASE_LABEL: Record<ImportProgress["phase"], string> = {
  schema: "Schémas",
  rows: "Lignes",
  relations: "Relations",
  done: "Terminé",
};
