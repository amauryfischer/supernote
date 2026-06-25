"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, Button, Input, Textarea, useToast } from "@supernote/ui";
import { Gear, ArrowSquareOut, X, Paperclip } from "@phosphor-icons/react";
import { applyTemplate, type MailTemplate } from "@/lib/mail-templates";
import { dedupeEmails, parseRecipientInput } from "@/lib/mail-recipients";
import { useCreateDraft } from "@/components/notes/useCreateDraft";
import {
  filesToAttachments,
  toOutgoing,
  totalAttachmentsSize,
  exceedsAttachmentLimit,
  attachmentLabel,
  MAX_ATTACHMENTS_BYTES,
  type PendingAttachment,
} from "@/lib/mail-attachments";
import { formatBytes } from "@/lib/gmail";
import { useMailTemplates } from "./useMailTemplates";
import { TemplatePicker } from "./TemplatePicker";
import { TemplateManager } from "./TemplateManager";
import { OrgRecipientPicker } from "./OrgRecipientPicker";

/**
 * Mini compose : objet + corps + insertion rapide de modèles, crée un BROUILLON
 * Gmail (jamais d'envoi direct, cf. politique compose draft-first) puis l'ouvre
 * dans Gmail. Héberge le picker et le gestionnaire de modèles.
 */
export function ComposeModal({
  isOpen,
  onClose,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
}: {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
}) {
  const { toast } = useToast();
  const { createDraft } = useCreateDraft();
  const { templates, upsert, remove } = useMailTemplates();

  const [recipients, setRecipients] = useState<string[]>(() => parseRecipientInput(initialTo));
  const [toInput, setToInput] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Réinitialise les champs à l'ouverture.
  useEffect(() => {
    if (isOpen) {
      setRecipients(parseRecipientInput(initialTo));
      setToInput("");
      setSubject(initialSubject);
      setBody(initialBody);
      setAttachments([]);
    }
  }, [isOpen, initialTo, initialSubject, initialBody]);

  const onPickFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    try {
      const added = await filesToAttachments(Array.from(fileList));
      setAttachments((prev) => {
        const next = [...prev, ...added];
        if (exceedsAttachmentLimit(next)) {
          toast({
            title: "Pièces jointes volumineuses",
            description: `Total ${formatBytes(totalAttachmentsSize(next))} > ${formatBytes(MAX_ATTACHMENTS_BYTES)} : l'envoi Gmail risque d'échouer.`,
            variant: "warning",
          });
        }
        return next;
      });
    } catch (err) {
      toast({
        title: "Lecture du fichier échouée",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const addRecipients = (emails: string[]) => {
    setRecipients((prev) => dedupeEmails([...prev, ...emails]));
  };
  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };
  /** Valide la saisie manuelle courante (Entrée, virgule, ou avant l'envoi). */
  const commitManual = () => {
    const parsed = parseRecipientInput(toInput);
    if (parsed.length) addRecipients(parsed);
    setToInput("");
  };

  const insert = (t: MailTemplate) => {
    const next = applyTemplate({ subject, body }, t);
    setSubject(next.subject);
    setBody(next.body);
  };

  const submit = async () => {
    if (!subject.trim() && !body.trim()) {
      toast({ title: "Objet ou corps requis", variant: "danger" });
      return;
    }
    // Inclut une adresse tapée mais non encore validée (pas de perte silencieuse).
    const allTo = dedupeEmails([...recipients, ...parseRecipientInput(toInput)]);
    setBusy(true);
    try {
      const { url } = await createDraft({
        to: allTo.length ? allTo : undefined,
        subject,
        body,
        attachments: attachments.length ? toOutgoing(attachments) : undefined,
      });
      toast({ title: "Brouillon créé dans Gmail" });
      window.open(url, "_blank", "noopener,noreferrer");
      onClose();
    } catch (err) {
      toast({
        title: "Échec du brouillon",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title="Nouveau message"
        size="lg"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Destinataires (optionnel)
            </span>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={{
                      borderColor: "var(--border-subtle)",
                      backgroundColor: "var(--surface-2)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="max-w-[200px] truncate">{r}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => removeRecipient(r)}
                      aria-label={`Retirer ${r}`}
                      className="h-4 w-4 min-h-0 min-w-0 p-0"
                    >
                      <X size={11} />
                    </Button>
                  </span>
                ))}
              </div>
            )}
            <Input
              type="email"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitManual();
                }
              }}
              onBlur={commitManual}
              placeholder="nom@exemple.com — Entrée pour ajouter"
            />
            <OrgRecipientPicker onAdd={addRecipients} />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Objet
            </span>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Objet" />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Message
              </span>
              <div className="flex items-center gap-1">
                <TemplatePicker templates={templates} onInsert={insert} />
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => setManagerOpen(true)}
                  isIconOnly
                  aria-label="Gérer les modèles"
                >
                  <Gear size={14} />
                </Button>
              </div>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Votre message…"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                Pièces jointes
                {attachments.length > 0 && ` · ${formatBytes(totalAttachmentsSize(attachments))}`}
              </span>
              <Button size="sm" variant="ghost" onPress={() => fileInputRef.current?.click()}>
                <Paperclip size={14} /> Joindre
              </Button>
            </div>
            {/* input file natif (exception justifiée : pas d'équivalent HeroUI). */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((att, i) => (
                  <span
                    key={`${att.filename}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                    style={{
                      borderColor: "var(--border-subtle)",
                      backgroundColor: "var(--surface-2)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <Paperclip size={11} />
                    <span className="max-w-[220px] truncate">{attachmentLabel(att)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => removeAttachment(i)}
                      aria-label={`Retirer ${att.filename}`}
                      className="h-4 w-4 min-h-0 min-w-0 p-0"
                    >
                      <X size={11} />
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Annuler
            </Button>
            <Button variant="primary" isDisabled={busy} onPress={() => void submit()}>
              {busy ? "Création…" : "Créer le brouillon"}
              {!busy && <ArrowSquareOut size={14} />}
            </Button>
          </div>
        </div>
      </Modal>

      <TemplateManager
        isOpen={managerOpen}
        onClose={() => setManagerOpen(false)}
        templates={templates}
        onUpsert={upsert}
        onRemove={remove}
      />
    </>
  );
}
