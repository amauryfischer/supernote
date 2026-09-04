"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Textarea } from "@supernote/ui";
import { useDailyEntity } from "@/hooks/useDailyEntity";
import { appendToLiveJournalEntry } from "@/lib/journal-live-entry";

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface QuickCaptureOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Remplace l'ancienne popup `/capture` (Electron, morte depuis le pivot SPA).
 * Écrit dans l'entrée du jour au lieu d'un Inbox séparé — cohérent avec le
 * pari « flux » : tout part du journal.
 *
 * Le formulaire n'est monté qu'à l'ouverture : il tire `entities.list`
 * (typeId=daily, limite large), qu'on ne veut pas voir partir sur chaque page
 * de l'app juste parce que le raccourci existe.
 */
export function QuickCaptureOverlay({ isOpen, onClose }: QuickCaptureOverlayProps) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Capture rapide — entrée du jour"
      size="md"
    >
      {isOpen && <QuickCaptureForm onClose={onClose} />}
    </Modal>
  );
}

type CaptureStatus = "idle" | "waiting" | "saving" | "done" | "error";

function QuickCaptureForm({ onClose }: { onClose: () => void }) {
  const today = useMemo(todayYMD, []);
  const { initialMarkdown, isLoading, persist } = useDailyEntity(today);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<CaptureStatus>("idle");
  // Capture validée avant que la liste des entrées ne soit chargée, rejouée
  // par l'effect ci-dessous.
  const deferredRef = useRef<string | null>(null);

  const flush = useCallback(
    (text: string) => {
      // Un JournalEditor ouvert sur aujourd'hui détient le texte le plus
      // frais, frappe non encore sauvegardée comprise : il écrit, pas nous.
      if (appendToLiveJournalEntry(today, text)) {
        setStatus("done");
        return;
      }
      setStatus("saving");
      const base = initialMarkdown.trimEnd();
      void persist(base.length > 0 ? `${base}\n\n${text}` : text)
        .then(() => setStatus("done"))
        .catch((err: unknown) => {
          console.error("[capture] échec de l'écriture dans l'entrée du jour", err);
          setStatus("error");
        });
    },
    [initialMarkdown, persist, today],
  );

  const submit = useCallback(() => {
    if (status === "saving" || status === "waiting" || status === "done") return;
    const trimmed = draft.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    if (isLoading) {
      // L'entrée du jour n'est pas encore identifiée : écrire maintenant en
      // créerait une seconde pour la même date.
      deferredRef.current = trimmed;
      setStatus("waiting");
      return;
    }
    flush(trimmed);
  }, [draft, flush, isLoading, onClose, status]);

  useEffect(() => {
    if (status !== "waiting" || isLoading) return;
    const text = deferredRef.current;
    deferredRef.current = null;
    if (text) flush(text);
  }, [flush, isLoading, status]);

  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(onClose, 400);
    return () => clearTimeout(t);
  }, [status, onClose]);

  // Échap traité ici en plus du dismiss de la Modal : le registre de
  // raccourcis s'arrête au PREMIER binding dont la combinaison correspond
  // (`palette.close`) et ne relaie jamais aux suivants.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    },
    [onClose, submit],
  );

  const busy = status === "waiting" || status === "saving" || status === "done";
  const statusLabel =
    status === "waiting"
      ? "Chargement de l'entrée du jour…"
      : status === "saving"
        ? "Enregistrement…"
        : status === "done"
          ? "Ajouté à l'entrée du jour"
          : status === "error"
            ? "Échec de l'enregistrement — réessayer"
            : null;

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Capture rapide…"
        rows={5}
        disabled={busy}
        autoFocus
        className="resize-none"
        aria-label="Contenu de la capture"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className="text-[11px]"
          style={{ color: status === "error" ? "var(--color-danger)" : "var(--text-muted)" }}
        >
          {statusLabel ?? (
            <>
              <kbd className="font-mono">Esc</kbd> Annuler ·{" "}
              <kbd className="font-mono">⌘ Entrée</kbd> Enregistrer
            </>
          )}
        </span>
        <Button variant="primary" size="sm" isDisabled={busy} onPress={submit}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
