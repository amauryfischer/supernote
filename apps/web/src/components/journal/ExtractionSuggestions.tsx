"use client";

import { Chip } from "@heroui/react";
import { Button, Tooltip } from "@supernote/ui";
import { OLLAMA_EXTRACT_TEXT_LIMIT, stripMarkdownInline } from "@supernote/ai";
import { CalendarBlank, Check, Info, X } from "@phosphor-icons/react";
import type {
  ActionSuggestion,
  JournalSuggestion,
  MentionSuggestion,
  PersonSuggestion,
} from "@/hooks/useJournalExtraction";

interface ExtractionSuggestionsProps {
  suggestions: JournalSuggestion[];
  /** `truncated` du hook : l'IA n'a lu qu'un préfixe de l'entrée. */
  truncated: boolean;
  onAcceptMention: (suggestion: MentionSuggestion) => void;
  onAcceptAction: (suggestion: ActionSuggestion) => void;
  onAcceptPerson: (suggestion: PersonSuggestion) => void;
  onReject: (key: string) => void;
}

/**
 * `stripMarkdownInline` en dernier rempart : un libellé d'interface ne doit
 * jamais porter de `##` ni de `**`, quelle que soit la source qui l'a produit.
 */
function label(s: JournalSuggestion): string {
  if (s.kind === "mention") return `${stripMarkdownInline(s.match.entityName)} → lier ?`;
  if (s.kind === "person") {
    return `Créer le contact « ${stripMarkdownInline(s.candidate.name)} » ?`;
  }
  return `${stripMarkdownInline(s.action.text)} → créer une tâche ?`;
}

function chipColor(s: JournalSuggestion): "accent" | "success" | "warning" {
  if (s.kind === "mention") return "accent";
  return s.kind === "person" ? "success" : "warning";
}

function formatDueDate(iso: string): string | null {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
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
  onAcceptPerson,
  onReject,
}: ExtractionSuggestionsProps) {
  // L'avis de troncature vaut même sans chip : une entrée longue dont rien n'a
  // survécu au filtrage est précisément le cas où l'utilisateur doit savoir que
  // la fin n'a été lue par personne.
  if (suggestions.length === 0 && !truncated) return null;

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
          const due = s.kind === "action" && s.action.deadline ? formatDueDate(s.action.deadline) : null;
          return (
            // `flex-wrap` : la pastille d'échéance est insécable, et sans le
            // repli le groupe débordait horizontalement dans une colonne
            // étroite (panneau de droite ouvert).
            <div key={s.key} className="flex min-w-0 max-w-full flex-wrap items-center gap-0.5">
              {/* `.chip` de HeroUI est livré hors layer avec `shrink-0` : sans le
                  `!`, un texte long pousse les boutons hors du conteneur. */}
              <Chip size="sm" variant="soft" color={chipColor(s)} className="min-w-0 shrink!">
                <span className="block max-w-[14rem] truncate md:max-w-[20rem]">{text}</span>
              </Chip>
              {due && (
                <Chip size="sm" variant="soft" color="default" className="shrink-0">
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <CalendarBlank size={12} weight="bold" aria-hidden />
                    {due}
                  </span>
                </Chip>
              )}
              <Tooltip content={s.kind === "person" ? "Créer le contact" : "Accepter"}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 md:h-8 md:w-8"
                  aria-label={`Accepter : ${text}${due ? ` (échéance ${due})` : ""}`}
                  onPress={() => {
                    if (s.kind === "mention") onAcceptMention(s);
                    else if (s.kind === "person") onAcceptPerson(s);
                    else onAcceptAction(s);
                  }}
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
