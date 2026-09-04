"use client";

import { Chip } from "@heroui/react";
import { Button, Tooltip } from "@supernote/ui";
import { OLLAMA_EXTRACT_TEXT_LIMIT } from "@supernote/ai";
import { Check, Info, X } from "@phosphor-icons/react";
import type {
  ActionSuggestion,
  JournalSuggestion,
  MentionSuggestion,
} from "@/hooks/useJournalExtraction";

interface ExtractionSuggestionsProps {
  suggestions: JournalSuggestion[];
  /** `truncated` du hook : l'IA n'a lu qu'un préfixe de l'entrée. */
  truncated: boolean;
  onAcceptMention: (suggestion: MentionSuggestion) => void;
  onAcceptAction: (suggestion: ActionSuggestion) => void;
  onReject: (key: string) => void;
}

function label(s: JournalSuggestion): string {
  return s.kind === "mention"
    ? `${s.match.entityName} → lier ?`
    : `${s.action.text} → créer une tâche ?`;
}

/**
 * Rendu EN DEHORS du DOM de l'éditeur (sibling dans JournalEditor, jamais
 * enfant) — le subtree ProseMirror ne doit jamais recevoir de mutation DOM
 * externe (piège MutationObserver documenté sur ce projet).
 */
export function ExtractionSuggestions({
  suggestions,
  truncated,
  onAcceptMention,
  onAcceptAction,
  onReject,
}: ExtractionSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <section
      aria-label="Suggestions d'extraction"
      className="max-h-[40vh] shrink-0 overflow-y-auto px-4 py-2.5 md:px-10"
      style={{
        borderTop: "1px solid var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {suggestions.map((s) => {
          const text = label(s);
          return (
            <div key={s.key} className="flex min-w-0 max-w-full items-center gap-0.5">
              {/* `.chip` de HeroUI est livré hors layer avec `shrink-0` : sans le
                  `!`, un texte long pousse les boutons hors du conteneur. */}
              <Chip
                size="sm"
                variant="soft"
                color={s.kind === "mention" ? "accent" : "warning"}
                className="min-w-0 shrink!"
              >
                <span className="block max-w-[14rem] truncate md:max-w-[20rem]">{text}</span>
              </Chip>
              <Tooltip content="Accepter">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 md:h-8 md:w-8"
                  aria-label={`Accepter : ${text}`}
                  onPress={() => (s.kind === "mention" ? onAcceptMention(s) : onAcceptAction(s))}
                >
                  <Check size={16} />
                </Button>
              </Tooltip>
              <Tooltip content="Ignorer">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 md:h-8 md:w-8"
                  aria-label={`Ignorer : ${text}`}
                  onPress={() => onReject(s.key)}
                >
                  <X size={16} />
                </Button>
              </Tooltip>
            </div>
          );
        })}
      </div>

      {truncated && (
        <p
          className="mt-1.5 flex items-center gap-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <Info size={12} weight="bold" className="shrink-0" />
          {`L’IA n’a lu que les ${OLLAMA_EXTRACT_TEXT_LIMIT.toLocaleString("fr-FR")} premiers caractères de cette entrée — les suggestions ne couvrent pas la suite.`}
        </p>
      )}
    </section>
  );
}
