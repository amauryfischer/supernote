"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ModalRoot,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeading,
  Button,
  Input,
  Textarea,
  Tooltip,
} from "@supernote/ui";
import {
  Gear,
  X,
  Paperclip,
  PaperPlaneTilt,
  Image as ImageIcon,
  FloppyDisk,
  UsersThree,
  FileArrowUp,
  WarningCircle,
} from "@phosphor-icons/react";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { applyTemplate, type MailTemplate } from "@/lib/mail-templates";
import { dedupeEmails, parseRecipientInput } from "@/lib/mail-recipients";
import { useCreateDraft } from "@/components/notes/useCreateDraft";
import { useDeferredSend } from "./useDeferredSend";
import { useSettings } from "@/components/settings/SettingsContext";
import { ComposerToolbar } from "./ComposerToolbar";
import { SendLaterButton } from "./SendLaterButton";
import { useSnippetAutocomplete, SnippetPopup } from "./SnippetAutocomplete";
import { firstName } from "@/lib/mail-snippets";
import { markdownToHtml, hasMarkup } from "@/lib/mail-markdown";
import { withSignature } from "@/lib/mail-signature";
import type { ForwardThread } from "@/lib/mail-forward";
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
import { formatBytes, listSentRecipients, type EmailAddress } from "@/lib/gmail";
import { useContactsSource } from "@/components/contacts/useContactsSource";
import { useMailTemplates } from "./useMailTemplates";
import { TemplatePicker } from "./TemplatePicker";
import { TemplateManager } from "./TemplateManager";
import { OrgRecipientPicker } from "./OrgRecipientPicker";

const SUCCESS_BEFORE_CLOSE_MS = 600;

/**
 * Composeur plein écran. Deux issues : « Créer le brouillon » (ouvre le
 * brouillon dans Gmail) ou « Envoyer » (⚠️ IRRÉVERSIBLE : part immédiatement,
 * destinataire requis).
 */
export function ComposeModal({
  isOpen,
  onClose,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
  thread,
  correspondents = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  /** Transfert : part dans le fil d'origine, qui garde la trace du transfert. */
  thread?: ForwardThread | undefined;
  /** Expéditeurs déjà vus (liste mail chargée), proposés en autocomplétion. */
  correspondents?: EmailAddress[];
}) {
  const { settings } = useSettings();
  const signature = settings.gmail.signature ?? "";
  const { createDraft } = useCreateDraft();
  const { scheduleSend, undoSeconds } = useDeferredSend();
  const { templates, upsert, remove } = useMailTemplates();

  const [recipients, setRecipients] = useState<string[]>(() => parseRecipientInput(initialTo));
  const [toInput, setToInput] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const draftFb = useActionFeedback();
  const sendFb = useActionFeedback();
  // « success » bloque aussi : la coche reste visible avant la fermeture, sans double envoi.
  const busy = draftFb.state === "pending" || draftFb.state === "success" || sendFb.state === "pending" || sendFb.state === "success";
  const [notice, setNotice] = useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [restored, setRestored] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const toFieldId = useId();
  const subjectFieldId = useId();

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
    setOrgOpen(false);
    setNotice(null);
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
          setNotice({
            tone: "warning",
            text: `Pièces jointes : ${formatBytes(totalAttachmentsSize(next))} au total, au-delà de ${formatBytes(MAX_ATTACHMENTS_BYTES)} l'envoi Gmail risque d'échouer.`,
          });
        }
        return next;
      });
    } catch (err) {
      setNotice({ tone: "danger", text: `Lecture du fichier échouée : ${errorText(err)}` });
    }
  };
  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const suggestionsId = useId();

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

  // Modèles à la frappe (`;raccourci`). Les variables sont alimentées par le
  // premier destinataire et l'objet déjà saisis.
  const snippetContext = useMemo(() => {
    const first = recipients[0] ?? "";
    return {
      prenom: firstName(undefined, first),
      nom: first,
      email: first,
      objet: subject,
      moi: signature.split("\n")[0]?.trim() ?? "",
    };
  }, [recipients, subject, signature]);

  const snippets = useSnippetAutocomplete({
    templates,
    value: body,
    onChange: setBody,
    textareaRef: bodyRef,
    context: snippetContext,
  });

  const submitDraft = async () => {
    if (!subject.trim() && !body.trim()) {
      setNotice({ tone: "danger", text: "Objet ou corps requis." });
      return;
    }
    // Inclut une adresse tapée mais non encore validée (pas de perte silencieuse).
    const allTo = dedupeEmails([...recipients, ...parseRecipientInput(toInput)]);
    setNotice(null);
    const url = await draftFb.run(
      async () => {
        const text = finalBody();
        const html = finalHtml(text);
        const res = await createDraft({
          to: allTo.length ? allTo : undefined,
          subject,
          body: text,
          ...(html ? { html } : {}),
          ...thread,
          attachments: attachments.length ? toOutgoing(attachments) : undefined,
        });
        return res.url;
      },
      (message) => setNotice({ tone: "danger", text: `Échec du brouillon : ${message}` }),
    );
    if (!url) return;
    clearAutoDraft(COMPOSE_DRAFT_KEY);
    window.open(url, "_blank", "noopener,noreferrer");
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_BEFORE_CLOSE_MS));
    onClose();
  };

  // ⚠️ Envoi IRRÉVERSIBLE : le mail part immédiatement. Destinataire requis
  // (contrairement au brouillon, optionnel).
  const submitSend = async (sendAt?: number) => {
    const allTo = dedupeEmails([...recipients, ...parseRecipientInput(toInput)]);
    if (allTo.length === 0) {
      setNotice({ tone: "danger", text: "Ajoute au moins un destinataire pour envoyer." });
      document.getElementById(toFieldId)?.focus();
      return;
    }
    if (!subject.trim() && !body.trim()) {
      setNotice({ tone: "danger", text: "Objet ou corps requis." });
      return;
    }
    // Sans fenêtre d'annulation ni date d'envoi, rien ne rattrape un envoi : on confirme.
    if (undoSeconds <= 0 && sendAt === undefined) {
      const who = allTo.length === 1 ? allTo[0] : `${allTo.length} destinataires`;
      if (!window.confirm(`Envoyer ce message à ${who} ? Cette action est immédiate.`)) {
        return;
      }
    }
    setNotice(null);
    const result = await sendFb.run(
      () => {
        const text = finalBody();
        const html = finalHtml(text);
        return scheduleSend(
          {
            kind: thread ? "reply" : "message",
            ...thread,
            to: allTo,
            subject,
            body: text,
            ...(html ? { html } : {}),
            ...(attachments.length ? { attachments: toOutgoing(attachments) } : {}),
          },
          sendAt !== undefined ? { sendAt } : {},
        );
      },
      (message) => setNotice({ tone: "danger", text: `Échec de l'envoi : ${message}` }),
    );
    if (!result) return;
    clearAutoDraft(COMPOSE_DRAFT_KEY);
    await new Promise((resolve) => setTimeout(resolve, SUCCESS_BEFORE_CLOSE_MS));
    onClose();
  };

  const fieldRow =
    "flex gap-3 border-b border-[var(--border-subtle)] py-2 transition-colors focus-within:border-[var(--border-focus)]";
  const fieldLabel = "w-12 shrink-0 text-sm text-[var(--text-muted)]";
  const bareInput =
    "h-8 rounded-none border-0 bg-transparent px-0 py-0 shadow-none focus:border-0 focus:ring-0 focus-visible:outline-none! [&::-webkit-calendar-picker-indicator]:opacity-0!";

  return (
    <>
      <ModalRoot
        isOpen={isOpen}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ModalBackdrop isDismissable={false} className="fixed inset-0 z-[var(--z-overlay)]">
          <ModalContainer size="full" className="fixed inset-0 z-[var(--z-modal)] flex h-dvh w-full p-0">
            <ModalDialog className="flex h-full w-full max-w-none flex-col rounded-none border-0 bg-[var(--surface-1)] p-0 text-[var(--text-primary)] shadow-none">
              <header className="box-content flex h-14 shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 pt-[env(safe-area-inset-top)] md:px-4">
                <Tooltip content="Fermer (Échap)">
                  <Button variant="ghost" isIconOnly aria-label="Fermer" onPress={onClose}>
                    <X size={18} />
                  </Button>
                </Tooltip>
                <ModalHeading className="min-w-0 flex-1 truncate text-base font-semibold">
                  {thread ? "Transférer" : "Nouveau message"}
                </ModalHeading>
                <Tooltip content="Créer le brouillon dans Gmail">
                  <Button
                    variant="ghost"
                    isIconOnly
                    aria-label="Créer le brouillon dans Gmail"
                    isDisabled={busy}
                    onPress={() => void submitDraft()}
                  >
                    <FeedbackIcon state={draftFb.state} error={draftFb.error} size={18} idle={<FileArrowUp size={18} />} />
                  </Button>
                </Tooltip>
                <SendLaterButton
                  iconOnly
                  isDisabled={busy}
                  onPick={(sendAt) => void submitSend(sendAt)}
                />
                <Button
                  variant="primary"
                  className="ml-1 flex items-center gap-1.5"
                  isDisabled={busy}
                  onPress={() => void submitSend()}
                >
                  <FeedbackIcon state={sendFb.state} error={sendFb.error} idle={<PaperPlaneTilt size={15} />} />
                  Envoyer
                </Button>
              </header>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 md:px-8">
                  {restored && (
                    <div
                      className="mt-4 flex items-center gap-2 rounded-md py-1 pl-3 pr-1 text-xs"
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      <FloppyDisk size={13} aria-hidden />
                      Brouillon restauré depuis ta dernière saisie.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7 min-h-7 px-2 text-xs"
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

                  {notice && (
                    <div
                      role="alert"
                      className="mt-4 flex items-center gap-2 rounded-md py-1 pl-3 pr-1 text-xs"
                      style={{
                        background: `var(--color-${notice.tone}-50)`,
                        color: `var(--color-${notice.tone}-700)`,
                      }}
                    >
                      <WarningCircle size={13} weight="bold" aria-hidden />
                      <span className="min-w-0 flex-1">{notice.text}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label="Masquer le message"
                        className="sn-hit h-6 min-h-6 w-6 min-w-6"
                        onPress={() => setNotice(null)}
                      >
                        <X size={11} />
                      </Button>
                    </div>
                  )}

                  <div className={`${fieldRow} items-start`}>
                    <label htmlFor={toFieldId} className={`${fieldLabel} pt-1.5`}>
                      À
                    </label>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {recipients.map((r) => (
                        <Pill key={r} label={r} removeLabel={`Retirer ${r}`} onRemove={() => removeRecipient(r)} />
                      ))}
                      <div className="min-w-24 flex-1">
                        <Input
                          id={toFieldId}
                          type="email"
                          value={toInput}
                          list={suggestionsId}
                          autoComplete="off"
                          className={bareInput}
                          onChange={(e) => setToInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              commitManual();
                            }
                          }}
                          onBlur={commitManual}
                          placeholder={recipients.length ? "" : "nom@exemple.com, Entrée pour valider"}
                        />
                      </div>
                    </div>
                    <Tooltip content="Envoyer à une organisation">
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label="Envoyer à une organisation"
                        aria-pressed={orgOpen}
                        onPress={() => setOrgOpen((o) => !o)}
                      >
                        <UsersThree size={16} />
                      </Button>
                    </Tooltip>
                    <RecipientSuggestions id={suggestionsId} correspondents={correspondents} />
                  </div>
                  {orgOpen && (
                    <div className="border-b border-[var(--border-subtle)] py-2 md:pl-[3.75rem]">
                      <OrgRecipientPicker onAdd={addRecipients} />
                    </div>
                  )}

                  <div className={`${fieldRow} items-center`}>
                    <label htmlFor={subjectFieldId} className={fieldLabel}>
                      Objet
                    </label>
                    <div className="min-w-0 flex-1">
                      <Input
                        id={subjectFieldId}
                        value={subject}
                        className={`${bareInput} text-base font-medium`}
                        onChange={(e) => setSubject(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="relative flex min-h-64 flex-1 flex-col py-5 [&>div]:flex-1">
                    {snippets.open && (
                      <SnippetPopup matches={snippets.matches} index={snippets.index} onPick={snippets.accept} />
                    )}
                    <Textarea
                      ref={bodyRef}
                      aria-label="Message"
                      value={body}
                      className="flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-[15px] leading-7 shadow-none focus:border-0 focus:ring-0"
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => snippets.handleKeyDown(e)}
                      onKeyUp={snippets.refresh}
                      onClick={snippets.refresh}
                      onBlur={snippets.close}
                      placeholder="Votre message…  **gras**, _italique_, - liste"
                      onPaste={(e) => {
                        // Une capture d'écran collée va DANS le message, pas en pièce jointe.
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
                  </div>

                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] py-3">
                      {attachments.map((att, i) => (
                        <Pill
                          key={`${att.filename}-${i}`}
                          icon={<Paperclip size={12} aria-hidden />}
                          label={attachmentLabel(att)}
                          removeLabel={`Retirer ${att.filename}`}
                          onRemove={() => removeAttachment(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <footer className="shrink-0 border-t border-[var(--border-subtle)] pb-[env(safe-area-inset-bottom)]">
                <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-0.5 overflow-x-auto px-2 md:px-6">
                  <div className="shrink-0">
                    <ComposerToolbar
                      textareaRef={bodyRef}
                      value={body}
                      onChange={setBody}
                      trailing={
                        <Tooltip content="Insérer une image">
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
                        </Tooltip>
                      }
                    />
                  </div>
                  <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-[var(--border-subtle)]" />
                  <Tooltip content="Joindre un fichier">
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label="Joindre un fichier"
                      className="h-8 min-h-8 w-8 min-w-8 shrink-0"
                      onPress={() => fileInputRef.current?.click()}
                    >
                      <Paperclip size={15} aria-hidden />
                    </Button>
                  </Tooltip>
                  <div className="shrink-0">
                    <TemplatePicker templates={templates} onInsert={insert} />
                  </div>
                  <Tooltip content="Gérer les modèles">
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label="Gérer les modèles"
                      className="h-8 min-h-8 w-8 min-w-8 shrink-0"
                      onPress={() => setManagerOpen(true)}
                    >
                      <Gear size={15} aria-hidden />
                    </Button>
                  </Tooltip>
                  {attachments.length > 0 && (
                    <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-[var(--text-muted)]">
                      {attachments.length} PJ · {formatBytes(totalAttachmentsSize(attachments))}
                    </span>
                  )}
                </div>
              </footer>

              {/* inputs file natifs pilotés par ref.click() : pas d'équivalent HeroUI. */}
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
            </ModalDialog>
          </ModalContainer>
        </ModalBackdrop>
      </ModalRoot>

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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function Pill({
  label,
  removeLabel,
  onRemove,
  icon,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] pl-2.5 pr-0.5 text-xs text-[var(--text-primary)]">
      {icon}
      <span className="max-w-[220px] truncate">{label}</span>
      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        onPress={onRemove}
        aria-label={removeLabel}
        className="sn-hit h-6 min-h-6 w-6 min-w-6 shrink-0 rounded-full p-0"
      >
        <X size={11} />
      </Button>
    </span>
  );
}

// Une seule tentative par session, même en échec : ~50 requêtes metadata, et rejouer
// sur un 403 de quota l'entretiendrait.
let sentRecipientsCache: Promise<EmailAddress[]> | null = null;

/**
 * Destinataires habituels (envoyés, par fréquence) + contacts du coffre +
 * expéditeurs connus, en `<datalist>` natif pour le champ destinataire.
 */
function RecipientSuggestions({ id, correspondents }: { id: string; correspondents: EmailAddress[] }) {
  const { settings } = useSettings();
  const { contacts } = useContactsSource();
  const clientId = settings.googleDrive.clientId.trim();
  const [sent, setSent] = useState<EmailAddress[]>([]);
  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    sentRecipientsCache ??= listSentRecipients(clientId, 50).catch(() => []);
    void sentRecipientsCache.then((list) => {
      if (alive) setSent(list);
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const suggestions = useMemo(() => {
    const self = new Set(
      [settings.gmail.connectedEmail, ...settings.gmail.aliases].map((a) => a.toLowerCase()),
    );
    const byEmail = new Map<string, string>();
    const add = (email: string, name: string) => {
      const key = email.trim().toLowerCase();
      if (key && !self.has(key) && !byEmail.has(key)) byEmail.set(key, name);
    };
    for (const c of sent) add(c.email, c.name);
    for (const c of contacts) for (const e of c.emails) add(e.value, c.name);
    for (const c of correspondents) add(c.email, c.name);
    return [...byEmail];
  }, [sent, contacts, correspondents, settings.gmail.connectedEmail, settings.gmail.aliases]);

  return (
    <datalist id={id}>
      {suggestions.map(([email, name]) => (
        <option key={email} value={email} label={name && name.toLowerCase() !== email ? name : undefined} />
      ))}
    </datalist>
  );
}
