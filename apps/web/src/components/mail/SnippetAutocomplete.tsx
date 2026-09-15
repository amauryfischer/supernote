"use client";

/**
 * SnippetAutocomplete — complétion de modèles à la frappe (`;raccourci`).
 *
 * Le hook gère la détection, la navigation clavier et l'insertion ; le composant
 * `SnippetPopup` ne fait qu'afficher. Les deux composeurs (nouveau message et
 * réponse inline) partagent ainsi exactement le même comportement.
 *
 * Règle de clavier : quand la liste est ouverte, ↑ ↓ naviguent, ↵ et Tab
 * insèrent, Échap ferme — et RIEN d'autre n'est intercepté, pour ne pas voler
 * le raccourci d'envoi (⌘/Ctrl+↵) ni la frappe normale.
 */

import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@heroui/react";
import { Kbd } from "@supernote/ui";
import {
  detectSnippetQuery,
  matchSnippets,
  expandVariables,
  insertSnippet,
  type SnippetContext,
} from "@/lib/mail-snippets";
import type { MailTemplate } from "@/lib/mail-templates";

export interface UseSnippetAutocompleteOptions {
  templates: MailTemplate[];
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Valeurs des variables (`{{prenom}}`…) au moment de l'insertion. */
  context: SnippetContext;
}

export function useSnippetAutocomplete({
  templates,
  value,
  onChange,
  textareaRef,
  context,
}: UseSnippetAutocompleteOptions) {
  // Requête courante (null = pas de complétion en cours) + curseur de sélection.
  const [query, setQuery] = useState<ReturnType<typeof detectSnippetQuery>>(null);
  const [index, setIndex] = useState(0);

  const matches = useMemo(
    () => (query ? matchSnippets(templates, query.query).slice(0, 6) : []),
    [query, templates],
  );
  const open = query !== null && matches.length > 0;

  /** Recalcule la complétion depuis la position du curseur. */
  const refresh = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = detectSnippetQuery(ta.value, ta.selectionStart ?? ta.value.length);
    setQuery(next);
    setIndex(0);
  }, [textareaRef]);

  const close = useCallback(() => setQuery(null), []);

  const accept = useCallback(
    (t: MailTemplate) => {
      if (!query) return;
      const body = expandVariables(t.body, context);
      const { value: nextValue, caret } = insertSnippet(value, query, body);
      onChange(nextValue);
      setQuery(null);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
    },
    [query, value, onChange, context, textareaRef],
  );

  /** À brancher sur `onKeyDown` du textarea. Renvoie true si la touche est consommée. */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
        const t = matches[index];
        if (t) {
          e.preventDefault();
          accept(t);
          return true;
        }
        return false;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [open, matches, index, accept, close],
  );

  return { open, matches, index, refresh, close, accept, handleKeyDown };
}

export function SnippetPopup({
  matches,
  index,
  onPick,
}: {
  matches: MailTemplate[];
  index: number;
  onPick: (t: MailTemplate) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <div
      className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded-lg border p-1 shadow-lg"
      style={{ background: "var(--surface-0)", borderColor: "var(--border-subtle)" }}
      role="listbox"
      aria-label="Modèles"
    >
      {matches.map((t, i) => (
        <Button
          key={t.id}
          variant="ghost"
          size="sm"
          className="h-9 w-full justify-start gap-2 px-2 text-sm"
          style={
            i === index
              ? { background: "var(--accent-subtle)", color: "var(--accent)" }
              : undefined
          }
          aria-selected={i === index}
          onPress={() => onPick(t)}
        >
          <span className="truncate">{t.name}</span>
          {t.shortcut && (
            <span className="ml-auto shrink-0">
              <Kbd>;{t.shortcut}</Kbd>
            </span>
          )}
        </Button>
      ))}
      <p className="px-2 py-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        ↑ ↓ pour choisir · ↵ pour insérer
      </p>
    </div>
  );
}
