"use client";

/**
 * ComposerToolbar — barre de mise en forme du composeur (compose ET réponse).
 *
 * Insère des marqueurs Markdown dans le `<textarea>` autour de la sélection
 * courante ; la conversion HTML a lieu à l'envoi (`markdownToHtml`). On garde
 * donc un champ texte — rapide, collable, prévisible — sans renoncer au gras,
 * aux listes et aux liens.
 */

import type { RefObject } from "react";
import { Button } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import {
  TextB,
  TextItalic,
  Code,
  Link as LinkIcon,
  ListBullets,
  Quotes,
} from "@phosphor-icons/react";
import { applyMarkup, type MarkupKind } from "@/lib/mail-markdown";

const ACTIONS: { kind: MarkupKind; label: string; icon: typeof TextB }[] = [
  { kind: "bold", label: "Gras", icon: TextB },
  { kind: "italic", label: "Italique", icon: TextItalic },
  { kind: "code", label: "Code", icon: Code },
  { kind: "link", label: "Lien", icon: LinkIcon },
  { kind: "bullet", label: "Liste à puces", icon: ListBullets },
  { kind: "quote", label: "Citation", icon: Quotes },
];

export function ComposerToolbar({
  textareaRef,
  value,
  onChange,
  /** Contenu additionnel poussé à droite (pièces jointes, modèles…). */
  trailing,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  trailing?: React.ReactNode;
}) {
  const run = (kind: MarkupKind) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const next = applyMarkup(value, start, end, kind);
    onChange(next.value);
    // La sélection est restaurée APRÈS le rendu contrôlé, sinon React la remet
    // en fin de champ et la frappe suivante écrit au mauvais endroit.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {ACTIONS.map(({ kind, label, icon: Icon }) => (
        <Tooltip key={kind} content={label}>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label={label}
            className="h-8 min-h-8 w-8 min-w-8"
            onPress={() => run(kind)}
          >
            <Icon size={15} aria-hidden />
          </Button>
        </Tooltip>
      ))}
      {trailing}
    </div>
  );
}
