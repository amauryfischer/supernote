"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Textarea } from "@supernote/ui";
import { useDailyEntity } from "@/hooks/useDailyEntity";
import {
  appendToLiveJournalEntry,
  hasLiveJournalEntry,
  todayJournalDate,
} from "@/lib/journal-live-entry";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);

/** Durée de la sortie du Modal, que le corps doit couvrir (cf. `exiting`). */
const EXIT_MS = 300;

interface QuickCaptureOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Remplace l'ancienne popup `/capture` (Electron, morte depuis le pivot SPA).
 * Écrit dans l'entrée du jour au lieu d'un Inbox séparé — cohérent avec le
 * pari « flux » : tout part du journal.
 *
 * Le formulaire n'est monté qu'à l'ouverture : il peut tirer `entities.list`
 * (typeId=daily, limite large), qu'on ne veut pas voir partir sur chaque page
 * de l'app juste parce que le raccourci existe.
 */
export function QuickCaptureOverlay({ isOpen, onClose }: QuickCaptureOverlayProps) {
  // Démonté avec `isOpen`, le corps disparaîtrait avant la fin du fondu et la
  // boîte se réduirait à son titre : on le garde le temps de la sortie.
  const [exiting, setExiting] = useState(false);
  // Remonte le corps quand on rouvre pendant cette sortie — il porte encore le
  // brouillon et le statut de la capture précédente.
  const [session, setSession] = useState(0);
  const exitingRef = useRef(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      if (exitingRef.current) setSession((n) => n + 1);
      exitingRef.current = false;
      wasOpenRef.current = true;
      setExiting(false);
      return;
    }
    if (!wasOpenRef.current) return;
    exitingRef.current = true;
    setExiting(true);
    const t = setTimeout(() => {
      exitingRef.current = false;
      setExiting(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Capture rapide — entrée du jour"
      size="md"
      // Un clic manqué sur le fond détruirait le brouillon sans un mot. Échap
      // et le bouton de fermeture restent.
      isDismissable={false}
    >
      {(isOpen || exiting) && <QuickCaptureForm key={session} onClose={onClose} />}
    </Modal>
  );
}

type CaptureStatus = "idle" | "waiting" | "saving" | "done" | "error";

function QuickCaptureForm({ onClose }: { onClose: () => void }) {
  const today = useMemo(todayJournalDate, []);
  // Un éditeur inscrit écrira lui-même : inutile de tirer la liste `daily`
  // entière (limite 5000, corps compris) pour trois mots jetés. Armé si
  // l'inscription disparaît avant la validation.
  const [needsList, setNeedsList] = useState(() => !hasLiveJournalEntry(today));
  const { initialMarkdown, isReady, persist } = useDailyEntity(today, { enabled: needsList });
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<CaptureStatus>("idle");
  // Capture validée avant que la liste ne soit exploitable, rejouée par
  // l'effect ci-dessous.
  const deferredRef = useRef<string | null>(null);

  /**
   * Remet le texte à son écrivain. `false` quand personne n'est inscrit et que
   * la liste n'a pas encore répondu : écrire alors créerait une seconde entité
   * `daily` pour la même date.
   */
  const deliver = useCallback(
    (text: string): boolean => {
      // Un JournalEditor ouvert sur aujourd'hui détient le texte le plus
      // frais, frappe non encore sauvegardée comprise : il écrit, pas nous.
      if (appendToLiveJournalEntry(today, text)) {
        setStatus("done");
        return true;
      }
      if (!isReady) return false;
      setStatus("saving");
      const base = initialMarkdown.trimEnd();
      void persist(base.length > 0 ? `${base}\n\n${text}` : text)
        .then(() => setStatus("done"))
        .catch((err: unknown) => {
          console.error("[capture] échec de l'écriture dans l'entrée du jour", err);
          setStatus("error");
        });
      return true;
    },
    [initialMarkdown, isReady, persist, today],
  );

  const submit = useCallback(() => {
    if (status === "saving" || status === "waiting" || status === "done") return;
    const trimmed = draft.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    if (deliver(trimmed)) return;
    deferredRef.current = trimmed;
    setNeedsList(true);
    setStatus("waiting");
  }, [deliver, draft, onClose, status]);

  useEffect(() => {
    if (status !== "waiting") return;
    const text = deferredRef.current;
    if (text === null) return;
    if (deliver(text)) deferredRef.current = null;
  }, [deliver, status]);

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
          role="status"
          aria-live="polite"
        >
          {statusLabel ?? (
            <>
              <kbd className="font-mono">Esc</kbd> Annuler ·{" "}
              <kbd className="font-mono">{isMac ? "⌘" : "Ctrl"} Entrée</kbd> Enregistrer
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
