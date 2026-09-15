"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Button, Input, Textarea, useToast } from "@supernote/ui";
import { Gear, ArrowSquareOut, X, Paperclip, PaperPlaneTilt, Image as ImageIcon, FloppyDisk } from "@phosphor-icons/react";
import { applyTemplate, type MailTemplate } from "@/lib/mail-templates";
import { dedupeEmails, parseRecipientInput } from "@/lib/mail-recipients";
import { useCreateDraft } from "@/components/notes/useCreateDraft";
import { useSendMessage } from "@/components/notes/useSendMessage";
import { useSettings } from "@/components/settings/SettingsContext";
import { ComposerToolbar } from "./ComposerToolbar";
import { markdownToHtml, hasMarkup } from "@/lib/mail-markdown";
import { withSignature } from "@/lib/mail-signature";
import {
  loadAutoDraft,
  saveAutoDraft,
  clearAutoDraft,
  COMPOSE_DRAFT_KEY,
} from "@/lib/mail-draft-store";
import {
  filesToAttachments,
  imageToInlineAttachment,
  isInlineImage,
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
 * Mini compose : objet + corps + insertion rapide de modèles. Deux issues :
 * « Créer le brouillon » (ouvre le brouillon dans Gmail) ou « Envoyer »
 * (⚠️ IRRÉVERSIBLE : part immédiatement, destinataire requis). Héberge le
 * picker et le gestionnaire de modèles.
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
  const { settings } = useSettings();
  const signature = settings.gmail.signature ?? "";
  const { createDraft } = useCreateDraft();
  const { sendMessage } = useSendMessage();
  const { templates, upsert, remove } = useMailTemplates();

  const [recipients, setRecipients] = useState<string[]>(() => parseRecipientInput(initialTo));
  const [toInput, setToInput] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Brouillon auto-sauvegardé restauré à l'ouverture (bandeau informatif).
  const [restored, setRestored] = useState(false);

  // Ouverture : on restaure le brouillon auto-sauvegardé s'il y en a un et que
  // l'appelant n'impose pas de contenu (transfert, modèle…). Sinon champs
  // neufs, avec la signature déjà en place.
  useEffect(() => {
    if (!isOpen) return;
    const prefilled = Boolean(initialTo || initialSubject || initialBody);
    const draft = prefilled ? null : loadAutoDraft(COMPOSE_DRAFT_KEY);
    if (draft) {
      setRecipients(draft.to ?? []);
      setSubject(draft.subject ?? "");
      setBody(draft.body);
      setRestored(true);
    } else {
      setRecipients(parseRecipientInput(initialTo));
      setSubject(initialSubject);
      setBody(withSignature(initialBody, signature));
      setRestored(false);
    }
    setToInput("");
    setAttachments([]);
  }, [isOpen, initialTo, initialSubject, initialBody, signature]);

  // Sauvegarde automatique pendant la frappe : fermer la fenêtre ou recharger
  // l'onglet ne perd plus le message en cours. Débattue pour ne pas écrire à
  // chaque caractère.
  useEffect(() => {
    if (!isOpen) return undefined;
    const id = setTimeout(() => {
      saveAutoDraft({ key: COMPOSE_DRAFT_KEY, subject, body, to: recipients });
    }, 500);
    return () => clearTimeout(id);
  }, [isOpen, subject, body, recipients]);

  /** Corps prêt à partir : signature ajoutée si elle manque. */
  const finalBody = useCallback(() => withSignature(body, signature), [body, signature]);

  /**
   * Part HTML à envoyer, ou `undefined` pour rester en texte pur. On n'en
   * génère une QUE s'il y a de la mise en forme ou une image inline — un
   * message simple part en texte, comme avant.
   */
  const finalHtml = useCallback(
    (text: string): string | undefined => {
      const inline = attachments.some((a) => a.contentId);
      return hasMarkup(text) || inline ? markdownToHtml(text) : undefined;
    },
    [attachments],
  );

  /**
   * Insère une image DANS le corps : pièce jointe `inline` (Content-ID) +
   * référence Markdown `![nom](cid:…)` à la position du curseur. Le message
   * part alors en multipart/related et l'image s'affiche dans le mail.
   */
  const insertInlineImages = useCallback(async (files: File[]) => {
    const images = files.filter((f) => isInlineImage(f.type));
    if (images.length === 0) return false;
    const added = await Promise.all(images.map((f) => imageToInlineAttachment(f)));
    setAttachments((prev) => [...prev, ...added]);
    setBody((prev) => {
      const refs = added.map((a) => `![${a.filename}](cid:${a.contentId})`).join("\n");
      return prev.trim() ? `${prev}\n\n${refs}\n` : `${refs}\n`;
    });
    return true;
  }, []);

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

  const submitDraft = async () => {
    if (!subject.trim() && !body.trim()) {
      toast({ title: "Objet ou corps requis", variant: "danger" });
      return;
    }
    // Inclut une adresse tapée mais non encore validée (pas de perte silencieuse).
    const allTo = dedupeEmails([...recipients, ...parseRecipientInput(toInput)]);
    setBusy("draft");
    try {
      const text = finalBody();
      const html = finalHtml(text);
      const { url } = await createDraft({
        to: allTo.length ? allTo : undefined,
        subject,
        body: text,
        ...(html ? { html } : {}),
        attachments: attachments.length ? toOutgoing(attachments) : undefined,
      });
      clearAutoDraft(COMPOSE_DRAFT_KEY);
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
      setBusy(null);
    }
  };

  // ⚠️ Envoi IRRÉVERSIBLE : le mail part immédiatement. Destinataire requis
  // (contrairement au brouillon, optionnel). Confirmation avant départ.
  const submitSend = async () => {
    const allTo = dedupeEmails([...recipients, ...parseRecipientInput(toInput)]);
    if (allTo.length === 0) {
      toast({ title: "Destinataire requis pour envoyer", variant: "danger" });
      return;
    }
    if (!subject.trim() && !body.trim()) {
      toast({ title: "Objet ou corps requis", variant: "danger" });
      return;
    }
    const who = allTo.length === 1 ? allTo[0] : `${allTo.length} destinataires`;
    if (!window.confirm(`Envoyer ce message à ${who} ? Cette action est immédiate.`)) {
      return;
    }
    setBusy("send");
    try {
      const text = finalBody();
      const html = finalHtml(text);
      await sendMessage({
        to: allTo,
        subject,
        body: text,
        ...(html ? { html } : {}),
        attachments: attachments.length ? toOutgoing(attachments) : undefined,
      });
      clearAutoDraft(COMPOSE_DRAFT_KEY);
      toast({ title: "Message envoyé", variant: "success" });
      onClose();
    } catch (err) {
      toast({
        title: "Échec de l'envoi",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(null);
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
          {restored && (
            <div
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs"
              style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              <FloppyDisk size={13} aria-hidden />
              Brouillon restauré depuis ta dernière saisie.
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto h-6 min-h-6 px-1.5 text-xs"
                onPress={() => {
                  clearAutoDraft(COMPOSE_DRAFT_KEY);
                  setRecipients([]);
                  setSubject("");
                  setBody(withSignature("", signature));
                  setRestored(false);
                }}
              >
                Repartir de zéro
              </Button>
            </div>
          )}
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
                      className="-my-1.5 ml-0.5 inline-flex h-8 min-h-8 w-8 min-w-8 shrink-0 items-center justify-center p-0 hover:opacity-70"
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
            <ComposerToolbar
              textareaRef={bodyRef}
              value={body}
              onChange={setBody}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="Insérer une image dans le message"
                  className="h-8 min-h-8 w-8 min-w-8"
                  onPress={() => imageInputRef.current?.click()}
                >
                  <ImageIcon size={15} aria-hidden />
                </Button>
              }
            />
            <Textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Votre message…  **gras**, _italique_, - liste"
              onPaste={(e) => {
                // Coller une capture d'écran l'insère DANS le message plutôt
                // que de ne rien faire.
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length === 0) return;
                void insertInlineImages(files).then((handled) => {
                  if (!handled) void onPickFiles(e.clipboardData?.files ?? null);
                });
                e.preventDefault();
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const files = Array.from(e.dataTransfer?.files ?? []);
                if (files.length === 0) return;
                e.preventDefault();
                const images = files.filter((f) => isInlineImage(f.type));
                const others = files.filter((f) => !isInlineImage(f.type));
                if (images.length) void insertInlineImages(images);
                if (others.length) {
                  void filesToAttachments(others).then((added) =>
                    setAttachments((prev) => [...prev, ...added]),
                  );
                }
              }}
            />
            {/* input image natif (exception justifiée : pas d'équivalent HeroUI). */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void insertInlineImages(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
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
                      className="-my-1.5 ml-0.5 inline-flex h-8 min-h-8 w-8 min-w-8 shrink-0 items-center justify-center p-0 hover:opacity-70"
                    >
                      <X size={11} />
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Annuler
            </Button>
            <Button
              variant="ghost"
              isDisabled={busy !== null}
              onPress={() => void submitDraft()}
            >
              {busy === "draft" ? "Création…" : "Créer le brouillon"}
              {busy === null && <ArrowSquareOut size={14} />}
            </Button>
            <Button
              variant="primary"
              isDisabled={busy !== null}
              onPress={() => void submitSend()}
            >
              <PaperPlaneTilt size={14} /> {busy === "send" ? "Envoi…" : "Envoyer"}
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
