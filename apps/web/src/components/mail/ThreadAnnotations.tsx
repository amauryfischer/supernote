import { useEffect, useState } from "react";
import { NotePencil, X } from "@phosphor-icons/react";
import { Button, Input, Textarea, Tooltip } from "@supernote/ui";
import { saveAnnotation, type MailAnnotation, type MailHighlight } from "@/lib/mail-annotations";

export type AnnotationEditing = "title" | "note" | null;

/**
 * Objet perso et note privée d'un fil, juste sous l'en-tête. Rien ne s'affiche tant
 * qu'aucun repère n'existe : l'édition s'ouvre depuis le menu « Plus ».
 */
export function ThreadAnnotations({
  accountId,
  threadId,
  subject,
  annotation,
  editing,
  onEditingChange,
}: {
  accountId: string;
  threadId: string;
  subject: string;
  annotation: MailAnnotation | undefined;
  editing: AnnotationEditing;
  onEditingChange: (next: AnnotationEditing) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const title = annotation?.title ?? "";
  const note = annotation?.note ?? "";

  useEffect(() => {
    if (editing === "title") setDraft(title || subject);
    else if (editing === "note") setDraft(note);
    // Le brouillon part de la valeur au moment d'ouvrir l'édition, pas des relectures suivantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, threadId]);

  if (!editing && !title && !note) return null;

  const save = async () => {
    setSaving(true);
    try {
      // Reprendre l'objet réel tel quel revient à ne pas renommer.
      const value = editing === "title" && draft.trim() === subject.trim() ? "" : draft;
      await saveAnnotation(accountId, threadId, editing === "title" ? { title: value } : { note: value });
      onEditingChange(null);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onEditingChange(null);
    else if (e.key === "Enter" && (editing === "title" || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      {editing === "title" ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label="Objet pour toi"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            wrapperClassName="flex-1"
            className="h-8 py-1"
          />
          <Button size="sm" isDisabled={saving} onPress={() => void save()} style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}>
            Renommer
          </Button>
        </div>
      ) : title ? (
        <p className="truncate" style={{ color: "var(--text-muted)" }} title={subject}>
          Objet réel : {subject || "(sans objet)"}
        </p>
      ) : null}

      {editing === "note" ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            autoFocus
            aria-label="Note privée"
            value={draft}
            rows={2}
            placeholder="Ce que tu veux te rappeler de ce fil — visible de toi seul"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="text-[13px]"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] max-md:hidden" style={{ color: "var(--text-muted)" }}>
              ⌘/Ctrl + Entrée
            </span>
            <Button size="sm" variant="ghost" onPress={() => onEditingChange(null)}>
              Annuler
            </Button>
            <Button size="sm" isDisabled={saving} onPress={() => void save()} style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}>
              Enregistrer
            </Button>
          </div>
        </div>
      ) : note ? (
        <Button
          variant="ghost"
          aria-label="Modifier ta note privée"
          onPress={() => onEditingChange("note")}
          className="h-auto min-h-8 w-full justify-start gap-2 whitespace-pre-wrap rounded-[var(--radius-md)] px-2.5 py-1.5 text-left font-normal"
          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
        >
          <NotePencil size={14} aria-hidden className="mt-0.5 shrink-0 self-start" />
          <span className="min-w-0 flex-1">{note}</span>
        </Button>
      ) : null}
    </div>
  );
}

/** Passages surlignés du fil, en tête : un clic ramène au message, la croix retire le passage. */
export function ThreadHighlights({
  highlights,
  authorOf,
  onJump,
  onRemove,
}: {
  highlights: readonly MailHighlight[];
  authorOf: (messageId: string) => string;
  onJump: (messageId: string) => void;
  onRemove: (h: MailHighlight) => void;
}) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Passages surlignés">
      {highlights.map((h) => (
        <li
          key={`${h.messageId}:${h.text}`}
          className="flex items-start gap-1 rounded-[var(--radius-md)] border-l-2 pl-1"
          style={{ borderColor: "var(--warning)", background: "color-mix(in oklab, var(--warning) 12%, transparent)" }}
        >
          <Button
            variant="ghost"
            aria-label={`Aller au passage : ${h.text}`}
            onPress={() => onJump(h.messageId)}
            className="h-auto min-h-8 min-w-0 flex-1 flex-col items-start justify-start gap-0.5 px-1.5 py-1 text-left font-normal"
          >
            <span className="line-clamp-2 whitespace-normal text-[13px]" style={{ color: "var(--text-primary)" }}>
              « {h.text} »
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {authorOf(h.messageId) || "Message retiré du fil"}
            </span>
          </Button>
          <Tooltip content="Retirer ce passage">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Retirer ce passage"
              onPress={() => onRemove(h)}
              className="sn-hit h-8 min-h-8 w-8 min-w-8 shrink-0"
            >
              <X size={12} aria-hidden />
            </Button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
