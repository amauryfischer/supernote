"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Plus, X, Tag, MagnifyingGlass, Check, PaperPlaneTilt, Quotes, Paperclip, Star, Envelope, ArrowBendUpRight, Sparkle, MagicWand, ArrowsClockwise, CaretUp, DotsThreeVertical } from "@phosphor-icons/react";
import { Button, Input, Spinner, Checkbox, Popover } from "@heroui/react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  listLabels,
  resolveUserLabels,
  addThreadLabel,
  removeThreadLabel,
  markThreadRead,
  markThreadUnread,
  toggleStar,
  sendReply,
  createDraft,
  buildGmailDraftUrl,
  classifyBubble,
  downloadAttachment,
  formatBytes,
  type EmailThread,
  type EmailMessage,
  type EmailAttachment,
  type GmailLabel,
  type BubbleKind,
} from "@/lib/gmail";
import { parseEmailBody } from "@/lib/email-quote";
import { sanitizeEmailHtml, splitQuotedHtml } from "@/lib/mail-html";
import {
  filesToAttachments,
  toOutgoing,
  totalAttachmentsSize,
  exceedsAttachmentLimit,
  attachmentLabel,
  MAX_ATTACHMENTS_BYTES,
  type PendingAttachment,
} from "@/lib/mail-attachments";
import { buildReplyParams, pickReplyAll, buildQuotedBody } from "@/lib/mail-reply";
import { buildForwardSubject, buildForwardedBody } from "@/lib/mail-forward";
import { TriageBar } from "./TriageBar";
import { EnrichContactFromEmail } from "./EnrichContactFromEmail";
import { EmailToEventButton } from "./EmailToEventButton";
import { MailEisenhowerPicker } from "./MailEisenhowerPicker";
import { ExtractActionsButton } from "./ExtractActionsButton";
import { type TriageAction } from "@/lib/mail-triage";
import { type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { useConvertToTodo } from "./useConvertToTodo";
import {
  isAiConfigured,
  summarizeThread,
  draftReply,
  suggestQuadrant,
  type MailAiThread,
} from "@/lib/mail-ai";

// ─── Styles du menu overflow (« Plus ») ──────────────────────────────────────
// Ligne de menu pour une action SIMPLE (Button direct) : pleine largeur, alignée
// à gauche, padding tactile (~36px de haut ≥ cible 32px mobile).
const MENU_ROW =
  "flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-3 py-2 text-sm";
// Conteneur qui uniformise un COMPOSANT-action self-contained (ExtractActions,
// MailEisenhowerPicker, EnrichContact, EmailToEvent — chacun apporte son propre
// déclencheur + overlay) en « ligne de menu » pleine largeur. Le sélecteur
// descendant ne touche QUE le déclencheur encore dans l'arbre : le contenu de
// l'overlay (Popover/Modal/Dropdown) est porté ailleurs via portal, donc non
// stylé ici. Les composants restent inchangés (juste déplacés dans le menu).
const MENU_COMPONENT_ROW =
  "w-full [&_button]:h-auto [&_button]:min-h-9 [&_button]:w-full [&_button]:justify-start [&_button]:gap-2.5 [&_button]:rounded-md [&_button]:px-3 [&_button]:py-2 [&_button]:text-sm";

/**
 * Affichage d'un thread Gmail façon messagerie (chat) : mes messages alignés à
 * droite, ceux du correspondant à gauche.
 *
 * Corps : deux chemins. Si le message a un corps text/html (`bodyHtml`), il est
 * rendu SANITIZÉ via DOMPurify (`sanitizeEmailHtml`, voir `lib/mail-html.ts`)
 * dans un conteneur isolé — pas d'extraction citation/signature sur ce chemin.
 * Sinon, fallback TEXTE BRUT historique (`bodyText`) avec citation/signature
 * retirées mais dépliables. Aucun HTML non sanitizé n'est jamais rendu (anti-XSS).
 *
 * En-tête : les labels utilisateur du thread sont affichés en badges supprimables
 * (X → retire le label) ; un bouton « + Label » (ou la touche `l` au clavier)
 * ouvre un sélecteur filtrable (tape, flèches, Entrée). Mutations via le scope
 * `gmail.modify` (consentement incrémental), avec mise à jour optimiste + rollback.
 *
 * `selfEmail` : adresse du compte connecté → détermine quels messages sont « moi »
 * (alignés à droite, violet). Les correspondants du MÊME domaine que le compte
 * connecté (collègues « internes ») reçoivent une teinte cool distincte ; les
 * externes gardent la teinte neutre. Absent → tout traité comme externe à gauche.
 * `enableShortcuts` : active le raccourci clavier global `l` (défaut true). Mis à
 * false dans l'embed note (`GmailMessageView`) pour ne pas capturer `l` dans
 * l'éditeur.
 * `embedded` : mode embed note (défaut false). MASQUE le menu d'actions
 * secondaires (« Plus ») et DÉSACTIVE le composeur de réponse inline (remplacé
 * par un lien « Ouvrir dans Gmail »). Posé par `GmailMessageView`.
 */
export function EmailThreadView({
  thread,
  selfEmail,
  enableShortcuts = true,
  embedded = false,
  onTriaged,
  onReplied,
  onLabelsChanged,
  onForward,
  onConvertedToTodo,
}: {
  thread: EmailThread;
  selfEmail?: string;
  enableShortcuts?: boolean;
  /**
   * Mode embed (bloc note) : masque les actions secondaires (menu « Plus ») et
   * désactive le composeur inline au profit d'un lien « Ouvrir dans Gmail ».
   */
  embedded?: boolean;
  /** Appelé après un triage réussi (Done/Archive/Snooze) — l'appelant retire le fil de la liste. */
  onTriaged?: (action: TriageAction) => void;
  /**
   * Appelé après un ENVOI de réponse réussi (mode `send` uniquement, pas le
   * brouillon) — l'appelant re-fetch le fil + la liste pour afficher la réponse
   * sans rechargement manuel.
   */
  onReplied?: () => void;
  /**
   * Appelé quand les labelIds optimistes du thread changent (étoile, marqué non
   * lu) — l'appelant resynchronise la ligne correspondante dans la liste de
   * gauche (étoile, pastille « non lu ») sans rechargement.
   */
  onLabelsChanged?: (threadId: string, labelIds: string[]) => void;
  /**
   * Appelé quand l'utilisateur clique « Transférer » — l'appelant ouvre le
   * ComposeModal pré-rempli (objet « Fwd: … » + corps cité), destinataire vide.
   */
  onForward?: (prefill: { subject: string; body: string }) => void;
  /**
   * Appelé après la conversion réussie d'un email en tâche Eisenhower (création
   * de l'entité `todo` + liaison locale + retrait d'`INBOX`) — l'appelant retire
   * le fil de la liste inbox, comme pour un triage « Fait ».
   */
  onConvertedToTodo?: () => void;
}) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const { toast } = useToast();

  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  // État optimiste des labels du thread (resynchronisé à chaque thread chargé).
  const [labelIds, setLabelIds] = useState<string[]>(thread.labelIds);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Ouverture du menu overflow « Plus » (actions secondaires regroupées).
  const [moreOpen, setMoreOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Garde anti-double : 1 seul markThreadRead par thread ouvert.
  const readMarkedRef = useRef<string | null>(null);

  useEffect(() => {
    setLabelIds(thread.labelIds);
  }, [thread]);

  // À l'ouverture d'un thread non lu : le marquer lu (optimiste + best-effort).
  // Une seule fois par thread.id ; si l'appel échoue, on resté en silence (le
  // thread reste « non lu » côté Gmail, resync au prochain chargement de liste).
  useEffect(() => {
    if (!clientId) return;
    if (readMarkedRef.current === thread.id) return;
    if (!thread.labelIds.includes("UNREAD")) return;
    readMarkedRef.current = thread.id;
    setLabelIds((prev) => prev.filter((id) => id !== "UNREAD"));
    markThreadRead(clientId, thread.id).catch(() => {
      /* best-effort : pas de toast pour un marquage-lu silencieux */
    });
  }, [thread.id, thread.labelIds, clientId]);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    listLabels(clientId)
      .then((ls) => {
        if (!cancelled) setAllLabels(ls);
      })
      .catch(() => {
        /* labels indisponibles → pas de badges, non bloquant */
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const current = useMemo(() => resolveUserLabels(labelIds, allLabels), [labelIds, allLabels]);
  const addable = useMemo(
    () => allLabels.filter((l) => !labelIds.includes(l.id)),
    [allLabels, labelIds],
  );

  // ─── Réponse rapide (barre fixe en bas) ───────────────────────────────────
  const replyParams = useMemo(() => buildReplyParams(thread, selfEmail), [thread, selfEmail]);
  // « Répondre à tous » : tous les participants du fil sauf soi (Cc inclus à l'envoi).
  const replyAll = useMemo(() => pickReplyAll(thread, selfEmail), [thread, selfEmail]);
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState<"send" | "draft" | null>(null);
  // Toggle « Répondre à tous » : défaut = réponse simple. Pas de Cc à ajouter
  // (seul le destinataire principal) → l'option est sans effet, on la masque.
  const [replyToAll, setReplyToAll] = useState(false);
  const hasCc = replyAll.cc.length > 0;
  // Pièces jointes de la réponse en cours (réinitialisées au changement de fil).
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([]);
  const replyFileRef = useRef<HTMLInputElement>(null);
  // ─── IA locale (Ollama) : résumé du fil + brouillon de réponse ─────────────
  // États dédiés ; resynchronisés au changement de fil (le résumé d'un fil ne
  // doit pas « fuiter » sur le suivant).
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [useNotes, setUseNotes] = useState(false);
  // Quadrant Eisenhower suggéré par l'IA (best-effort) → pré-sélectionné dans le
  // MailEisenhowerPicker (ouvre le Popover sur la cellule). Réinitialisé par fil.
  const [suggestedQuadrant, setSuggestedQuadrant] = useState<EisenhowerQuadrant | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  useEffect(() => {
    setReplyBody("");
    setReplyToAll(false);
    setReplyAttachments([]);
    setSummary(null);
    setSummaryOpen(false);
    setSuggestedQuadrant(null);
  }, [thread]);

  // Gate d'affichage des features IA : visibles seulement si un modèle Ollama
  // est configuré dans les réglages. Réactif au modèle des réglages.
  const aiConfigured = useMemo(() => isAiConfigured(), [settings.ia.ollamaModel]);
  // Adaptateur EmailThread → MailAiThread : on ne passe QUE du texte brut au
  // prompt (bodyText/snippet, JAMAIS le HTML de l'expéditeur → pas d'injection).
  const aiThread = useMemo<MailAiThread>(
    () => ({
      id: thread.id,
      messages: thread.messages.map((m) => ({
        subject: m.subject,
        from: { name: m.from.name, email: m.from.email },
        date: m.date,
        bodyText: m.bodyText || m.snippet || "",
      })),
    }),
    [thread],
  );

  const runSummary = async () => {
    if (summaryBusy) return;
    setSummaryOpen(true);
    setSummaryBusy(true);
    try {
      const text = await summarizeThread(aiThread);
      setSummary(text);
    } catch (e) {
      toast({
        title: "Résumé impossible",
        description: e instanceof Error ? e.message : "Ollama injoignable",
        variant: "danger",
      });
    } finally {
      setSummaryBusy(false);
    }
  };

  // Clic « Résumer » : génère au 1ᵉʳ appel, sinon replie/déplie l'encart existant.
  const onSummaryClick = () => {
    if (summary === null && !summaryBusy) {
      void runSummary();
    } else {
      setSummaryOpen((o) => !o);
    }
  };

  const runDraft = async () => {
    if (draftBusy) return;
    setDraftBusy(true);
    try {
      const text = (await draftReply(aiThread, { useNotes })).trim();
      if (!text) {
        toast({
          title: "Brouillon vide",
          description: "Le modèle n'a renvoyé aucun texte.",
          variant: "warning",
        });
        return;
      }
      // Ne pas écraser un texte déjà saisi : on ajoute en dessous (sinon remplace).
      setReplyBody((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
    } catch (e) {
      toast({
        title: "Brouillon IA impossible",
        description: e instanceof Error ? e.message : "Ollama injoignable",
        variant: "danger",
      });
    } finally {
      setDraftBusy(false);
    }
  };

  // Suggestion IA d'un quadrant Eisenhower (best-effort, non bloquant). On reset
  // d'abord à null pour que MailEisenhowerPicker rouvre même si la suggestion est
  // identique à la précédente (null → q = toujours un changement).
  const runSuggestQuadrant = async () => {
    if (suggestBusy) return;
    setSuggestBusy(true);
    setSuggestedQuadrant(null);
    try {
      const q = await suggestQuadrant(aiThread);
      setSuggestedQuadrant(q);
    } catch (e) {
      toast({
        title: "Suggestion de quadrant impossible",
        description: e instanceof Error ? e.message : "Ollama injoignable",
        variant: "danger",
      });
    } finally {
      setSuggestBusy(false);
    }
  };

  const onPickReplyFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    try {
      const added = await filesToAttachments(Array.from(fileList));
      setReplyAttachments((prev) => {
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
    } catch (e) {
      toast({
        title: "Lecture du fichier échouée",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
    }
  };
  const removeReplyAttachment = (index: number) => {
    setReplyAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Insère la citation du dernier message en tête de la zone de texte.
  const insertQuote = () => {
    const last = thread.messages[thread.messages.length - 1];
    if (!last) return;
    const quote = buildQuotedBody(last);
    setReplyBody((prev) => (prev.trim() ? `${prev}\n\n${quote}\n` : `${quote}\n`));
  };

  const submitReply = async (mode: "send" | "draft") => {
    const body = replyBody.trim();
    if (!body || !clientId) return;
    const cc = replyToAll && hasCc ? replyAll.cc : undefined;
    const attachments = replyAttachments.length ? toOutgoing(replyAttachments) : undefined;
    setReplyBusy(mode);
    try {
      if (mode === "send") {
        await sendReply(clientId, { ...replyParams, cc, body, attachments });
        toast({ title: "Réponse envoyée", variant: "success" });
        setReplyBody("");
        setReplyAttachments([]);
        // Re-fetch fil + liste côté appelant pour faire apparaître la réponse.
        onReplied?.();
        return;
      } else {
        const { draftId } = await createDraft(clientId, { ...replyParams, cc, body, attachments });
        window.open(buildGmailDraftUrl(draftId), "_blank", "noopener");
        toast({ title: "Brouillon créé", description: "Ouvert dans Gmail." });
      }
      setReplyBody("");
      setReplyAttachments([]);
    } catch (e) {
      toast({
        title: mode === "send" ? "Échec de l'envoi" : "Échec du brouillon",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
    } finally {
      setReplyBusy(null);
    }
  };

  // Transférer : pré-remplit le compose à partir du dernier message du fil
  // (objet « Fwd: … » + bloc « Message transféré » cité). Délégué à l'appelant
  // qui possède le ComposeModal. Destinataire laissé vide.
  const onForwardClick = () => {
    if (!onForward) return;
    const last = thread.messages[thread.messages.length - 1];
    if (!last) return;
    onForward({
      subject: buildForwardSubject(last.subject || thread.messages[0]?.subject || ""),
      body: buildForwardedBody(last),
    });
  };

  // ─── Conversion email → tâche Eisenhower ──────────────────────────────────
  // Verrou anti-double clic pendant la création de l'entité + la mutation Gmail.
  // Conversion mutualisée (vue lecture + menu contextuel de la liste).
  const { convert: convertEmailToTodo, busy: convertBusy } = useConvertToTodo(clientId);
  const convertToTodo = async (quadrant: EisenhowerQuadrant) => {
    const subject = thread.messages[0]?.subject ?? "";
    const ok = await convertEmailToTodo({ threadId: thread.id, subject, quadrant });
    if (ok) onConvertedToTodo?.();
  };

  const openPicker = () => {
    if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    setPickerOpen(true);
  };

  // Raccourci clavier global `l` → ouvre le sélecteur (sauf focus dans un champ).
  useEffect(() => {
    if (!enableShortcuts || !clientId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "l" && e.key !== "L") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
      setPickerOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enableShortcuts, clientId]);

  const mutate = async (labelId: string, action: "add" | "remove") => {
    if (!clientId) return;
    const prev = labelIds;
    setLabelIds(action === "add" ? [...labelIds, labelId] : labelIds.filter((id) => id !== labelId));
    try {
      if (action === "add") await addThreadLabel(clientId, thread.id, labelId);
      else await removeThreadLabel(clientId, thread.id, labelId);
    } catch (err) {
      setLabelIds(prev);
      toast({
        title: action === "add" ? "Ajout du label échoué" : "Retrait du label échoué",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  // Étoile : toggle optimiste sur l'état local `labelIds` + appel Gmail (scope
  // modify), rollback sur échec. Notifie l'appelant pour resync de la ligne.
  const starred = labelIds.includes("STARRED");
  const onToggleStar = async () => {
    if (!clientId) return;
    const next = !starred;
    const prev = labelIds;
    const nextIds = next ? [...labelIds, "STARRED"] : labelIds.filter((id) => id !== "STARRED");
    setLabelIds(nextIds);
    onLabelsChanged?.(thread.id, nextIds);
    try {
      await toggleStar(clientId, thread.id, next);
    } catch (err) {
      setLabelIds(prev);
      onLabelsChanged?.(thread.id, prev);
      toast({
        title: next ? "Ajout de l'étoile échoué" : "Retrait de l'étoile échoué",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  // Marquer non lu : ajoute UNREAD (optimiste) + appel Gmail. On arme la garde
  // anti-double pour que l'effet de marquage-lu ne re-marque pas lu aussitôt.
  const onMarkUnread = async () => {
    if (!clientId) return;
    readMarkedRef.current = thread.id;
    const prev = labelIds;
    const nextIds = labelIds.includes("UNREAD") ? labelIds : [...labelIds, "UNREAD"];
    setLabelIds(nextIds);
    onLabelsChanged?.(thread.id, nextIds);
    try {
      await markThreadUnread(clientId, thread.id);
      toast({ title: "Marqué non lu" });
    } catch (err) {
      setLabelIds(prev);
      onLabelsChanged?.(thread.id, prev);
      toast({
        title: "Marquage non lu échoué",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  if (!thread.messages.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Thread vide.
      </p>
    );
  }
  const subject = thread.messages[0]?.subject;
  const firstMsg = thread.messages[0]!;
  const self = (selfEmail ?? "").toLowerCase();
  // Pour l'enrichissement : dernier message du correspondant (pas « moi »).
  const correspondentMsg =
    (self
      ? [...thread.messages].reverse().find((m) => m.from.email.toLowerCase() !== self)
      : thread.messages[thread.messages.length - 1]) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {clientId && (
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => void onToggleStar()}
                aria-label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
                aria-pressed={starred}
                className="h-8 min-h-8 w-8 min-w-8 shrink-0"
              >
                <Star
                  size={18}
                  weight={starred ? "fill" : "regular"}
                  style={{ color: starred ? "#f5b300" : "var(--text-muted)" }}
                />
              </Button>
            )}
            {subject ? (
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {subject}
              </h2>
            ) : (
              <span />
            )}
          </div>
          {/* Boutons DIRECTS : seulement Étoile (à gauche du sujet) + TriageBar.
              Toutes les actions SECONDAIRES sont regroupées dans le menu « Plus »
              (kebab) ci-dessous — masqué en mode embed. On garde un Popover (et
              non DropdownMenu items) car 4 actions sont des composants
              self-contained à overlay propre : on les déplace tels quels. */}
          <div className="flex shrink-0 items-center justify-end gap-1.5">
            {clientId && (
              <TriageBar clientId={clientId} threadId={thread.id} onTriaged={onTriaged} />
            )}
            {!embedded && (
              <Popover isOpen={moreOpen} onOpenChange={setMoreOpen}>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Plus d'actions"
                  className="h-8 min-h-8 w-8 min-w-8 shrink-0"
                >
                  <DotsThreeVertical size={18} aria-hidden />
                </Button>
                <Popover.Content className="w-64 p-1">
                  <Popover.Dialog className="outline-none">
                    <div className="flex flex-col gap-0.5">
                      {aiConfigured && (
                        <Button
                          variant="ghost"
                          onPress={() => {
                            setMoreOpen(false);
                            onSummaryClick();
                          }}
                          isDisabled={summaryBusy}
                          className={MENU_ROW}
                          aria-label="Résumer le fil avec l'IA locale"
                        >
                          {summaryBusy ? <Spinner size="sm" /> : <Sparkle size={16} />}
                          <span>Résumer</span>
                        </Button>
                      )}
                      {aiConfigured && (
                        <div className={MENU_COMPONENT_ROW}>
                          <ExtractActionsButton thread={aiThread} />
                        </div>
                      )}
                      {clientId && aiConfigured && (
                        <Button
                          variant="ghost"
                          onPress={() => void runSuggestQuadrant()}
                          isDisabled={suggestBusy}
                          className={MENU_ROW}
                          aria-label="Suggérer un quadrant Eisenhower avec l'IA locale"
                        >
                          {suggestBusy ? <Spinner size="sm" /> : <Sparkle size={16} />}
                          <span>Suggérer quadrant</span>
                        </Button>
                      )}
                      {clientId && (
                        <div className={MENU_COMPONENT_ROW}>
                          <MailEisenhowerPicker
                            onConvert={(q) => void convertToTodo(q)}
                            isBusy={convertBusy}
                            suggestedQuadrant={suggestedQuadrant}
                          />
                        </div>
                      )}
                      {onForward && (
                        <Button
                          variant="ghost"
                          onPress={() => {
                            setMoreOpen(false);
                            onForwardClick();
                          }}
                          className={MENU_ROW}
                          aria-label="Transférer le message"
                        >
                          <ArrowBendUpRight size={16} />
                          <span>Transférer</span>
                        </Button>
                      )}
                      {clientId && (
                        <Button
                          variant="ghost"
                          onPress={() => {
                            setMoreOpen(false);
                            void onMarkUnread();
                          }}
                          className={MENU_ROW}
                          aria-label="Marquer comme non lu"
                        >
                          <Envelope size={16} />
                          <span>Non lu</span>
                        </Button>
                      )}
                      {correspondentMsg && (
                        <div className={MENU_COMPONENT_ROW}>
                          <EnrichContactFromEmail message={correspondentMsg} />
                        </div>
                      )}
                      <div className={MENU_COMPONENT_ROW}>
                        <EmailToEventButton message={firstMsg} />
                      </div>
                    </div>
                  </Popover.Dialog>
                </Popover.Content>
              </Popover>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {current.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={
                l.color
                  ? { backgroundColor: l.color.backgroundColor, color: l.color.textColor }
                  : { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
              }
            >
              <Tag size={10} />
              <span className="max-w-[12rem] truncate">{l.name}</span>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => void mutate(l.id, "remove")}
                aria-label={`Retirer le label ${l.name}`}
                /* Icône petite mais zone cliquable ≥32px (cible tactile) ; marge
                   négative pour ne pas gonfler la hauteur du badge. */
                className="-my-1.5 ml-0.5 inline-flex h-8 min-h-8 w-8 min-w-8 shrink-0 items-center justify-center p-0 hover:opacity-70"
              >
                <X size={10} />
              </Button>
            </span>
          ))}
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            onPress={openPicker}
            aria-label="Ajouter un label (touche l)"
            className="flex h-auto items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
          >
            <Plus size={10} weight="bold" /> Label
          </Button>
        </div>

      </div>

      {aiConfigured && summaryOpen && (
        <div
          className="rounded-xl border px-3 py-2.5"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              <Sparkle size={13} style={{ color: "var(--accent)" }} /> Résumé IA
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => void runSummary()}
                isDisabled={summaryBusy}
                aria-label="Régénérer le résumé"
                className="h-auto min-h-0 px-1.5 py-0.5 text-xs"
              >
                <ArrowsClockwise size={12} /> Régénérer
              </Button>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => setSummaryOpen(false)}
                aria-label="Replier le résumé"
                className="h-auto min-h-0 min-w-0 p-1"
              >
                <CaretUp size={12} />
              </Button>
            </div>
          </div>
          <div className="mt-1.5">
            {summaryBusy ? (
              <span className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                <Spinner size="sm" /> Génération du résumé…
              </span>
            ) : summary ? (
              <p
                className="whitespace-pre-wrap break-words text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                {summary}
              </p>
            ) : (
              <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                Aucun résumé pour le moment.
              </p>
            )}
          </div>
        </div>
      )}

      {thread.messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          kind={classifyBubble(m.from.email, selfEmail)}
          clientId={clientId}
        />
      ))}

      {/* Mode embed : pas de composeur inline (on ne répond pas depuis un bloc
          note) → lien direct vers le fil dans Gmail à la place. */}
      {embedded && (
        <div
          className="mt-1 flex justify-end border-t px-1 pt-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <a
            href={thread.messages[thread.messages.length - 1]?.webLink ?? firstMsg.webLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Ouvrir dans Gmail <ArrowSquareOut size={12} />
          </a>
        </div>
      )}

      {!embedded && clientId && replyParams.to && (
        <div
          className="sticky bottom-0 mt-1 border-t px-1 pb-2 pt-2"
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          {/* textarea natif justifié : composeur inline compact (envoi ⌘/Ctrl+↵). */}
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitReply("send");
              }
            }}
            rows={2}
            placeholder={`Répondre à ${replyParams.to}…`}
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--surface-0, var(--background))",
              color: "var(--text-primary)",
            }}
          />
          {/* input file natif (exception justifiée : pas d'équivalent HeroUI). */}
          <input
            ref={replyFileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void onPickReplyFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {replyAttachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {replyAttachments.map((att, i) => (
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
                  <span className="max-w-[200px] truncate">{attachmentLabel(att)}</span>
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={() => removeReplyAttachment(i)}
                    aria-label={`Retirer ${att.filename}`}
                    /* Icône petite mais zone cliquable ≥32px (cible tactile) ;
                       marge négative pour ne pas gonfler la hauteur du chip. */
                    className="-my-1.5 inline-flex h-8 min-h-8 w-8 min-w-8 shrink-0 items-center justify-center p-0"
                  >
                    <X size={11} />
                  </Button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="min-w-0 truncate">
                À : {replyToAll && hasCc ? replyAll.to : replyParams.to}
                {replyToAll && hasCc && ` · Cc : ${replyAll.cc.join(", ")}`}
              </span>
              <span className="shrink-0">⌘/Ctrl+↵ pour envoyer</span>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {aiConfigured && (
                <>
                  <Checkbox
                    isSelected={useNotes}
                    onChange={(sel) => setUseNotes(Boolean(sel))}
                    aria-label="Rédiger le brouillon à partir de mes notes (RAG)"
                  >
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Mes notes
                    </span>
                  </Checkbox>
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => void runDraft()}
                    isDisabled={draftBusy || replyBusy !== null}
                    aria-label="Générer un brouillon de réponse avec l'IA locale"
                  >
                    {draftBusy ? <Spinner size="sm" /> : <MagicWand size={14} />} Brouillon IA
                  </Button>
                </>
              )}
              {hasCc && (
                <Button
                  variant={replyToAll ? "primary" : "ghost"}
                  size="sm"
                  onPress={() => setReplyToAll((v) => !v)}
                  aria-pressed={replyToAll}
                  aria-label="Répondre à tous : inclure tous les participants du fil en copie"
                >
                  Répondre à tous
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onPress={() => replyFileRef.current?.click()}
                aria-label="Joindre des fichiers"
              >
                <Paperclip size={14} /> Joindre
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onPress={insertQuote}
                aria-label="Citer le message précédent"
              >
                <Quotes size={14} /> Citer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => void submitReply("draft")}
                isDisabled={!replyBody.trim() || replyBusy !== null}
              >
                Brouillon
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={() => void submitReply("send")}
                isDisabled={!replyBody.trim() || replyBusy !== null}
              >
                <PaperPlaneTilt size={14} /> {replyBusy === "send" ? "Envoi…" : "Envoyer"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <LabelPicker
        open={pickerOpen}
        anchorRect={anchorRect}
        labels={addable}
        onPick={(id) => void mutate(id, "add")}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

/**
 * Sélecteur de label ancré (position fixe, même esprit que TagSelector) avec
 * navigation 100 % clavier : recherche au focus, flèches ↑/↓, Entrée applique,
 * Échap ferme. Clic-extérieur ferme aussi.
 */
function LabelPicker({
  open,
  anchorRect,
  labels,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  labels: GmailLabel[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...labels].sort((a, b) => a.name.localeCompare(b.name));
    return q ? sorted.filter((l) => l.name.toLowerCase().includes(q)) : sorted;
  }, [labels, query]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open || !anchorRect) return null;

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = filtered[active];
      if (sel) {
        onPick(sel.id);
        onClose();
      }
    }
  };

  const POP_W = 240;
  const POP_H = 300;
  const margin = 6;
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POP_W - 8);
  if (top + POP_H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - POP_H - margin);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Ajouter un label"
      className="fixed z-50 flex flex-col rounded-lg shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        maxHeight: POP_H,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-1.5 border-b px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <MagnifyingGlass size={12} style={{ color: "var(--text-muted)" }} />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Filtrer les labels…"
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {labels.length === 0 ? "Tous les labels sont appliqués." : "Aucun résultat."}
          </p>
        )}
        {filtered.map((l, i) => (
          <Button
            key={l.id}
            variant="ghost"
            onPress={() => {
              onPick(l.id);
              onClose();
            }}
            className="flex h-auto w-full items-center gap-1.5 px-2 py-1 text-left text-xs"
            style={{
              backgroundColor: i === active ? "var(--surface-2)" : "transparent",
              color: "var(--text-secondary)",
            }}
          >
            <Tag size={11} style={{ color: "var(--text-muted)" }} />
            <span className="flex-1 truncate">{l.name}</span>
            {i === active && <Check size={11} style={{ color: "var(--accent)" }} />}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Teinte « interne » (collègue même domaine) : dérivée du token sémantique
// existant `--success` (oklch cool, hue ~150) via color-mix → fill subtil sans
// toucher globals.css. Tranche avec « moi » (violet `--accent-subtle`) et
// « externe » (`--surface-1`). NB : `--success` n'est pas redéfini par thème →
// teinte stable ; tokeniser un `--internal` dédié si on veut une vraie variante
// par thème plus tard.
const INTERNAL_BG = "color-mix(in oklch, var(--success) 14%, transparent)";
const INTERNAL_BORDER = "color-mix(in oklch, var(--success) 35%, transparent)";
const INTERNAL_ACCENT = "var(--success)";

/**
 * CSS scopé au conteneur de corps HTML d'e-mail (chemin `bodyHtml`). Injecté une
 * seule fois au niveau module (pas de modif globals.css — règle WIP). Borne les
 * débordements (images/tables/pré larges) pour rester dans la bulle, sans
 * réécrire le HTML de l'expéditeur. Mobile : images fluides, scroll horizontal
 * local pour les tables larges plutôt qu'un débordement de la page.
 */
const MAIL_HTML_STYLE_ID = "sn-mail-html-style";
const MAIL_HTML_CSS = `
.sn-mail-html img { max-width: 100%; height: auto; }
.sn-mail-html table { max-width: 100%; border-collapse: collapse; }
.sn-mail-html pre { white-space: pre-wrap; word-break: break-word; }
.sn-mail-html a { color: var(--accent); }
.sn-mail-html blockquote { margin: 0.5em 0; padding-left: 0.75em; border-left: 2px solid var(--border-subtle); color: var(--text-muted); }
`;
function ensureMailHtmlStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(MAIL_HTML_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = MAIL_HTML_STYLE_ID;
  el.textContent = MAIL_HTML_CSS;
  document.head.appendChild(el);
}

function MessageBubble({
  message,
  kind,
  clientId,
}: {
  message: EmailMessage;
  kind: BubbleKind;
  clientId: string;
}) {
  const mine = kind === "mine";
  const internal = kind === "internal";
  const date = message.date ? new Date(message.date).toLocaleString() : "";
  // Chemin HTML : si le mail a un corps text/html, on le rend sanitizé (DOMPurify)
  // SANS extraire citation/signature (on affiche le HTML complet, tel que conçu
  // par l'expéditeur). Mémoïsé : la sanitization touche le DOM (template parse).
  // Chemin HTML : sanitize PUIS sépare le contenu neuf de la citation (historique
  // de réponses/transfert) pour ne pas afficher de « blocs rémanents ». La
  // citation reste accessible via un bloc repliable.
  const htmlParts = useMemo(
    () => (message.bodyHtml ? splitQuotedHtml(sanitizeEmailHtml(message.bodyHtml)) : null),
    [message.bodyHtml],
  );
  // Chemin texte (fallback historique) : parse uniquement quand pas de HTML.
  const { body, quoted, signature } = useMemo(
    () => (htmlParts ? { body: "", quoted: "", signature: "" } : parseEmailBody(message.bodyText || message.snippet)),
    [htmlParts, message.bodyText, message.snippet],
  );
  // Injecte le CSS scopé du conteneur HTML à la 1ʳᵉ bulle HTML rendue.
  useEffect(() => {
    if (htmlParts) ensureMailHtmlStyle();
  }, [htmlParts]);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] rounded-2xl border px-3.5 py-2.5"
        style={{
          backgroundColor: mine ? "var(--accent-subtle)" : internal ? INTERNAL_BG : "var(--surface-1)",
          borderColor: internal ? INTERNAL_BORDER : "var(--border-subtle)",
        }}
      >
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {internal && (
              <span
                title="Collègue interne"
                aria-label="Collègue interne"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: INTERNAL_ACCENT }}
              />
            )}
            <span className="truncate">{mine ? "Moi" : message.from.name || message.from.email}</span>
          </span>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {date}
          </span>
        </div>

        {htmlParts ? (
          // Corps HTML sanitizé (DOMPurify) — conteneur isolé : largeur bornée,
          // retour à la ligne, images responsives. La citation (historique) est
          // séparée et repliée pour éviter les « blocs rémanents ».
          <>
            {htmlParts.body && (
              <div
                className="sn-mail-html max-w-full overflow-x-auto break-words text-sm"
                style={{ color: "var(--text-secondary)" }}
                // eslint-disable-next-line react/no-danger -- contenu sanitizé en amont (sanitizeEmailHtml)
                dangerouslySetInnerHTML={{ __html: htmlParts.body }}
              />
            )}
            {htmlParts.quoted && (
              <CollapsibleHtml
                openLabel="··· Afficher la citation"
                closeLabel="Masquer la citation"
                html={htmlParts.quoted}
              />
            )}
          </>
        ) : (
          <>
            {body && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {body}
              </p>
            )}
            {!body && !quoted && !signature && (
              <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                (message vide)
              </p>
            )}

            {signature && (
              <CollapsibleBlock openLabel="··· Afficher la signature" closeLabel="Masquer la signature" text={signature} />
            )}
            {quoted && (
              <CollapsibleBlock openLabel="··· Afficher la citation" closeLabel="Masquer la citation" text={quoted} />
            )}
          </>
        )}

        {message.attachments.length > 0 && clientId && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.attachments.map((att) => (
              <AttachmentChip key={att.attachmentId} attachment={att} clientId={clientId} />
            ))}
          </div>
        )}

        {message.webLink && (
          <a
            href={message.webLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Ouvrir dans Gmail <ArrowSquareOut size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Chip de pièce jointe cliquable : icône trombone + nom + taille lisible.
 * Au clic, télécharge le contenu (scope readonly) et déclenche un download
 * navigateur via Blob (jamais de rendu HTML → pas de surface XSS). Cible tactile
 * suffisante (min-h-8) pour le mobile. État « busy » pendant le téléchargement.
 */
function AttachmentChip({
  attachment,
  clientId,
}: {
  attachment: EmailAttachment;
  clientId: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadAttachment(clientId, attachment);
    } catch (e) {
      toast({
        title: "Téléchargement échoué",
        description: e instanceof Error ? e.message : String(e),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={() => void onDownload()}
      isDisabled={busy}
      aria-label={`Télécharger ${attachment.filename}${attachment.size ? ` (${formatBytes(attachment.size)})` : ""}`}
      className="flex h-auto min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      style={{
        border: "1px solid var(--border-subtle)",
        backgroundColor: "var(--surface-2, var(--surface-1))",
        color: "var(--text-secondary)",
      }}
    >
      <Paperclip size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      <span className="min-w-0 truncate">{attachment.filename}</span>
      {attachment.size > 0 && (
        <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
          {busy ? "…" : formatBytes(attachment.size)}
        </span>
      )}
    </Button>
  );
}

/**
 * Bloc repliable (citation / signature). Bouton natif inline — composant
 * présentational self-contained, même esprit que le lien Gmail.
 */
function CollapsibleBlock({
  openLabel,
  closeLabel,
  text,
}: {
  openLabel: string;
  closeLabel: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs"
        style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? closeLabel : openLabel}
      </button>
      {open && (
        <p
          className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-sm"
          style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
        >
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * Variante de `CollapsibleBlock` pour la citation du chemin HTML : rend du HTML
 * DÉJÀ sanitizé (sortie de `splitQuotedHtml(sanitizeEmailHtml(...))`).
 */
function CollapsibleHtml({
  openLabel,
  closeLabel,
  html,
}: {
  openLabel: string;
  closeLabel: string;
  html: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs"
        style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? closeLabel : openLabel}
      </button>
      {open && (
        <div
          className="sn-mail-html mt-1 max-w-full overflow-x-auto break-words border-l pl-2 text-sm"
          style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
          // eslint-disable-next-line react/no-danger -- HTML déjà sanitizé en amont
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
