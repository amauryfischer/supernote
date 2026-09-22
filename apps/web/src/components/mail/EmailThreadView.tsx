"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, forwardRef, useImperativeHandle, type ReactNode } from "react";
import { ArrowSquareOut, Plus, X, Tag, MagnifyingGlass, Check, PaperPlaneTilt, Quotes, Paperclip, Star, Envelope, ArrowBendUpRight, Sparkle, MagicWand, ArrowsClockwise, CaretUp, DotsThreeVertical, Copy, Image as ImageIcon, SpeakerSlash, UserMinus, UserPlus, WarningCircle, ShareNetwork } from "@phosphor-icons/react";
import { Button, Chip, Input, Spinner, Popover } from "@heroui/react";
import { useToast, Tooltip } from "@supernote/ui";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { useSettings } from "@/components/settings/SettingsContext";
import { ShareDialog } from "@/components/share/ShareDialog";
import { createShareResource, deleteShareResource, useShareEnabled, type OwnedShare } from "@/lib/share/shareApi";
import { emailSnapshot, getEmailShare, setEmailShare } from "@/lib/share/emailShares";
import {
  listLabels,
  resolveUserLabels,
  modifyThreadLabels,
  createLabel,
  updateLabel,
  createDraft,
  buildGmailDraftUrl,
  buildGmailThreadUrl,
  classifyBubble,
  downloadAttachment,
  formatBytes,
  type EmailThread,
  type EmailMessage,
  type EmailAddress,
  type EmailAttachment,
  type GmailLabel,
  type GmailLabelColor,
  type BubbleKind,
} from "@/lib/gmail";
import { parseEmailBody } from "@/lib/email-quote";
import { senderHue } from "@/lib/mail-avatar";
import { formatMailDateTime } from "@/lib/mail-date";
import {
  sanitizeEmailHtml,
  splitQuotedHtml,
  splitSignatureHtml,
  loadImageSenders,
  trustImageSender,
  MAIL_IMAGE_SENDERS_EVENT,
} from "@/lib/mail-html";
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
import { buildReplyParams, pickReplyAll, buildQuotedBody, replyHeaders } from "@/lib/mail-reply";
import {
  buildForwardSubject,
  buildForwardedBody,
  forwardLabel,
  forwardMarks,
  type ForwardThread,
} from "@/lib/mail-forward";
import { ComposerToolbar } from "./ComposerToolbar";
import { useDeferredSend } from "./useDeferredSend";
import { SendLaterButton } from "./SendLaterButton";
import { FollowupButton } from "./FollowupButton";
import { UnsubscribeButton } from "./UnsubscribeButton";
import { useSnippetAutocomplete, SnippetPopup } from "./SnippetAutocomplete";
import { useMailTemplates } from "./useMailTemplates";
import { firstName } from "@/lib/mail-snippets";
import { muteThread, blockSender } from "@/lib/mail-mute";
import { applyTriage } from "@/lib/mail-triage";
import type { MailMirrorApi } from "./useMailMirror";
import { markdownToHtml, hasMarkup } from "@/lib/mail-markdown";
import { withSignature } from "@/lib/mail-signature";
import { loadAutoDraft, saveAutoDraft, clearAutoDraft, threadDraftKey } from "@/lib/mail-draft-store";
import { TriageBar } from "./TriageBar";
import { EnrichContactFromEmail } from "./EnrichContactFromEmail";
import { LabelMarker, LabelStyleGrid, labelChipStyle } from "./LabelMarker";
import { EmailToEventButton } from "./EmailToEventButton";
import { MailEisenhowerPicker } from "./MailEisenhowerPicker";
import { ExtractActionsButton } from "./ExtractActionsButton";
import { type TriageAction } from "@/lib/mail-triage";
import {
  QUADRANTS,
  ensureTodoLabels,
  resolveTodoLabelIds,
  quadrantOfLabels,
  todoLabelChange,
  applyLabelChange,
  type EisenhowerQuadrant,
} from "@/lib/mail-eisenhower";
import { QuickRepliesRow } from "./QuickRepliesRow";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useKeyboardViewport } from "@/hooks/useKeyboardOpen";
import { useMailQuickRepliesChrome } from "@/components/shell/shell-chrome-context";
import {
  isAiConfigured,
  summarizeThread,
  toMailAiThread,
  suggestQuadrant,
  instantReplies,
  type MailAiThread,
} from "@/lib/mail-ai";

// ─── Styles du menu overflow (« Plus ») ──────────────────────────────────────
// Ligne de menu pour une action SIMPLE (Button direct) : pleine largeur, alignée
// à gauche, padding tactile (~36px de haut ≥ cible 32px mobile).
const MENU_ROW =
  "flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-3 py-2 text-sm";
// Conteneur qui uniformise un COMPOSANT-action self-contained (ExtractActions,
// EmailToEvent — chacun apporte son propre
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
 * (alignés à droite, accent). Chaque autre expéditeur reçoit une teinte
 * déterministe (même couleur que son avatar, d'un fil à l'autre) ; les collègues
 * du même domaine portent en plus une pastille « interne ». Absent → tout traité
 * comme externe à gauche.
 * `enableShortcuts` : active le raccourci clavier global `l` (défaut true). Mis à
 * false dans l'embed note (`GmailMessageView`) pour ne pas capturer `l` dans
 * l'éditeur.
 * `embedded` : mode embed note (défaut false). MASQUE le menu d'actions
 * secondaires (« Plus ») et DÉSACTIVE le composeur de réponse inline (remplacé
 * par un lien « Ouvrir dans Gmail »). Posé par `GmailMessageView`.
 */
/**
 * Handle impératif exposé au parent (page Mail) via `ref`.
 *
 * La page possède le clavier (cf. `useMailKeyboard`) : les raccourcis qui
 * agissent sur le FIL OUVERT (répondre, transférer, étoile, non lu, labels)
 * passent par ce handle plutôt que de dupliquer la logique côté page.
 */
export interface EmailThreadHandle {
  /** Charge un texte (ex. brouillon IA choisi) dans la zone de réponse + focus. */
  loadDraft: (text: string) => void;
  /** Place le curseur dans la zone de réponse (raccourci `r`). */
  focusReply: () => void;
  /** Active « répondre à tous » puis focus la zone de réponse (raccourci `a`). */
  replyAll: () => void;
  /** Ouvre le sélecteur de label (raccourci `l`). */
  openLabelPicker: () => void;
  /** Bascule l'étoile du fil (raccourci `t`). */
  toggleStar: () => void;
  /** Marque le fil non lu (raccourci `n`). */
  markUnread: () => void;
  /** Pré-remplit un transfert dans le composeur (raccourci `f`). */
  forward: () => void;
  /** Range le fil dans un quadrant de la matrice (raccourcis `1`–`4`). */
  fileTodo: (quadrant: EisenhowerQuadrant) => void;
}

interface EmailThreadViewProps {
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
   * Remplace l'appel Gmail direct de la barre de triage : la page le route par
   * l'outbox (et gère elle-même retrait, report et « Annuler »).
   */
  onTriage?: (action: TriageAction, until?: number) => void;
  /**
   * Chemin mirror + outbox de la page : fourni, les changements de labels
   * (lu, étoile, labels, todo) survivent au hors-ligne. Absent (bloc note),
   * appel Gmail direct.
   */
  commitMutation?: MailMirrorApi["commitMutation"];
  /**
   * Appelé après un ENVOI de réponse réussi (mode `send` uniquement, pas le
   * brouillon) — l'appelant re-fetch le fil + la liste pour afficher la réponse.
   */
  onReplied?: () => void;
  /**
   * Appelé quand les labelIds optimistes du thread changent (étoile, marqué non
   * lu) — l'appelant resynchronise la ligne correspondante dans la liste.
   */
  onLabelsChanged?: (threadId: string, labelIds: string[]) => void;
  /**
   * Appelé quand l'utilisateur clique « Transférer » — l'appelant ouvre le
   * ComposeModal pré-rempli (objet « Fwd: … » + corps cité), destinataire vide.
   * `thread` fait partir le transfert dans ce fil, pour le marquer sur l'original.
   */
  onForward?: (prefill: { to?: string; subject: string; body: string; thread?: ForwardThread }) => void;
  /** Fil rangé dans un label todo, Gmail déjà poussé : `change` sert au miroir,
   *  `todoLabels` porte les labels tout juste créés. */
  onConvertedToTodo?: (
    threadId: string,
    todoLabels: GmailLabel[],
    change: { addLabelIds: string[]; removeLabelIds: string[] },
  ) => void;
  /** Déclenche la génération des brouillons IA (gérée par le parent / la colonne). */
  onGenerateDrafts?: () => void;
  /** Génération de brouillons en cours (état du bouton 🪄). */
  draftsBusy?: boolean;
}

export const EmailThreadView = forwardRef<EmailThreadHandle, EmailThreadViewProps>(
  function EmailThreadView(
    {
      thread,
      selfEmail,
      enableShortcuts = true,
      embedded = false,
      onTriaged,
      onTriage,
      commitMutation,
      onReplied,
      onLabelsChanged,
      onForward,
      onConvertedToTodo,
      onGenerateDrafts,
      draftsBusy = false,
    },
    ref,
  ) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const { toast } = useToast();
  const { scheduleSend } = useDeferredSend();

  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  // État optimiste des labels du thread (resynchronisé à chaque thread chargé).
  const [labelIds, setLabelIds] = useState<string[]>(thread.labelIds);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Ouverture du menu overflow « Plus » (actions secondaires regroupées).
  const [moreOpen, setMoreOpen] = useState(false);
  const shareAccount = selfEmail || settings.gmail.connectedEmail;
  const [shareOpen, setShareOpen] = useState(false);
  const shareEnabled = useShareEnabled();
  const [emailShare, setEmailShareState] = useState<OwnedShare | null>(null);
  useEffect(() => {
    setEmailShareState(shareAccount ? getEmailShare(shareAccount, thread.id) : null);
  }, [shareAccount, thread.id]);
  const rememberEmailShare = (share: OwnedShare | null) => {
    setEmailShare(shareAccount, thread.id, share);
    setEmailShareState(share);
  };
  const [contactOpen, setContactOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // Éditeur de couleur d'un label appliqué : id du label ciblé + ancre du badge.
  const [colorEdit, setColorEdit] = useState<{ id: string; color: GmailLabelColor | undefined; rect: DOMRect } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Garde anti-double : un seul marquage-lu par thread ouvert.
  const readMarkedRef = useRef<string | null>(null);

  useEffect(() => {
    setLabelIds(thread.labelIds);
  }, [thread]);

  // Archivage après « ignorer » / « bloquer » : via l'outbox de la page (hors ligne,
  // « Annuler ») quand elle est là ; appel Gmail direct dans un bloc de note.
  const archiveThen = (done: () => void) => {
    if (onTriage) {
      onTriage("archive");
      done();
      return;
    }
    void applyTriage(clientId, thread.id, "archive")
      .then(() => {
        onTriaged?.("archive");
        done();
      })
      .catch(() => toast({ title: "Archivage échoué", variant: "danger" }));
  };

  const pushLabels = (change: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void> => {
    const direct = () => modifyThreadLabels(clientId, thread.id, change);
    return commitMutation
      ? commitMutation({ threadId: thread.id, kind: "modifyLabels", ...change }, direct).then(() => undefined)
      : direct();
  };

  // À l'ouverture d'un thread non lu : le marquer lu (optimiste + best-effort).
  // Une seule fois par thread.id ; si l'appel échoue, on resté en silence (le
  // thread reste « non lu » côté Gmail, resync au prochain chargement de liste).
  useEffect(() => {
    if (!clientId) return;
    if (readMarkedRef.current === thread.id) return;
    if (!thread.labelIds.includes("UNREAD")) return;
    readMarkedRef.current = thread.id;
    setLabelIds((prev) => prev.filter((id) => id !== "UNREAD"));
    pushLabels({ removeLabelIds: ["UNREAD"] }).catch(() => {
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
  // Noms déjà pris (insensible à la casse) → garde anti-doublon du picker.
  const takenNames = useMemo(
    () => new Set(allLabels.map((l) => l.name.toLowerCase())),
    [allLabels],
  );

  // ─── Réponse rapide (barre fixe en bas) ───────────────────────────────────
  const replyParams = useMemo(() => buildReplyParams(thread, selfEmail), [thread, selfEmail]);
  const forwardsById = useMemo(() => forwardMarks(thread.messages), [thread.messages]);
  // « Répondre à tous » : tous les participants du fil sauf soi (Cc inclus à l'envoi).
  const replyAll = useMemo(() => pickReplyAll(thread, selfEmail), [thread, selfEmail]);
  const [replyBody, setReplyBody] = useState("");
  const replySendFb = useActionFeedback();
  const replyDraftFb = useActionFeedback();
  const replyBusy = replySendFb.isPending || replyDraftFb.isPending;
  const copyRecipientFb = useActionFeedback();
  const [replyNotice, setReplyNotice] = useState<{ tone: "danger" | "warning"; text: string } | null>(null);
  // Mobile : le composeur reste une ligne tant qu'on n'y a pas touché — déplié
  // d'office, il mangeait un tiers de l'écran au-dessus du fil.
  const [replyOpen, setReplyOpen] = useState(false);
  // Toggle « Répondre à tous » : défaut = réponse simple. Pas de Cc à ajouter
  // (seul le destinataire principal) → l'option est sans effet, on la masque.
  const [replyToAll, setReplyToAll] = useState(false);
  const hasCc = replyAll.cc.length > 0;
  // Pièces jointes de la réponse en cours (réinitialisées au changement de fil).
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([]);
  const replyFileRef = useRef<HTMLInputElement>(null);
  // Zone de saisie : grandit avec le contenu (auto-resize, plafonné). Les
  // brouillons IA sont gérés par le parent (colonne dédiée) → `loadDraft` y
  // injecte le texte choisi.
  const replyTaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  // Mobile, clavier ouvert depuis la réponse : le composeur couvre la zone visible
  // au-dessus du clavier, jusqu'à ce qu'il se referme (pas au blur : un tap sur
  // « Envoyer » déplacerait le bouton sous le doigt avant le relâchement).
  const replyKeyboard = useKeyboardViewport(isMobile && !embedded);
  const [replyEngaged, setReplyEngaged] = useState(false);
  useEffect(() => {
    if (!replyKeyboard) setReplyEngaged(false);
  }, [replyKeyboard]);
  const replyOverlay = replyEngaged ? replyKeyboard : null;
  // ─── IA locale (Ollama) : résumé du fil + brouillon de réponse ─────────────
  // États dédiés ; resynchronisés au changement de fil (le résumé d'un fil ne
  // doit pas « fuiter » sur le suivant).
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // Quadrant Eisenhower suggéré par l'IA (best-effort) → pré-sélectionné dans le
  // MailEisenhowerPicker (ouvre le Popover sur la cellule). Réinitialisé par fil.
  const [suggestedQuadrant, setSuggestedQuadrant] = useState<EisenhowerQuadrant | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  // Réponses éclair : propositions très courtes, générées à l'ouverture du fil.
  // `dismissed` évite qu'elles reviennent après un rejet explicite.
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickDismissed, setQuickDismissed] = useState(false);
  const signature = settings.gmail.signature ?? "";
  const replyFileImageRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Réponse en cours non envoyée : on la retrouve en revenant sur le fil
    // (fermer le fil ou recharger l'onglet ne perd plus la frappe).
    const saved = loadAutoDraft(threadDraftKey(thread.id));
    setReplyBody(saved?.body ?? "");
    setReplyOpen(false);
    setReplyToAll(false);
    setReplyAttachments([]);
    setSummary(null);
    setSummaryOpen(false);
    setSuggestedQuadrant(null);
    setQuickReplies([]);
    setQuickDismissed(false);
  }, [thread]);

  // Sauvegarde automatique de la réponse en cours (débattue).
  useEffect(() => {
    const id = setTimeout(() => {
      saveAutoDraft({ key: threadDraftKey(thread.id), body: replyBody });
    }, 500);
    return () => clearTimeout(id);
  }, [thread.id, replyBody]);

  /**
   * Insère une image DANS la réponse : pièce jointe inline (Content-ID) +
   * référence `![nom](cid:…)`. Le message part en multipart/related.
   */
  const insertInlineImages = async (files: File[]): Promise<boolean> => {
    const images = files.filter((f) => isInlineImage(f.type));
    if (images.length === 0) return false;
    const added = await Promise.all(images.map((f) => imageToInlineAttachment(f)));
    setReplyAttachments((prev) => [...prev, ...added]);
    setReplyBody((prev) => {
      const refs = added.map((a) => `![${a.filename}](cid:${a.contentId})`).join("\n");
      return prev.trim() ? `${prev}\n\n${refs}\n` : `${refs}\n`;
    });
    return true;
  };

  // Auto-resize de la zone de réponse : grandit avec le contenu (saisie OU
  // brouillon IA chargé) jusqu'à un plafond, pour qu'on VOIE ce qu'on écrit sans
  // scroller un champ minuscule. `min-height` (CSS) garantit une taille de base.
  useEffect(() => {
    const ta = replyTaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (replyOverlay) return;
    ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
  }, [replyBody, replyOverlay]);

  // Gate d'affichage des features IA : visibles seulement si un modèle Ollama
  // est configuré dans les réglages. Réactif au modèle des réglages.
  const aiConfigured = useMemo(() => isAiConfigured(), [settings.ia.ollamaModel]);
  const aiThread = useMemo<MailAiThread>(
    () => toMailAiThread(thread, [selfEmail ?? "", ...settings.gmail.aliases]),
    [thread, selfEmail, settings.gmail.aliases],
  );

  // Réponses éclair : générées à l'ouverture du fil, seulement si l'IA locale
  // est configurée, qu'on n'est pas en embed, et que le DERNIER message n'est
  // pas de moi (sinon il n'y a rien à répondre). Léger décalage pour ne pas
  // concurrencer le chargement du fil lui-même.
  const lastFromMe =
    (thread.messages[thread.messages.length - 1]?.from.email ?? "").toLowerCase() ===
    (selfEmail ?? "").toLowerCase();

  const runQuickReplies = useCallback(async () => {
    setQuickBusy(true);
    try {
      const list = await instantReplies(aiThread);
      setQuickReplies(list);
    } catch {
      // Ollama injoignable : on masque simplement la rangée, sans toast — elle
      // n'a pas été demandée explicitement.
      setQuickReplies([]);
    } finally {
      setQuickBusy(false);
    }
  }, [aiThread]);

  useEffect(() => {
    if (embedded || !aiConfigured || !clientId) return undefined;
    if (quickDismissed || lastFromMe) return undefined;
    if (!thread.messages.length) return undefined;
    const id = setTimeout(() => void runQuickReplies(), 400);
    return () => clearTimeout(id);
    // Une seule génération par fil : `runQuickReplies` dépend d'`aiThread`, lui
    // -même dérivé du fil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, embedded, aiConfigured, clientId, quickDismissed, lastFromMe]);

  const composerCompact =
    isMobile && !replyOpen && !replyBody.trim() && replyAttachments.length === 0;
  const quickRepliesShown =
    !embedded && !!clientId && !!replyParams.to && aiConfigured && (quickBusy || quickReplies.length > 0);
  const quickRepliesConfig = {
    items: quickReplies,
    busy: quickBusy,
    onPick: (text: string) => {
      setReplyBody((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
      requestAnimationFrame(() => replyTaRef.current?.focus());
      setQuickReplies([]);
    },
    onDismiss: () => {
      setQuickReplies([]);
      setQuickDismissed(true);
    },
  };
  // Sur mobile le panneau droit n'existe pas : la rangée reste sous le fil.
  useMailQuickRepliesChrome(quickRepliesShown && !isMobile ? quickRepliesConfig : null);

  const runSummary = async () => {
    if (summaryBusy) return;
    setSummaryOpen(true);
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const text = await summarizeThread(aiThread);
      setSummary(text);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Ollama injoignable");
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
          setReplyNotice({
            tone: "warning",
            text: `Pièces jointes : ${formatBytes(totalAttachmentsSize(next))} au total, au-delà de ${formatBytes(MAX_ATTACHMENTS_BYTES)} l'envoi Gmail risque d'échouer.`,
          });
        }
        return next;
      });
    } catch (e) {
      setReplyNotice({
        tone: "danger",
        text: `Lecture du fichier échouée : ${e instanceof Error ? e.message : String(e)}`,
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

  // ── Modèles à la frappe (`;raccourci`) ─────────────────────────────────────
  // Le correspondant et l'objet alimentent les variables du modèle ; on ne
  // calcule rien de plus que ce que le composeur a déjà sous la main.
  const { templates: snippetTemplates } = useMailTemplates();
  const snippetContext = useMemo(() => {
    const target =
      [...thread.messages]
        .reverse()
        .find((m) => m.from.email.toLowerCase() !== (selfEmail ?? "").toLowerCase()) ??
      thread.messages[0];
    return {
      prenom: firstName(target?.from.name, target?.from.email),
      nom: target?.from.name || target?.from.email || "",
      email: target?.from.email || "",
      objet: thread.messages[0]?.subject ?? "",
      moi: (settings.gmail.signature ?? "").split("\n")[0]?.trim() ?? "",
    };
  }, [thread, selfEmail, settings.gmail.signature]);

  const snippets = useSnippetAutocomplete({
    templates: snippetTemplates,
    value: replyBody,
    onChange: setReplyBody,
    textareaRef: replyTaRef,
    context: snippetContext,
  });

  const submitReply = async (mode: "send" | "draft", sendAt?: number) => {
    const typed = replyBody.trim();
    if (!typed || !clientId) return;
    const cc = replyToAll && hasCc ? replyAll.cc : undefined;
    const attachments = replyAttachments.length ? toOutgoing(replyAttachments) : undefined;
    // Signature ajoutée si elle manque ; part HTML seulement s'il y a de la mise
    // en forme ou une image inline (sinon le message reste en texte pur).
    const body = withSignature(typed, signature);
    const inline = replyAttachments.some((a) => a.contentId);
    const html = hasMarkup(body) || inline ? markdownToHtml(body) : undefined;
    setReplyNotice(null);
    const fail = (message: string) =>
      setReplyNotice({
        tone: "danger",
        text: `${mode === "send" ? "Échec de l'envoi" : "Échec du brouillon"} : ${message}`,
      });
    if (mode === "send") {
      // File d'envoi différé : « Annuler l'envoi » pendant la fenêtre configurée,
      // puis départ réel (cf. MailOutgoingRunner).
      const result = await replySendFb.run(
        () =>
          scheduleSend(
            {
              kind: "reply",
              threadId: replyParams.threadId,
              to: replyParams.to ? [replyParams.to] : [],
              ...(cc?.length ? { cc } : {}),
              subject: replyParams.subject,
              body,
              ...(html ? { html } : {}),
              ...(replyParams.inReplyTo ? { inReplyTo: replyParams.inReplyTo } : {}),
              ...(replyParams.references ? { references: replyParams.references } : {}),
              ...(attachments?.length ? { attachments } : {}),
            },
            sendAt !== undefined ? { sendAt, label: "Réponse envoyée" } : { label: "Réponse envoyée" },
          ),
        fail,
      );
      if (!result) return;
      clearAutoDraft(threadDraftKey(thread.id));
      setReplyBody("");
      setReplyAttachments([]);
      // Re-fetch fil + liste côté appelant pour faire apparaître la réponse.
      onReplied?.();
      return;
    }
    const draft = await replyDraftFb.run(
      () =>
        createDraft(clientId, {
          ...replyParams,
          cc,
          body,
          ...(html ? { html } : {}),
          attachments,
        }),
      fail,
    );
    if (!draft) return;
    clearAutoDraft(threadDraftKey(thread.id));
    window.open(buildGmailDraftUrl(draft.draftId), "_blank", "noopener");
    setReplyBody("");
    setReplyAttachments([]);
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
      thread: { threadId: thread.id, ...replyHeaders(thread) },
    });
  };

  const [convertBusy, setConvertBusy] = useState(false);
  const convertToTodo = async (quadrant: EisenhowerQuadrant) => {
    if (!clientId || convertBusy) return;
    setConvertBusy(true);
    const prev = labelIds;
    try {
      const labels = await ensureTodoLabels(
        clientId,
        allLabels.map((l) => [l.id, l.name] as const),
      );
      const todoLabels = Object.values(labels);
      const fresh = todoLabels.filter((l) => !allLabels.some((a) => a.id === l.id));
      if (fresh.length) setAllLabels((ls) => [...ls, ...fresh]);
      const change = todoLabelChange(labels, quadrant);
      const nextIds = applyLabelChange(labelIds, change);
      setLabelIds(nextIds);
      onLabelsChanged?.(thread.id, nextIds);
      await pushLabels(change);
      onConvertedToTodo?.(thread.id, todoLabels, change);
    } catch (err) {
      setLabelIds(prev);
      onLabelsChanged?.(thread.id, prev);
      toast({
        title: "Rangement dans la matrice échoué",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setConvertBusy(false);
    }
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
    const nextIds =
      action === "add" ? [...labelIds, labelId] : labelIds.filter((id) => id !== labelId);
    setLabelIds(nextIds);
    // Propage la maj optimiste à la liste/groupe (comme étoile + non-lu) → la
    // ligne reflète le label sans rechargement.
    onLabelsChanged?.(thread.id, nextIds);
    try {
      await pushLabels(action === "add" ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] });
    } catch (err) {
      console.error(err);
      setLabelIds(prev);
      onLabelsChanged?.(thread.id, prev);
    }
  };

  // Crée un label Gmail puis l'applique au thread. Si un label du même nom
  // existe déjà (insensible à la casse), on l'applique au lieu d'en créer un
  // doublon (Gmail renverrait 409). Le label créé est injecté dans `allLabels`
  // pour que le badge s'affiche immédiatement.
  const createAndApply = async (rawName: string) => {
    if (!clientId) return;
    const name = rawName.trim();
    if (!name) return;
    const existing = allLabels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      await mutate(existing.id, "add");
      return;
    }
    try {
      const created = await createLabel(clientId, name);
      setAllLabels((prev) => [...prev, created]);
      await mutate(created.id, "add");
    } catch (err) {
      toast({
        title: "Création du label échouée",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  // Change la couleur d'un label appliqué : maj optimiste de `allLabels` (le
  // badge se re-teinte aussitôt via `resolveUserLabels`) + PATCH Gmail, rollback
  // sur échec.
  const setLabelColor = async (labelId: string, color: GmailLabelColor) => {
    if (!clientId) return;
    const prev = allLabels;
    setAllLabels((ls) => ls.map((l) => (l.id === labelId ? { ...l, color } : l)));
    try {
      await updateLabel(clientId, labelId, { color });
    } catch (err) {
      console.error(err);
      setAllLabels(prev);
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
      await pushLabels(next ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] });
    } catch (err) {
      console.error(err);
      setLabelIds(prev);
      onLabelsChanged?.(thread.id, prev);
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
      await pushLabels({ addLabelIds: ["UNREAD"] });
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

  // Handle impératif : la page (clavier) pilote le fil ouvert. Déclaré APRÈS les
  // callbacks qu'il expose (closures à jour), et AVANT le garde « fil vide » —
  // un hook ne doit jamais se trouver après un `return` conditionnel.
  useImperativeHandle(
    ref,
    () => ({
      loadDraft: (text: string) => {
        setReplyBody((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
        requestAnimationFrame(() => replyTaRef.current?.focus());
      },
      focusReply: () => {
        requestAnimationFrame(() => replyTaRef.current?.focus());
      },
      replyAll: () => {
        setReplyToAll(true);
        requestAnimationFrame(() => replyTaRef.current?.focus());
      },
      openLabelPicker: openPicker,
      toggleStar: () => void onToggleStar(),
      markUnread: () => void onMarkUnread(),
      forward: onForwardClick,
      fileTodo: (quadrant) => void convertToTodo(quadrant),
    }),
    // `openPicker` / `onForwardClick` / `onToggleStar` / `onMarkUnread` sont
    // recréés à chaque rendu : on ré-expose le handle à chaque rendu plutôt que
    // de figer des closures périmées (labelIds obsolètes → étoile qui « saute »).
  );

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

  // Adresse du correspondant (celle vers laquelle on répond = l'externe X, cf.
  // pickReplyTo) → affichée + copiable dans l'en-tête.
  const recipientEmail = replyParams.to || correspondentMsg?.from.email || "";
  const lastRecipients = recipientsLine(thread.messages[thread.messages.length - 1], selfEmail);
  const copyRecipient = () => {
    if (recipientEmail) void copyRecipientFb.run(() => navigator.clipboard.writeText(recipientEmail));
  };

  return (
    // En pane (non-embed) : on remplit la hauteur du conteneur scrollable pour
    // que le composeur de réponse (spacer `flex-1` + sticky ci-dessous) soit
    // poussé EN BAS du panneau même quand le fil est court. En embed (bloc note)
    // : hauteur naturelle, pas de composeur.
    <div className={`flex flex-col gap-3${embedded ? "" : " min-h-full"}`}>
      {/* En-tête (sujet + actions + labels) ÉPINGLÉ en haut du panneau dès md.
          Sur téléphone, l'en-tête entier mangerait un tiers de l'écran : il se
          dissout (`contents`) et seule la rangée d'actions reste épinglée.
          `-mx-4 px-4` = déborde le padding du conteneur scroll pour couvrir
          toute la largeur ; fond opaque + bordure bas pour que les messages
          passent DERRIÈRE. Pas en embed. */}
      <div
        className={`flex flex-col gap-2${
          embedded ? "" : " -mx-4 border-b px-4 pb-2 pt-1 max-md:contents md:sticky md:top-0 md:z-10"
        }`}
        style={
          embedded
            ? undefined
            : { background: "var(--surface-0, var(--background))", borderColor: "var(--border-subtle)" }
        }
      >
        {/* Sous md, le sujet prend toute la largeur (2 lignes) et les actions
            passent dessous : côte à côte, il ne restait que quelques lettres. */}
        <div
          className={`flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-3${
            embedded ? "" : " max-md:contents"
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5 md:flex-1">
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
              <h2 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold md:truncate" style={{ color: "var(--text-primary)" }}>
                {subject}
              </h2>
            ) : (
              <span />
            )}
          </div>
          {/* Boutons DIRECTS : Étoile (à gauche du sujet), Todo, TriageBar, Gmail.
              Toutes les actions SECONDAIRES sont regroupées dans le menu « Plus »
              (kebab) ci-dessous — masqué en mode embed. On garde un Popover (et
              non DropdownMenu items) car 4 actions sont des composants
              self-contained à overlay propre : on les déplace tels quels. */}
          <div
            className={`flex shrink-0 items-center justify-end gap-1.5${
              embedded ? "" : " max-md:sticky max-md:top-0 max-md:z-10 max-md:-mx-4 max-md:border-b max-md:px-4 max-md:py-1"
            }`}
            style={
              embedded
                ? undefined
                : { background: "var(--surface-0, var(--background))", borderColor: "var(--border-subtle)" }
            }
          >
            {clientId && (
              <MailEisenhowerPicker
                onConvert={(q) => void convertToTodo(q)}
                isBusy={convertBusy}
                suggestedQuadrant={suggestedQuadrant}
                currentQuadrant={quadrantOfLabels(
                  labelIds,
                  resolveTodoLabelIds(allLabels.map((l) => [l.id, l.name] as const)),
                )}
              />
            )}
            {clientId && (
              <TriageBar clientId={clientId} threadId={thread.id} onTriaged={onTriaged} onTriage={onTriage} />
            )}
            {!embedded && (
              <Tooltip content="Ouvrir dans Gmail">
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  onPress={() => window.open(buildGmailThreadUrl(thread.id), "_blank", "noopener")}
                  aria-label="Ouvrir le fil dans Gmail"
                  className="h-9"
                >
                  <ArrowSquareOut size={18} aria-hidden />
                </Button>
              </Tooltip>
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
                          onPress={() => {
                            // La suggestion ouvre le bouton Todo de la barre directe.
                            setMoreOpen(false);
                            void runSuggestQuadrant();
                          }}
                          isDisabled={suggestBusy}
                          className={MENU_ROW}
                          aria-label="Suggérer un quadrant Eisenhower avec l'IA locale"
                        >
                          {suggestBusy ? <Spinner size="sm" /> : <Sparkle size={16} />}
                          <span>Suggérer quadrant</span>
                        </Button>
                      )}
                      {clientId && correspondentMsg && (
                        <div className={MENU_COMPONENT_ROW}>
                          <UnsubscribeButton
                            message={correspondentMsg}
                            clientId={clientId}
                            className={MENU_ROW}
                            {...(onForward ? { onCompose: onForward } : {})}
                            onBlockAndArchive={() => {
                              blockSender(correspondentMsg.from.email);
                              archiveThen(() => undefined);
                            }}
                          />
                        </div>
                      )}
                      {clientId && (
                        <Button
                          variant="ghost"
                          className={MENU_ROW}
                          aria-label="Ignorer ce fil"
                          onPress={() => {
                            setMoreOpen(false);
                            muteThread(thread.id);
                            archiveThen(() => undefined);
                          }}
                        >
                          <SpeakerSlash size={16} />
                          <span>Ignorer ce fil</span>
                        </Button>
                      )}
                      {clientId && correspondentMsg && (
                        <Button
                          variant="ghost"
                          className={MENU_ROW}
                          aria-label="Bloquer cet expéditeur"
                          onPress={() => {
                            setMoreOpen(false);
                            blockSender(correspondentMsg.from.email);
                            archiveThen(() => undefined);
                          }}
                        >
                          <UserMinus size={16} />
                          <span>Bloquer l'expéditeur</span>
                        </Button>
                      )}
                      {clientId && (
                        <div className={MENU_COMPONENT_ROW}>
                          <FollowupButton
                            threadId={thread.id}
                            subject={thread.messages[0]?.subject ?? ""}
                            messageCount={thread.messages.length}
                            defaultDays={settings.gmail.followupDays ?? 3}
                            className={MENU_ROW}
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
                      {shareEnabled && shareAccount && (
                        <Button
                          variant="ghost"
                          className={MENU_ROW}
                          aria-label="Partager par lien"
                          onPress={() => {
                            setMoreOpen(false);
                            setShareOpen(true);
                          }}
                        >
                          <ShareNetwork size={16} />
                          <span>Partager par lien</span>
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
                      {correspondentMsg?.from.email && (
                        <Button
                          variant="ghost"
                          className={MENU_ROW}
                          aria-label="Créer ou compléter le contact"
                          onPress={() => {
                            // La modale vit hors du menu : ouverte dedans, le popover resterait par-dessus.
                            setMoreOpen(false);
                            setContactOpen(true);
                          }}
                        >
                          <UserPlus size={16} />
                          <span>Créer / compléter le contact</span>
                        </Button>
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
        {/* Adresse du correspondant + copie rapide (QoL : récupérer l'email sans
            ouvrir le composeur). Masqué en embed / si pas d'adresse. */}
        {!embedded && recipientEmail && (
          <div className="flex min-w-0 items-center gap-1 pl-0.5">
            <span className="max-w-[45%] shrink-0 truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {recipientEmail}
            </span>
            <Tooltip content={copyRecipientFb.state === "success" ? "Copiée" : (copyRecipientFb.error ?? "Copier l'adresse")}>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label="Copier l'adresse"
                className="sn-hit h-6 min-h-6 w-6 min-w-6 shrink-0"
                onPress={copyRecipient}
              >
                <FeedbackIcon state={copyRecipientFb.state} error={copyRecipientFb.error} size={12} idle={<Copy size={12} />} />
              </Button>
            </Tooltip>
            {correspondentMsg && (
              <EnrichContactFromEmail message={correspondentMsg} open={contactOpen} onOpenChange={setContactOpen} />
            )}
            {lastRecipients.text && (
              <span
                className="min-w-0 truncate text-xs"
                style={{ color: "var(--text-muted)" }}
                title={lastRecipients.title}
              >
                {lastRecipients.text}
              </span>
            )}
          </div>
        )}
        {!embedded && (
          <ShareDialog
            isOpen={shareOpen}
            onClose={() => setShareOpen(false)}
            kind="email"
            title={subject ?? ""}
            owned={emailShare}
            onStart={async () => {
              const share = await createShareResource("email", subject ?? "", emailSnapshot(thread));
              rememberEmailShare(share);
              return share;
            }}
            onStop={async () => {
              if (emailShare) await deleteShareResource(emailShare);
              rememberEmailShare(null);
              setShareOpen(false);
            }}
            onGone={() => rememberEmailShare(null)}
            note="Le fil est publié tel qu'il est maintenant, sans pièces jointes. Les réponses suivantes n'y apparaîtront pas."
          />
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {current.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={labelChipStyle(l.color)}
            >
              <LabelMarker color={l.color} size={10} />
              {/* Clic sur le nom → menu couleur + style (enregistrés dans la couleur Gmail). */}
              <Button
                variant="ghost"
                size="sm"
                onPress={(e) =>
                  setColorEdit({
                    id: l.id,
                    color: l.color,
                    rect: (e.target as HTMLElement).getBoundingClientRect(),
                  })
                }
                aria-label={`Changer la couleur et le style du label ${l.name}`}
                className="-my-1.5 inline-flex h-8 min-h-8 max-w-[12rem] items-center bg-transparent p-0 font-medium hover:opacity-70"
                style={{ color: "inherit" }}
              >
                <span className="truncate">{l.name}</span>
              </Button>
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
          <Tooltip content="Ajouter un label (l)">
            <Button
              ref={triggerRef}
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={openPicker}
              aria-label="Ajouter un label (touche l)"
              className="flex h-7 min-h-7 w-7 min-w-7 items-center justify-center rounded-full p-0"
              style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
            >
              <Plus size={12} weight="bold" />
            </Button>
          </Tooltip>
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
            ) : summaryError ? (
              <p role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
                Résumé impossible : {summaryError}
              </p>
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
          forwardNotes={forwardsById.get(m.id)?.map((f) => forwardLabel(f, selfEmail))}
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

      {/* Pousse le composeur en bas du panneau quand le fil est court (absorbe
          l'espace restant) ; à 0 sur un fil long, où `sticky` prend le relais. */}
      {!embedded && clientId && replyParams.to && (
        <div className="min-h-0 flex-1" aria-hidden />
      )}

      {!embedded && clientId && replyParams.to && (
        <div
          className={
            replyOverlay
              ? "fixed inset-x-0 z-[var(--z-sticky)] flex flex-col border-t px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]"
              : "sticky bottom-0 mt-1 border-t px-1 pb-2 pt-2"
          }
          style={{ background: "var(--surface-1)", borderColor: "var(--border-subtle)", ...replyOverlay }}
        >
          {quickRepliesShown && composerCompact && (
            <QuickRepliesRow {...quickRepliesConfig} className="mb-1.5" />
          )}
          {!composerCompact && <ComposerToolbar
            textareaRef={replyTaRef}
            value={replyBody}
            onChange={setReplyBody}
            trailing={
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                aria-label="Insérer une image dans la réponse"
                className="h-8 min-h-8 w-8 min-w-8"
                onPress={() => replyFileImageRef.current?.click()}
              >
                <ImageIcon size={15} aria-hidden />
              </Button>
            }
          />}
          {/* textarea natif justifié : composeur inline (envoi ⌘/Ctrl+↵).
              Auto-resize (cf. effet) → grandit avec le contenu, `min-height` =
              base confortable (~3 lignes) pour qu'on voie ce qu'on écrit. */}
          <div className={replyOverlay ? "relative flex min-h-0 flex-1 flex-col" : "relative"}>
            {snippets.open && (
              <SnippetPopup
                matches={snippets.matches}
                index={snippets.index}
                onPick={snippets.accept}
                placement={replyOverlay ? "bottom-2 left-2" : undefined}
              />
            )}
          <textarea
            ref={replyTaRef}
            value={replyBody}
            onChange={(e) => {
              setReplyBody(e.target.value);
            }}
            onKeyDown={(e) => {
              // La complétion de modèles passe en premier : quand la liste est
              // ouverte, ↵ insère au lieu d'envoyer.
              if (snippets.handleKeyDown(e)) return;
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitReply("send");
              }
            }}
            onKeyUp={snippets.refresh}
            onClick={snippets.refresh}
            onFocus={() => {
              setReplyOpen(true);
              setReplyEngaged(true);
            }}
            onPointerDown={() => setReplyEngaged(true)}
            onBlur={snippets.close}
            onPaste={(e) => {
              // Coller une capture d'écran l'insère DANS la réponse.
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length === 0) return;
              e.preventDefault();
              void insertInlineImages(files).then((handled) => {
                if (!handled) void onPickReplyFiles(e.clipboardData?.files ?? null);
              });
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
                  setReplyAttachments((prev) => [...prev, ...added]),
                );
              }
            }}
            placeholder={`Répondre à ${replyParams.to}…`}
            className={`w-full resize-none overflow-y-auto rounded-lg border px-3 py-2 text-sm outline-none${replyOverlay ? " flex-1" : ""}`}
            style={{
              minHeight: composerCompact ? "2.5rem" : "4.75rem",
              maxHeight: replyOverlay ? undefined : "260px",
              borderColor: "var(--border-subtle)",
              background: "var(--surface-0, var(--background))",
              color: "var(--text-primary)",
            }}
          />
          </div>
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
          <input
            ref={replyFileImageRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void insertInlineImages(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          {replyNotice && (
            <div
              role="alert"
              className="mt-1.5 flex items-center gap-2 rounded-md py-1 pl-3 pr-1 text-xs"
              style={{
                background: `var(--color-${replyNotice.tone}-50)`,
                color: `var(--color-${replyNotice.tone}-700)`,
              }}
            >
              <WarningCircle size={13} weight="bold" aria-hidden />
              <span className="min-w-0 flex-1">{replyNotice.text}</span>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="Masquer le message"
                className="sn-hit h-6 min-h-6 w-6 min-w-6"
                onPress={() => setReplyNotice(null)}
              >
                <X size={11} />
              </Button>
            </div>
          )}
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
          {!composerCompact && <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="min-w-0 truncate">
                À : {replyToAll && hasCc ? replyAll.to : replyParams.to}
                {replyToAll && hasCc && ` · Cc : ${replyAll.cc.join(", ")}`}
              </span>
              <span className="hidden shrink-0 md:inline">⌘/Ctrl+↵ pour envoyer</span>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:shrink-0">
              {aiConfigured && (
                <Tooltip content="Proposer plusieurs brouillons (IA locale)">
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    onPress={() => onGenerateDrafts?.()}
                    isDisabled={draftsBusy || replyBusy}
                    aria-label="Proposer plusieurs brouillons de réponse avec l'IA locale"
                  >
                    {draftsBusy ? <Spinner size="sm" /> : <MagicWand size={14} />}
                  </Button>
                </Tooltip>
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
              <Tooltip content="Joindre des fichiers">
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  onPress={() => replyFileRef.current?.click()}
                  aria-label="Joindre des fichiers"
                >
                  <Paperclip size={14} />
                </Button>
              </Tooltip>
              <Tooltip content="Citer le message précédent">
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  onPress={insertQuote}
                  aria-label="Citer le message précédent"
                >
                  <Quotes size={14} />
                </Button>
              </Tooltip>
              <SendLaterButton
                iconOnly
                isDisabled={!replyBody.trim() || replyBusy}
                onPick={(sendAt) => void submitReply("send", sendAt)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5"
                onPress={() => void submitReply("draft")}
                isDisabled={(!replyBody.trim() && replyDraftFb.state === "idle") || replyBusy}
              >
                {replyDraftFb.state !== "idle" && (
                  <FeedbackIcon state={replyDraftFb.state} error={replyDraftFb.error} size={14} idle={null} />
                )}
                Brouillon
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="flex items-center gap-1.5"
                onPress={() => void submitReply("send")}
                isDisabled={(!replyBody.trim() && replySendFb.state === "idle") || replyBusy}
              >
                <FeedbackIcon state={replySendFb.state} error={replySendFb.error} size={14} idle={<PaperPlaneTilt size={14} />} />
                Envoyer
              </Button>
            </div>
          </div>}
        </div>
      )}

      <LabelPicker
        open={pickerOpen}
        anchorRect={anchorRect}
        labels={addable}
        takenNames={takenNames}
        onPick={(id) => void mutate(id, "add")}
        onCreate={(name) => void createAndApply(name)}
        onClose={() => setPickerOpen(false)}
      />

      <ColorMenu
        open={colorEdit !== null}
        anchorRect={colorEdit?.rect ?? null}
        current={colorEdit?.color}
        onPick={(color) => {
          if (colorEdit) void setLabelColor(colorEdit.id, color);
        }}
        onClose={() => setColorEdit(null)}
      />
    </div>
  );
  },
);

/**
 * Sélecteur de label ancré (position fixe, même esprit que TagSelector) avec
 * navigation 100 % clavier : recherche au focus, flèches ↑/↓, Entrée applique,
 * Échap ferme. Clic-extérieur ferme aussi.
 */
function LabelPicker({
  open,
  anchorRect,
  labels,
  takenNames,
  onPick,
  onCreate,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  labels: GmailLabel[];
  /** Noms (minuscules) de TOUS les labels utilisateur → garde anti-doublon. */
  takenNames: Set<string>;
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
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

  // Le nom tapé n'existe nulle part (ni appliqué, ni applicable) → on propose la
  // création. Insensible à la casse.
  const trimmed = query.trim();
  const canCreate = trimmed !== "" && !takenNames.has(trimmed.toLowerCase());

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
      } else if (canCreate) {
        onCreate(trimmed);
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
        {filtered.length === 0 && !canCreate && (
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
        {/* Création d'un nouveau label Gmail si le nom tapé n'existe pas. */}
        {canCreate && (
          <Button
            variant="ghost"
            onPress={() => {
              onCreate(trimmed);
              onClose();
            }}
            className="flex h-auto w-full items-center gap-1.5 px-2 py-1 text-left text-xs"
            style={{ color: "var(--accent)" }}
          >
            <Plus size={11} weight="bold" />
            <span className="flex-1 truncate">
              Créer «&nbsp;{trimmed}&nbsp;»
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Sélecteur couleur × style d'un label : une ligne par style, une colonne par teinte.
 * Même mécanique d'ancrage/fermeture que `LabelPicker` (position fixe clampée,
 * clic-extérieur + Échap ferment).
 */
function ColorMenu({
  open,
  anchorRect,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: DOMRect | null;
  current: GmailLabelColor | undefined;
  onPick: (color: GmailLabelColor) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);

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

  if (!open || !anchorRect) return null;

  const POP_W = 336;
  const POP_H = 156;
  const margin = 6;
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - POP_W - 8);
  if (top + POP_H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - POP_H - margin);

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Couleur du label"
      className="fixed z-50 rounded-lg p-2 shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <LabelStyleGrid
        current={current}
        onPick={(color) => {
          onPick(color);
          onClose();
        }}
      />
    </div>
  );
}

// Alpha plutôt que luminosité fixe : la même teinte reste lisible en clair et en sombre.
function senderTint(key: string): { bg: string; border: string } {
  const h = senderHue(key);
  return { bg: `hsl(${h} 70% 50% / 0.14)`, border: `hsl(${h} 70% 50% / 0.35)` };
}

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

/** « à X, Y · cc Z » (moi = compte connecté) + adresses complètes pour l'infobulle. */
function recipientsLine(message: EmailMessage | undefined, selfEmail?: string): { text: string; title: string } {
  if (!message) return { text: "", title: "" };
  const self = (selfEmail ?? "").toLowerCase();
  const who = (a: EmailAddress) => (a.email.toLowerCase() === self ? "moi" : a.name || a.email);
  const cc = message.cc ?? [];
  const parts = (to: string, ccLabel: string, fmt: (a: EmailAddress) => string, sep: string) =>
    [
      message.to.length ? `${to}${message.to.map(fmt).join(", ")}` : "",
      cc.length ? `${ccLabel}${cc.map(fmt).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(sep);
  return { text: parts("à ", "cc ", who, " · "), title: parts("À : ", "Cc : ", (a) => a.email, "\n") };
}

function subscribeImageSenders(onChange: () => void): () => void {
  window.addEventListener(MAIL_IMAGE_SENDERS_EVENT, onChange);
  return () => window.removeEventListener(MAIL_IMAGE_SENDERS_EVENT, onChange);
}

function MessageBubble({
  message,
  kind,
  clientId,
  forwardNotes,
}: {
  message: EmailMessage;
  kind: BubbleKind;
  clientId: string;
  forwardNotes?: Array<{ label: string; title: string }> | undefined;
}) {
  const mine = kind === "mine";
  const internal = kind === "internal";
  const tint = mine ? null : senderTint(message.from.email || message.from.name);
  const files = message.attachments.filter((a) => !a.inline);
  const inlineImages = message.attachments.filter((a) => a.inline);
  const date = formatMailDateTime(message.date ?? "");
  const senderEmail = message.from.email.trim().toLowerCase();
  const senderTrusted = useSyncExternalStore(
    subscribeImageSenders,
    () => loadImageSenders().has(senderEmail),
    () => false,
  );
  const [showImagesOnce, setShowImagesOnce] = useState(false);
  const allowRemoteImages = senderTrusted || showImagesOnce;
  // Chemin HTML : sanitize PUIS sépare contenu neuf, signature et citation, ces deux
  // dernières repliées. Mémoïsé : la sanitization touche le DOM (template parse).
  const htmlParts = useMemo(() => {
    if (!message.bodyHtml) return null;
    const { html, blockedImages } = sanitizeEmailHtml(message.bodyHtml, { allowRemoteImages });
    const { body, quoted } = splitQuotedHtml(html);
    return { ...splitSignatureHtml(body), quoted, blockedImages };
  }, [message.bodyHtml, allowRemoteImages]);
  // Chemin texte (fallback historique) : parse uniquement quand pas de HTML.
  const { body, quoted, signature } = useMemo(
    () => (htmlParts ? { body: "", quoted: "", signature: "" } : parseEmailBody(message.bodyText || message.snippet)),
    [htmlParts, message.bodyText, message.snippet],
  );
  // Injecte le CSS scopé du conteneur HTML à la 1ʳᵉ bulle HTML rendue.
  useEffect(() => {
    if (htmlParts) ensureMailHtmlStyle();
  }, [htmlParts]);
  const copyFb = useActionFeedback();
  // Copie le contenu neuf (sans citation ni signature) ; en HTML, garde la mise en forme au collage.
  const copyMessage = () =>
    void copyFb.run(async () => {
      if (!htmlParts?.body) {
        await navigator.clipboard.writeText(body);
        return;
      }
      const plain = message.bodyText
        ? parseEmailBody(message.bodyText).body
        : (new DOMParser().parseFromString(htmlParts.body, "text/html").body.textContent ?? "");
      if (typeof ClipboardItem === "undefined") {
        await navigator.clipboard.writeText(plain);
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([htmlParts.body], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    });
  const canCopy = Boolean(htmlParts?.body || body);
  return (
    <div className="flex">
      <div
        className="w-full min-w-0 rounded-2xl border px-3.5 py-2.5"
        style={{
          backgroundColor: tint ? tint.bg : "var(--accent-subtle)",
          borderColor: tint ? tint.border : "var(--border-subtle)",
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
                style={{ backgroundColor: "var(--success)" }}
              />
            )}
            <span className="truncate">{mine ? "Moi" : message.from.name || message.from.email}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {date}
            {canCopy && (
              <Tooltip content={copyFb.state === "success" ? "Copié" : (copyFb.error ?? "Copier le message")}>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Copier le message"
                  className="sn-hit -my-1 -mr-1.5 h-6 min-h-6 w-6 min-w-6"
                  onPress={copyMessage}
                >
                  <FeedbackIcon state={copyFb.state} error={copyFb.error} size={13} idle={<Copy size={13} />} />
                </Button>
              </Tooltip>
            )}
          </span>
        </div>

        {htmlParts ? (
          // Corps HTML sanitizé (DOMPurify) — conteneur isolé : largeur bornée,
          // retour à la ligne, images responsives. La citation (historique) est
          // séparée et repliée pour éviter les « blocs rémanents ».
          <>
            {htmlParts.blockedImages > 0 && (
              <div
                className="mb-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <ImageIcon size={14} aria-hidden className="shrink-0" />
                <span className="mr-1">Images masquées (suivi d&apos;ouverture)</span>
                <Button size="sm" variant="ghost" onPress={() => setShowImagesOnce(true)}>
                  Afficher
                </Button>
                {senderEmail && (
                  <Button size="sm" variant="ghost" onPress={() => trustImageSender(senderEmail)}>
                    Toujours pour cet expéditeur
                  </Button>
                )}
              </div>
            )}
            {htmlParts.body && (
              <div
                className="sn-mail-html max-w-full overflow-x-auto break-words text-sm"
                style={{ color: "var(--text-secondary)" }}
                // eslint-disable-next-line react/no-danger -- contenu sanitizé en amont (sanitizeEmailHtml)
                dangerouslySetInnerHTML={{ __html: htmlParts.body }}
              />
            )}
            {htmlParts.signature && (
              <CollapsibleHtml
                openLabel="··· Afficher la signature"
                closeLabel="Masquer la signature"
                html={htmlParts.signature}
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

        {files.length > 0 && clientId && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((att) => (
              <AttachmentChip key={att.attachmentId} attachment={att} clientId={clientId} />
            ))}
          </div>
        )}
        {inlineImages.length > 0 && clientId && (
          <Collapsible
            openLabel={`··· Afficher les images intégrées (${inlineImages.length})`}
            closeLabel="Masquer les images intégrées"
          >
            <div className="mt-1 flex flex-wrap gap-1.5">
              {inlineImages.map((att) => (
                <AttachmentChip key={att.attachmentId} attachment={att} clientId={clientId} />
              ))}
            </div>
          </Collapsible>
        )}

        {forwardNotes && forwardNotes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {forwardNotes.map((note) => (
              <Chip key={note.title} size="sm" variant="soft" title={note.title} className="max-w-full gap-1">
                <ArrowBendUpRight size={11} aria-hidden className="shrink-0" />
                <span className="truncate">{note.label}</span>
              </Chip>
            ))}
          </div>
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
  const fb = useActionFeedback();
  const busy = fb.isPending;
  const onDownload = () => {
    if (!busy) void fb.run(() => downloadAttachment(clientId, attachment));
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onDownload}
      isDisabled={busy}
      aria-label={`Télécharger ${attachment.filename}${attachment.size ? ` (${formatBytes(attachment.size)})` : ""}`}
      className="flex h-auto min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
      style={{
        border: "1px solid var(--border-subtle)",
        backgroundColor: "var(--surface-2, var(--surface-1))",
        color: "var(--text-secondary)",
      }}
    >
      <FeedbackIcon
        state={fb.state}
        error={fb.error}
        size={13}
        idle={<Paperclip size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />}
      />
      <span className="min-w-0 truncate">{attachment.filename}</span>
      {attachment.size > 0 && (
        <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
          {fb.state === "error" ? "Échec" : formatBytes(attachment.size)}
        </span>
      )}
    </Button>
  );
}

function Collapsible({
  openLabel,
  closeLabel,
  children,
}: {
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-my-1 h-8 min-h-8 bg-transparent px-0 text-xs font-normal hover:opacity-70"
        style={{ color: "var(--text-muted)" }}
      >
        {open ? closeLabel : openLabel}
      </Button>
      {open && children}
    </div>
  );
}

function CollapsibleBlock({ openLabel, closeLabel, text }: { openLabel: string; closeLabel: string; text: string }) {
  return (
    <Collapsible openLabel={openLabel} closeLabel={closeLabel}>
      <p
        className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-sm"
        style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
      >
        {text}
      </p>
    </Collapsible>
  );
}

/** `html` doit être DÉJÀ sanitizé (découpé après `sanitizeEmailHtml`). */
function CollapsibleHtml({ openLabel, closeLabel, html }: { openLabel: string; closeLabel: string; html: string }) {
  return (
    <Collapsible openLabel={openLabel} closeLabel={closeLabel}>
      <div
        className="sn-mail-html mt-1 max-w-full overflow-x-auto break-words border-l pl-2 text-sm"
        style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
        // eslint-disable-next-line react/no-danger -- HTML déjà sanitizé en amont
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Collapsible>
  );
}
