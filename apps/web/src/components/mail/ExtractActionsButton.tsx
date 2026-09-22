"use client";

/**
 * ExtractActionsButton — bouton « Extraire les actions » + Popover de sélection.
 *
 * Flux :
 *   1. Clic → ouvre le Popover et lance `extractActions(thread)` (IA locale
 *      Ollama, via `@/lib/mail-ai`). Best-effort : une erreur Ollama s'affiche
 *      dans le Popover, rien ne crashe.
 *   2. Les actions détectées s'affichent en liste de Checkbox (toutes cochées
 *      par défaut). L'utilisateur décoche celles qu'il ne veut pas.
 *   3. « Créer les tâches » → pour chaque action cochée, crée une entité `todo`
 *      (même appel que la conversion Eisenhower / le create manuel de /todos),
 *      en parallèle ; le déclencheur passe en succès.
 *
 * Le composant est self-contained (état local) et ne dépend que de `MailAiThread`
 * (texte brut — jamais de HTML injecté dans le prompt, garanti par l'appelant).
 * Gate `isAiConfigured` assurée par l'appelant (le bouton n'est rendu que si l'IA
 * est configurée).
 *
 * Mobile : déclencheur à hit-target tactile (h-9 ≈ 36px), libellé masqué sous
 * `sm` (icône seule) ; le Popover (w-72) reste lisible sans débordement.
 */

import { useState } from "react";
import { Button, Popover, Checkbox, Spinner } from "@heroui/react";
import { ListPlus, ArrowsClockwise } from "@phosphor-icons/react";
import { extractActions, type MailAiThread } from "@/lib/mail-ai";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";

export interface ExtractActionsButtonProps {
  /** Fil sérialisable (texte brut) à analyser. */
  thread: MailAiThread;
}

export function ExtractActionsButton({ thread }: ExtractActionsButtonProps) {
  const createFb = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  // `null` = pas encore extrait (relance possible) ; `[]` = extrait, aucune action.
  const [actions, setActions] = useState<{ text: string }[] | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);

  const runExtract = async () => {
    if (loading) return;
    setLoading(true);
    setExtractError(null);
    try {
      const found = await extractActions(thread);
      setActions(found);
      setChecked(found.map(() => true));
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Ollama injoignable");
    } finally {
      setLoading(false);
    }
  };

  // Ouverture du Popover → lance l'extraction au 1ᵉʳ affichage (actions === null).
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && actions === null && !loading) void runExtract();
  };

  const toggle = (i: number) => {
    setChecked((c) => c.map((v, idx) => (idx === i ? !v : v)));
  };

  const selectedCount = checked.filter(Boolean).length;

  const createTasks = async () => {
    if (createFb.isPending || !actions) return;
    const selected = actions.filter((_, i) => checked[i]);
    if (selected.length === 0) return;
    const done = await createFb.run(() =>
      Promise.all(
        selected.map((a) =>
          trpcVanillaClient.entities.create.mutate({
            typeId: TODO_TYPE_ID,
            fields: {
              text: a.text,
              done: false,
              priority: 5,
              importance: "medium",
              urgent: false,
            },
          }),
        ),
      ),
    );
    if (!done) return;
    setOpen(false);
    // Reset pour une prochaine ouverture (ré-extraction propre).
    setActions(null);
    setChecked([]);
  };

  return (
    <Popover isOpen={open} onOpenChange={handleOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-1.5"
        aria-label="Extraire les actions du fil en tâches"
      >
        {loading ? (
          <Spinner size="sm" />
        ) : (
          <FeedbackIcon
            state={createFb.state}
            error={createFb.error}
            size={16}
            idle={<ListPlus size={16} aria-hidden />}
          />
        )}
        <span className="hidden sm:inline">Extraire les actions</span>
      </Button>
      <Popover.Content className="w-72 p-2">
        <Popover.Dialog className="outline-none">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Actions détectées
            </p>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void runExtract()}
              isDisabled={loading}
              aria-label="Relancer l'extraction"
              className="h-auto min-h-0 px-1.5 py-0.5 text-xs"
            >
              <ArrowsClockwise size={12} /> Relancer
            </Button>
          </div>

          {loading ? (
            <div
              className="flex items-center gap-2 px-1 py-3 text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              <Spinner size="sm" /> Analyse du fil…
            </div>
          ) : extractError ? (
            <p role="alert" className="px-1.5 py-3 text-sm" style={{ color: "var(--color-danger)" }}>
              Extraction impossible : {extractError}
            </p>
          ) : actions && actions.length > 0 ? (
            <>
              <div className="max-h-64 overflow-y-auto py-0.5">
                {actions.map((a, i) => (
                  <label
                    key={`${i}-${a.text}`}
                    className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 hover:opacity-90"
                  >
                    <Checkbox
                      isSelected={Boolean(checked[i])}
                      onChange={() => toggle(i)}
                      aria-label={`Inclure l'action : ${a.text}`}
                    />
                    <span
                      className="min-w-0 flex-1 break-words text-sm leading-snug"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {a.text}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-1.5 px-1">
                <Button
                  variant="primary"
                  size="sm"
                  onPress={() => void createTasks()}
                  isDisabled={createFb.isPending || selectedCount === 0}
                  className="w-full"
                  aria-label={`Créer ${selectedCount} tâche(s)`}
                >
                  {createFb.isPending ? <Spinner size="sm" /> : <ListPlus size={14} />}
                  {createFb.isPending
                    ? "Création…"
                    : `Créer les tâches${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
                </Button>
                {createFb.error && (
                  <p role="alert" className="mt-1 text-xs" style={{ color: "var(--color-danger)" }}>
                    Création des tâches échouée : {createFb.error}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p
              className="px-1.5 py-3 text-center text-sm italic"
              style={{ color: "var(--text-muted)" }}
            >
              Aucune action détectée.
            </p>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
