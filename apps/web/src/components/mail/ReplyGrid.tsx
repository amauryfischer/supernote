"use client";

/**
 * ReplyGrid — les questions du dernier message, une ligne chacune, au-dessus de
 * la réponse. Une touche tranche la question active (o oui · n non · l plus tard
 * · 1-3 créneau · e écrire), la réponse s'écrit dans le corps sous la question
 * citée, et le curseur passe à la suivante. Le corps reste la seule vérité : une
 * question est tranchée quand sa citation y porte une réponse.
 *
 * Seule la ligne active montre ses boutons : quatre questions tiennent sur
 * quatre lignes, la lecture du fil garde sa place.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ListChecks, PencilSimple, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { answerOf, isDateQuestion, laterAnswer, slotAnswer, slotLabel } from "@/lib/mail-parapheur";

export interface ReplyGridHandle {
  /** Focalise la première question sans réponse (ou la première). */
  focus: () => void;
}

interface Choice {
  key: string;
  label: string;
  answer: string;
  hint: string;
}

export const ReplyGrid = forwardRef<
  ReplyGridHandle,
  {
    questions: readonly string[];
    body: string;
    form: "tu" | "vous";
    /** Créneaux libres de l'agenda ; vide sans agenda connecté. */
    slots: readonly Date[];
    onAnswer: (index: number, answer: string, opts: { edit: boolean }) => void;
    /** Retour au texte libre (Échap, fin de la grille). */
    onDone: () => void;
    onSend: () => void;
    onDismiss: () => void;
    isMobile: boolean;
  }
>(function ReplyGrid({ questions, body, form, slots, onAnswer, onDone, onSend, onDismiss, isMobile }, ref) {
  const answers = useMemo(() => questions.map((q) => answerOf(body, q)), [questions, body]);
  const firstOpen = () => {
    const i = answers.findIndex((a) => !a);
    return i < 0 ? 0 : i;
  };
  const [active, setActive] = useState(firstOpen);
  const rowsRef = useRef<(HTMLLIElement | null)[]>([]);
  const answered = answers.filter(Boolean).length;

  useEffect(() => {
    if (active >= questions.length) setActive(0);
  }, [active, questions.length]);

  const focusRow = (i: number) => {
    setActive(i);
    requestAnimationFrame(() => rowsRef.current[i]?.focus());
  };

  useImperativeHandle(ref, () => ({ focus: () => focusRow(firstOpen()) }));

  const choicesFor = (q: string): Choice[] => [
    { key: "o", label: "Oui", answer: "Oui.", hint: "o" },
    { key: "n", label: "Non", answer: "Non.", hint: "n" },
    { key: "l", label: "Plus tard", answer: laterAnswer(form), hint: "l" },
    ...(isDateQuestion(q)
      ? slots.map((d, k) => ({ key: String(k + 1), label: slotLabel(d), answer: slotAnswer(d, form), hint: String(k + 1) }))
      : []),
  ];

  /** Après une réponse : la question suivante encore ouverte, sinon le texte libre. */
  const advance = (from: number) => {
    const open = (i: number) => i !== from && !answers[i];
    const next = questions.findIndex((_, i) => i > from && open(i));
    const wrap = next >= 0 ? next : questions.findIndex((_, i) => open(i));
    if (wrap >= 0) focusRow(wrap);
    // Sur téléphone, le clavier ne s'ouvre pas tout seul : on envoie souvent sans rien ajouter.
    else if (!isMobile) onDone();
  };

  const pick = (i: number, c: Choice) => {
    onAnswer(i, c.answer, { edit: false });
    advance(i);
  };
  const write = (i: number) => onAnswer(i, "", { edit: true });

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLLIElement>) => {
    if (e.nativeEvent.isComposing) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onSend();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const choice = choicesFor(questions[i]!).find((c) => c.key === key);
    let handled = true;
    if (choice) pick(i, choice);
    else if (key === "e" || key === "enter") write(i);
    else if (key === "arrowdown" || key === "j" || (key === "tab" && !e.shiftKey)) {
      if (i + 1 < questions.length) focusRow(i + 1);
      else if (key === "tab") onDone();
    } else if (key === "arrowup" || key === "k" || (key === "tab" && e.shiftKey)) {
      if (i > 0) focusRow(i - 1);
    } else if (key === "escape") onDone();
    else handled = key.length === 1; // une lettre perdue ne doit pas déclencher un raccourci de la boîte
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const chip = "h-9 min-h-9 gap-1 px-2.5 text-xs md:h-7 md:min-h-7";

  return (
    <section
      aria-label="Questions du message"
      className="mb-1.5 overflow-hidden rounded-md border"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-0, var(--background))" }}
    >
      <header className="flex h-8 items-center gap-2 pl-2.5 pr-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <ListChecks size={14} aria-hidden />
        <span style={{ color: "var(--text-secondary)" }}>Questions</span>
        <span className="font-mono tabular-nums" aria-label={`${answered} sur ${questions.length} tranchées`}>
          {answered}/{questions.length}
        </span>
        {!isMobile && (
          <span className="ml-1 hidden truncate font-mono text-[11px] lg:inline">o oui · n non · l plus tard · e écrire · Échap texte</span>
        )}
        <Tooltip content="Masquer les questions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Masquer les questions"
            className="sn-hit ml-auto h-7 min-h-7 w-7 min-w-7"
            onPress={onDismiss}
          >
            <X size={12} />
          </Button>
        </Tooltip>
      </header>
      <ol className="max-h-[38vh] overflow-y-auto border-t" style={{ borderColor: "var(--border-subtle)" }}>
        {questions.map((q, i) => {
          const isActive = i === active;
          const answer = answers[i];
          return (
            <li
              key={q}
              ref={(el) => {
                rowsRef.current[i] = el;
              }}
              tabIndex={isActive ? 0 : -1}
              aria-label={`Question ${i + 1} : ${q}${answer ? ` — réponse : ${answer}` : ""}`}
              aria-current={isActive ? "true" : undefined}
              data-answered={answer ? "true" : undefined}
              onKeyDown={(e) => onKeyDown(i, e)}
              onFocus={() => setActive(i)}
              onClick={() => {
                if (!isActive) focusRow(i);
              }}
              className="cursor-default px-2.5 py-1 outline-none focus-visible:bg-[var(--surface-2)]"
              style={{
                background: isActive ? "var(--surface-2)" : undefined,
                boxShadow: isActive ? "inset 3px 0 0 var(--text-primary)" : undefined,
              }}
            >
              <div className="flex min-h-7 items-center gap-2 text-sm">
                <span className="w-4 shrink-0 font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 ${isActive ? "line-clamp-2" : "truncate"}`}
                  style={{ color: answer ? "var(--text-muted)" : "var(--text-primary)" }}
                  title={q}
                >
                  {q}
                </span>
                {answer && (
                  <span
                    className="flex max-w-[40%] shrink-0 items-center gap-1 truncate text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <Check size={12} weight="bold" aria-hidden />
                    <span className="truncate">{answer}</span>
                  </span>
                )}
              </div>
              {isActive && (
                <div role="group" aria-label={`Répondre à la question ${i + 1}`} className="flex flex-wrap gap-1 pb-1 pl-6">
                  {choicesFor(q).map((c) => (
                    <Button
                      key={c.key}
                      size="sm"
                      variant={answer === c.answer ? "secondary" : "outline"}
                      aria-pressed={answer === c.answer}
                      excludeFromTabOrder
                      className={chip}
                      onPress={() => pick(i, c)}
                    >
                      <span className={c.key.length === 1 && /\d/.test(c.key) ? "font-mono" : undefined}>{c.label}</span>
                      {!isMobile && (
                        <kbd aria-hidden className="font-mono text-[10px] opacity-60">
                          {c.hint}
                        </kbd>
                      )}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" excludeFromTabOrder className={chip} onPress={() => write(i)}>
                    <PencilSimple size={12} aria-hidden />
                    Écrire
                    {!isMobile && (
                      <kbd aria-hidden className="font-mono text-[10px] opacity-60">
                        e
                      </kbd>
                    )}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
});
