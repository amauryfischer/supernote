import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Spinner, Checkbox } from "@heroui/react";
import { EmptyState, Skeleton } from "@supernote/ui";
import {
  FilePlus,
  Database,
  ArrowLeft,
  MagnifyingGlass,
  PencilSimple,
  Archive,
  Trash,
  EnvelopeOpen,
  X,
  CaretDoubleRight,
  CaretDoubleLeft,
  MagicWand,
  ArrowsClockwise,
  Faders,
  Keyboard,
  Confetti,
  ArrowClockwise,
  Sparkle,
  ChatCircleDots,
  Funnel,
  TextAlignLeft,
  Palette,
  Check,
} from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { useConfirm } from "@/hooks/usePrompt";
import { EmailThreadView, type EmailThreadHandle } from "@/components/mail/EmailThreadView";
import { MailOverlayList } from "@/components/mail/MailOverlayList";
import { MailGroupList } from "@/components/mail/MailGroupList";
import { useCaptureEmail } from "@/components/mail/useCaptureEmail";
import { CaptureEmailModal } from "@/components/mail/CaptureEmailModal";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { MailEisenhowerBoard, type MailTodoCard } from "@/components/mail/MailEisenhowerBoard";
import { MailShortcutsHelp } from "@/components/mail/MailShortcutsHelp";
import { MailSearchBar } from "@/components/mail/MailSearchBar";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { MailRowSheet } from "@/components/mail/MailRowSheet";
import { usePullToRefresh } from "@/components/mail/usePullToRefresh";
import type { SwipeAction } from "@/components/mail/SwipeableRow";
import { useMailKeyboard } from "@/components/mail/useMailKeyboard";
import { useMailList, DEFAULT_MAIL_QUERY } from "@/components/mail/useMailList";
import { useMailMirror } from "@/components/mail/useMailMirror";
import { useMailDrafts } from "@/components/mail/useMailDrafts";
import type { MailActionId, MailContext } from "@/lib/mail-shortcuts";
import {
  getThread,
  addThreadLabel,
  modifyThreadLabels,
  markThreadRead,
  markThreadUnread,
  markThreadSpam,
  toggleStar,
  GMAIL_LABEL_PALETTE,
  type EmailThread,
  type GmailLabel,
  type ThreadListItem,
} from "@/lib/gmail";
import {
  listDue,
  removeSnooze,
  addSnooze,
  applyTriage,
  undoTriage,
  INBOX_LABEL,
  DEFAULT_SNOOZE_PRESET,
  type TriageAction,
} from "@/lib/mail-triage";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";
import {
  mirrorAvailable,
  mirrorApplyMutation,
  mirrorCancelOutbox,
  type MirrorMutation,
} from "@/lib/mail-mirror";
import { syncThreadDetail } from "@/lib/mail-sync";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import { isAiConfigured } from "@/lib/mail-ai";
import { toggleRowSelection, pruneSelection } from "@/lib/mail-selection";
import {
  muteThread,
  loadMutedThreads,
  loadBlockedSenders,
  threadsToAutoArchive,
} from "@/lib/mail-mute";
import { pushSearchHistory, isEmptyQuery } from "@/lib/mail-search";
import { bumpTriaged, loadStats, MAIL_STATS_EVENT } from "@/lib/mail-stats";
import {
  resolveTodoLabelIds,
  todoLabelIdSet,
  quadrantOfLabels,
  ensureTodoLabels,
  todoLabelChange,
  applyLabelChange,
  migrateLegacyTodoBindings,
  hasLegacyTodoBindings,
  type EisenhowerQuadrant,
} from "@/lib/mail-eisenhower";
import {
  loadGroups,
  filterInboxItems,
  filterGroupItems,
  groupTabKey,
  groupIdFromTab,
  flatLabelIdsForTab,
  seedDefaultGroups,
  MAIL_GROUPS_EVENT,
  type MailGroup,
} from "@/lib/mail-groups";
import { MailGroupsManager } from "@/components/mail/MailGroupsManager";
import { MailOutboxBadge } from "@/components/mail/MailOutboxBadge";
import { MailOutgoingBadge } from "@/components/mail/MailOutgoingBadge";
import { MailFollowupBadge } from "@/components/mail/MailFollowupBadge";
import { useMailAutoLabel } from "@/components/mail/useMailAutoLabel";
import { useMailSummaries } from "@/components/mail/useMailSummaries";
import {
  buildMailSections,
  flattenSections,
  loadCollapsedSections,
  saveCollapsedSections,
  type MailSectionId,
} from "@/lib/mail-sections";
import { MailAssistantPanel } from "@/components/mail/MailAssistantPanel";
import { MailRulesManager } from "@/components/mail/MailRulesManager";
import {
  loadRules,
  matchRules,
  bumpApplied,
  recordAction,
  suggestRules,
  MAIL_RULES_EVENT,
} from "@/lib/mail-rules";
import { confidenceThreshold } from "@/lib/mail-autolabel";
import { prefersReducedMotion } from "@/lib/motion";
import { useToast, Tooltip, DropdownMenu } from "@supernote/ui";
import { LABEL_STYLES, LabelMarker, labelChipStyle } from "@/components/mail/LabelMarker";
import type { LabelStyle } from "@/components/settings/types";

type GroupRow = Extract<OverlayRow, { kind: "group" }>;

/** Libellé du toast de confirmation par action de triage. */
const TRIAGE_DONE_LABEL: Record<TriageAction, string> = {
  done: "Email marqué comme fait",
  archive: "Email archivé",
  snooze: "Email reporté",
  delete: "Email supprimé",
};

/** Durée du toast « Annuler » : assez longue pour cliquer, sans gêner (6 s). */
const UNDO_TOAST_DURATION_MS = 6000;

/** Fenêtre du raccourci clavier « z » (annuler la dernière action) : 10 s. */
const UNDO_WINDOW_MS = 10000;

const LABEL_STYLE_PREVIEW = GMAIL_LABEL_PALETTE[5];

/**
 * Mutation mirror équivalente à une action de triage (modèle inbox zero). PAS de
 * `dropThread` : on retire seulement INBOX (le fil sort de la liste filtrée
 * INBOX) en GARDANT la ligne, pour que l'« Annuler » puisse la re-patcher. La
 * reconciliation incrémentale récupère la place (drop) au prochain sync.
 */
function triageMutation(id: string, action: TriageAction): MirrorMutation {
  return action === "delete"
    ? { threadId: id, kind: "trash", removeLabelIds: [INBOX_LABEL] }
    : { threadId: id, kind: "modifyLabels", removeLabelIds: [INBOX_LABEL] };
}

export default function MailPage() {
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Mail" : null);

  const clientId = settings.googleDrive.clientId.trim();
  // Compte Gmail connecté = clé de scoping du mirror local (mail_* tables).
  const accountId = settings.gmail.connectedEmail;
  const connected = useGmailConnected();
  // Prêt du worker vault : `connected` (settings) passe à true AVANT que le
  // worker OPFS ait fini de booter. Sans ce signal, loadList se lancerait trop
  // tôt (mirror indispo → chemin live → OAuth) et ne se relancerait jamais.
  const [workerReady, setWorkerReady] = useState(
    typeof window === "undefined" ? false : isWorkerReady(),
  );
  useEffect(() => {
    if (isWorkerReady()) {
      setWorkerReady(true);
      return;
    }
    const onReady = () => setWorkerReady(true);
    window.addEventListener("supernote:vault-ready", onReady);
    return () => window.removeEventListener("supernote:vault-ready", onReady);
  }, []);
  // Adresses « à moi » (compte connecté + alias/boîtes partagées) → exclues du
  // regroupement par expéditeur dans la surcouche mail (cf. buildMailOverlay).
  const selfAddresses = useMemo(
    () => [settings.gmail.connectedEmail, ...settings.gmail.aliases],
    [settings.gmail.connectedEmail, settings.gmail.aliases],
  );

  const { captureToNote } = useCaptureEmail();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [query, setQuery] = useState(DEFAULT_MAIL_QUERY);
  // Texte de recherche AFFICHÉ (vide par défaut → placeholder). La requête Gmail
  // effective (`query`) reste `in:inbox` quand le champ est vide.
  const [searchText, setSearchText] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Mode de recherche courant : `null` = boîte normale ; un nombre = résultats
  // LOCAUX (mirror) ; `remote` = résultats Gmail après validation.
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [remoteSearch, setRemoteSearch] = useState(false);
  // Navigation clavier desktop : index de la ligne « curseur » dans `rows`
  // (distinct du fil ouvert). -1 = aucune sélection.
  const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
  // Curseur clavier DANS un groupe ouvert (pane2).
  const [groupCursor, setGroupCursor] = useState(0);
  // Groupe ouvert : volet qui reçoit ↑/↓/↵ et les actions (← / → pour basculer).
  const [pane, setPane] = useState<"list" | "group">("group");
  const groupScrollRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // Conteneur scrollable du fil ouvert : on s'y positionne EN BAS à l'ouverture.
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  // Anti-course : une réponse réseau plus lente qu'un souhait plus récent est
  // ignorée (jeton croissant par ouverture de fil).
  const reqRef = useRef(0);
  // Sélection multiple (desktop) : Set des threadIds cochés.
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Onglet du pane gauche : « inbox », « todo », ou « g:<id> » (groupe).
  const [mailTab, setMailTab] = useState<string>("inbox");
  const [groups, setGroups] = useState<MailGroup[]>(() => loadGroups());
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setGroups(loadGroups());
    window.addEventListener(MAIL_GROUPS_EVENT, refresh);
    return () => window.removeEventListener(MAIL_GROUPS_EVENT, refresh);
  }, []);
  // Refs lues par les reconstructions d'overlay (callbacks stables).
  const mailTabRef = useRef(mailTab);
  const groupsRef = useRef(groups);
  useEffect(() => {
    mailTabRef.current = mailTab;
  }, [mailTab]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  // Groupe actif supprimé (depuis le manager) → repli sur l'inbox.
  useEffect(() => {
    const gid = groupIdFromTab(mailTab);
    if (gid !== null && !groups.some((g) => g.id === gid)) setMailTab("inbox");
  }, [mailTab, groups]);


  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  // Fil ouvert : la liste se réduit à un rail ; `peekList` la déplie par-dessus.
  const [peekList, setPeekList] = useState(false);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const threadRef = useRef<EmailThreadHandle>(null);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Cible du menu « Reporter à… » (raccourci `h`, menu contextuel, mobile).
  const [snoozeTarget, setSnoozeTarget] = useState<{ id: string; subject: string } | null>(null);
  // Feuille d'actions mobile (appui long sur une ligne).
  const [sheetItem, setSheetItem] = useState<ThreadListItem | null>(null);
  // Assistant de boîte (questions en langage naturel, IA locale).
  const [assistantOpen, setAssistantOpen] = useState(false);
  // Règles locales + propositions issues des gestes répétés.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);
  useEffect(() => {
    const refresh = () => setSuggestionCount(suggestRules().length);
    refresh();
    window.addEventListener(MAIL_RULES_EVENT, refresh);
    return () => window.removeEventListener(MAIL_RULES_EVENT, refresh);
  }, []);
  // Valeurs initiales du compose (transfert → objet/corps pré-remplis).
  const [composeInitial, setComposeInitial] = useState<{
    to?: string;
    subject: string;
    body: string;
  }>({ subject: "", body: "" });
  // Annonce vocale (lecteurs d'écran) du résultat de la dernière action.
  const [liveMessage, setLiveMessage] = useState("");
  // Compteur « traités aujourd'hui » (écran inbox zero).
  const [dayStats, setDayStats] = useState(() => loadStats());
  useEffect(() => {
    const refresh = () => setDayStats(loadStats());
    window.addEventListener(MAIL_STATS_EVENT, refresh);
    return () => window.removeEventListener(MAIL_STATS_EVENT, refresh);
  }, []);

  // Ouvre un compose vierge (« Nouveau message »).
  const openCompose = useCallback(() => {
    setComposeInitial({ subject: "", body: "" });
    setComposeOpen(true);
  }, []);

  // Transfert : pré-remplit le compose (objet « Fwd: … » + corps cité), To vide.
  const handleForward = useCallback((prefill: { to?: string; subject: string; body: string }) => {
    setComposeInitial(prefill);
    setComposeOpen(true);
  }, []);

  // Action « créer » → FAB sur mobile.
  useMobileFab(
    connected ? { icon: PencilSimple, label: "Nouveau message", onPress: openCompose } : null,
  );

  // Déclaré ici (et non près des autres appels IA) parce que la barre du haut
  // mobile, publiée juste en dessous, en dépend.
  const aiConfigured = useMemo(() => isAiConfigured(), [settings.ia.ollamaModel]);
  /**
   * Passe de résumés déclenchée à la main. Le hook qui la fournit dépend de la
   * liste, donc n'existe que plus bas : on publie une référence stable ici et on
   * la branche une fois le hook monté.
   */
  const runSummariesRef = useRef<() => void>(() => {});
  const runSummariesNow = useCallback(() => runSummariesRef.current(), []);

  // Recherche dans la barre du haut mobile : le champ de recherche large
  // n'existe que sur desktop, donc inaccessible au doigt.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const setLabelStyle = (labelStyle: LabelStyle) =>
    updateSettings("gmail", { ...settings.gmail, labelStyle });
  const labelStyleIndex = LABEL_STYLES.findIndex((s) => s.id === settings.gmail.labelStyle);
  const cycleLabelStyle = () => {
    const next = LABEL_STYLES[(labelStyleIndex + 1) % LABEL_STYLES.length]!;
    setLabelStyle(next.id);
    toast({ title: `Style des labels : ${next.name}` });
  };
  useMobileHeaderActions(
    connected
      ? [
          {
            id: "mail-search",
            icon: MagnifyingGlass,
            label: "Rechercher",
            onPress: () => {
              setMobileSearchOpen((v) => !v);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            },
            active: mobileSearchOpen,
          },
          {
            id: "mail-label-style",
            icon: Palette,
            // Le style courant dans le label force la republication : le provider fige les callbacks.
            label: `Style des labels : ${LABEL_STYLES[labelStyleIndex]?.name ?? "Plein"}`,
            onPress: cycleLabelStyle,
          },
          ...(settings.gmail.listSummary && aiConfigured
            ? [
                {
                  id: "mail-summaries",
                  icon: TextAlignLeft,
                  label: "Résumer les emails",
                  onPress: runSummariesNow,
                },
              ]
            : []),
        ]
      : [],
  );

  const flatLabelIds = useCallback(
    () => flatLabelIdsForTab(mailTabRef.current, groupsRef.current),
    [],
  );

  // Items visibles pour l'onglet ACTIF (lit des refs → callback stable).
  const computeVisible = useCallback((items: ThreadListItem[]): ThreadListItem[] => {
    const groupId = groupIdFromTab(mailTabRef.current);
    if (groupId !== null) {
      return filterGroupItems(items, groupsRef.current.find((g) => g.id === groupId));
    }
    return filterInboxItems(items, groupsRef.current);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedGroup(null);
    setSelectedThreadId(null);
    setThread(null);
  }, []);

  const list = useMailList({
    clientId,
    accountId,
    selfAddresses,
    computeVisible,
    flatLabelIds,
    onResetSelection: resetSelection,
  });
  const {
    rows,
    setRows,
    cumItems,
    setCumItems,
    labelNames,
    labelColors,
    listLoading,
    listError,
    nextPageToken,
    moreLoading,
    loadList,
    loadMore,
    searchLocal,
    addLabel,
  } = list;

  // ── Sections de liste ──────────────────────────────────────────────────────
  // La liste n'est plus un ruban : elle est découpée en « Todo », « Étoilés »
  // puis en tranches de temps, chacune avec un mini-en-tête repliable (cf. Shortwave).
  // `displayRows` est la liste RÉELLEMENT affichée — donc aussi celle que
  // parcourt le clavier : sections repliées exclues, ordre identique.
  const [collapsedSections, setCollapsedSections] =
    useState<ReadonlySet<MailSectionId>>(loadCollapsedSections);
  const toggleSection = useCallback((id: MailSectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsedSections(next);
      return next;
    });
  }, []);
  useEffect(() => {
    seedDefaultGroups(labelNames);
  }, [labelNames]);

  const todoLabelIds = useMemo(() => resolveTodoLabelIds(labelNames), [labelNames]);
  const { rows: displayRows, markers: sectionMarkers } = useMemo(
    () =>
      flattenSections(
        buildMailSections(rows, Date.now(), todoLabelIdSet(todoLabelIds)),
        collapsedSections,
      ),
    [rows, collapsedSections, todoLabelIds],
  );
  const todoCards = useMemo(
    () =>
      cumItems.flatMap<MailTodoCard>((item) => {
        const quadrant = quadrantOfLabels(item.labelIds, todoLabelIds);
        return quadrant ? [{ item, quadrant }] : [];
      }),
    [cumItems, todoLabelIds],
  );

  const { patchMirror, pushOutboxNow, commitMutation } = useMailMirror(clientId, accountId);
  const drafts = useMailDrafts(thread, settings.gmail.connectedEmail);

  useEffect(() => {
    if (connected) void loadList(DEFAULT_MAIL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, workerReady]);

  // Bascule d'onglet inbox ↔ groupe : re-dérive les rows depuis les items déjà
  // chargés (mirror INBOX), sans refetch réseau → instantané.
  useEffect(() => {
    if (mailTab === "todo") return;
    setRows(
      buildMailOverlay(computeVisible(cumItems), labelNames, selfAddresses, flatLabelIds()),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailTab, groups, cumItems, labelNames, selfAddresses, computeVisible, flatLabelIds]);

  // Réveil auto des snoozes échus : remet en boîte les fils dont l'échéance est
  // dépassée, puis purge leur entrée. Best-effort, non bloquant.
  useEffect(() => {
    if (!connected || !clientId) return;
    const due = listDue(Date.now());
    for (const e of due) {
      void modifyThreadLabels(clientId, e.threadId, { addLabelIds: [INBOX_LABEL] })
        .then(() => removeSnooze(e.threadId))
        .catch(() => {
          /* réveil best-effort : on retentera au prochain montage */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, clientId]);

  // ── Ouverture d'un fil ──────────────────────────────────────────────────────
  // Intention différée : `r` / `a` / `f` / `l` sur une ligne de la LISTE ouvrent
  // le fil puis exécutent l'action une fois le fil monté.
  const pendingIntentRef = useRef<MailActionId | null>(null);

  const openThread = useCallback(
    async (threadId: string) => {
      const reqId = ++reqRef.current;
      setThreadError(null);
      setSelectedThreadId(threadId);
      setPeekList(false); // sélection faite → on referme l'overlay liste

      // Optimiste : ouvrir un fil le marque lu → retirer UNREAD de la ligne.
      setRows((rs) =>
        rs.map<OverlayRow>((r) => {
          if (r.kind === "single") {
            return r.item.id === threadId
              ? {
                  ...r,
                  item: { ...r.item, labelIds: r.item.labelIds.filter((id) => id !== "UNREAD") },
                }
              : r;
          }
          if (!r.items.some((it) => it.id === threadId)) return r;
          return {
            ...r,
            items: r.items.map((it) =>
              it.id === threadId
                ? { ...it, labelIds: it.labelIds.filter((id) => id !== "UNREAD") }
                : it,
            ),
          };
        }),
      );

      const canMirror = mirrorAvailable() && !!accountId;
      if (canMirror) patchMirror({ threadId, kind: "modifyLabels", removeLabelIds: ["UNREAD"] });

      // 1) Affichage instantané depuis le mirror si les messages y sont cachés.
      let shownFromMirror = false;
      if (canMirror) {
        try {
          const { mirrorGetThread } = await import("@/lib/mail-mirror");
          const cached = await mirrorGetThread(accountId, threadId);
          if (reqId !== reqRef.current) return;
          if (cached && cached.thread.messages.length > 0) {
            setThread(cached.thread);
            setThreadLoading(false);
            shownFromMirror = true;
          }
        } catch {
          /* miss mirror → fetch live ci-dessous */
        }
      }
      if (!shownFromMirror) setThreadLoading(true);

      // 2) Fetch live (et persistance mirror si dispo) pour rafraîchir/compléter.
      try {
        const t = canMirror
          ? await syncThreadDetail(clientId, accountId, threadId)
          : await getThread(clientId, threadId);
        if (reqId !== reqRef.current) return;
        setThread(t);
      } catch (err) {
        if (reqId !== reqRef.current) return;
        if (!shownFromMirror) setThreadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === reqRef.current) setThreadLoading(false);
      }
    },
    [accountId, clientId, patchMirror, setRows],
  );

  // Exécute l'intention différée dès que le fil demandé est monté.
  useEffect(() => {
    const intent = pendingIntentRef.current;
    if (!intent || !thread) return;
    pendingIntentRef.current = null;
    const h = threadRef.current;
    if (!h) return;
    if (intent === "reply") h.focusReply();
    else if (intent === "replyAll") h.replyAll();
    else if (intent === "forward") h.forward();
    else if (intent === "label") h.openLabelPicker();
  }, [thread]);

  const closeThread = useCallback(() => {
    setSelectedThreadId(null);
    setThread(null);
    setThreadError(null);
    setPeekList(false);
  }, []);

  // Deep-link `/mail?thread=<id>` : ouvre directement le fil. Consommé une fois.
  useEffect(() => {
    const tid = searchParams.get("thread");
    if (!tid || !connected || !clientId) return;
    void openThread(tid);
    const next = new URLSearchParams(searchParams);
    next.delete("thread");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, connected, clientId]);

  // À l'ouverture d'un fil, on déplace le FOCUS sur le panneau de lecture : le
  // lecteur d'écran annonce le fil, et Tab enchaîne sur ses actions plutôt que
  // de repartir du haut du document. `tabIndex={-1}` rend le conteneur focusable
  // sans l'insérer dans l'ordre de tabulation.
  useEffect(() => {
    if (!thread) return;
    threadScrollRef.current?.focus({ preventScroll: true });
  }, [thread?.id]);

  // À l'ouverture d'un fil : on se place EN BAS (dernier message).
  useEffect(() => {
    if (!thread) return undefined;
    const el = threadScrollRef.current;
    if (!el) return undefined;
    const toBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    const raf = requestAnimationFrame(toBottom);
    const t = setTimeout(toBottom, 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [thread]);

  const onPick = useCallback(
    (row: OverlayRow) => {
      setPeekList(false);
      if (row.kind === "single") {
        setSelectedGroup(null);
        void openThread(row.item.id);
      } else {
        setSelectedGroup(row);
        setPane("group");
        setSelectedThreadId(null);
        setThread(null);
      }
    },
    [openThread],
  );

  // Retire un fil (par id) de la liste + désélectionne s'il était ouvert.
  const dropThreadFromList = useCallback(
    (id: string) => {
      setRows((rs) =>
        rs.flatMap<OverlayRow>((r) => {
          if (r.kind === "single") return r.item.id === id ? [] : [r];
          const items = r.items.filter((it) => it.id !== id);
          return items.length ? [{ ...r, items, count: items.length }] : [];
        }),
      );
      // Les lignes sont reconstruites depuis `cumItems` (étoile, tag, onglet) :
      // un fil laissé là ressusciterait à la prochaine reconstruction.
      setCumItems((items) => items.filter((it) => it.id !== id));
      setSelectedGroup((g) => {
        if (!g) return g;
        const items = g.items.filter((it) => it.id !== id);
        return items.length ? { ...g, items, count: items.length } : null;
      });
      setSelectedThreadId((cur) => {
        if (cur === id) {
          setThread(null);
          return null;
        }
        return cur;
      });
    },
    [setRows, setCumItems],
  );

  // ── Annuler (toast + raccourci `z`) ─────────────────────────────────────────
  const lastUndoableRef = useRef<{
    id: string;
    action: TriageAction;
    opId: string | null;
    at: number;
  } | null>(null);

  const performUndo = useCallback(
    (id: string, action: TriageAction, opId?: string | null) => {
      if (!clientId) return;
      lastUndoableRef.current = null; // consommé
      const undo = (async () => {
        if (opId && mirrorAvailable() && accountId) {
          await mirrorCancelOutbox([opId]);
          const reverse: MirrorMutation =
            action === "delete"
              ? { threadId: id, kind: "untrash", addLabelIds: [INBOX_LABEL] }
              : { threadId: id, kind: "modifyLabels", addLabelIds: [INBOX_LABEL] };
          await mirrorApplyMutation(accountId, { ...reverse, enqueue: true });
          if (action === "snooze") removeSnooze(id);
          pushOutboxNow();
        } else {
          await undoTriage(clientId, id, action);
        }
      })();
      undo
        .then(() => {
          void loadList(query);
          setLiveMessage("Triage annulé");
          toast({ title: "Triage annulé", variant: "success" });
        })
        .catch((err) => {
          toast({
            title: "Annulation impossible",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
        });
    },
    [clientId, accountId, toast, loadList, query, pushOutboxNow],
  );

  const offerUndo = useCallback(
    (id: string, action: TriageAction, opId?: string | null) => {
      setLiveMessage(TRIAGE_DONE_LABEL[action]);
      if (!clientId) {
        toast({ title: TRIAGE_DONE_LABEL[action] });
        return;
      }
      lastUndoableRef.current = { id, action, opId: opId ?? null, at: Date.now() };
      toast({
        title: TRIAGE_DONE_LABEL[action],
        duration: UNDO_TOAST_DURATION_MS,
        action: { label: "Annuler", onClick: () => performUndo(id, action, opId) },
      });
    },
    [clientId, toast, performUndo],
  );

  // « Fait » vide aussi la matrice : sinon le label todo survit à l'archivage et
  // le fil reste visible dans une vue par label (Gmail, Shortwave).
  const stripTodoLabels = useCallback(
    (id: string) => {
      if (!clientId) return;
      const todoIds = todoLabelIdSet(todoLabelIds);
      const labelIds =
        cumItems.find((it) => it.id === id)?.labelIds ?? (thread?.id === id ? thread.labelIds : []);
      const removeLabelIds = labelIds.filter((l) => todoIds.has(l));
      if (removeLabelIds.length === 0) return;
      commitMutation({ threadId: id, kind: "modifyLabels", removeLabelIds }, () =>
        modifyThreadLabels(clientId, id, { removeLabelIds }),
      ).catch((err) => {
        toast({
          title: "Retrait du label Todo échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      });
    },
    [clientId, todoLabelIds, cumItems, thread, commitMutation, toast],
  );

  // ── Triage : un seul cœur pour la liste, le groupe et le fil ouvert ─────────
  const triageThread = useCallback(
    (id: string, action: TriageAction, until?: number) => {
      if (!clientId) return;
      // Geste manuel noté : trois archivages du même expéditeur feront une
      // proposition de règle (cf. mail-rules).
      if (action === "archive" || action === "done") {
        const item = cumItems.find((it) => it.id === id);
        if (item) recordAction(item.from.email, "archive");
      }
      if (action === "done") stripTodoLabels(id);
      dropThreadFromList(id);
      if (action === "snooze") {
        addSnooze(id, until ?? DEFAULT_SNOOZE_PRESET.computeUntil(new Date()));
      }
      bumpTriaged();
      const errTitle =
        action === "delete"
          ? "Suppression échouée"
          : action === "snooze"
            ? "Report échoué"
            : action === "done"
              ? "Action échouée"
              : "Archivage échoué";
      commitMutation(triageMutation(id, action), () => applyTriage(clientId, id, action))
        .then((opId) => offerUndo(id, action, opId))
        .catch((err) => {
          if (action === "snooze") removeSnooze(id);
          toast({
            title: errTitle,
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
          void loadList(query);
        });
    },
    [
      clientId,
      cumItems,
      stripTodoLabels,
      dropThreadFromList,
      commitMutation,
      offerUndo,
      toast,
      loadList,
      query,
    ],
  );

  const handleTriageRow = useCallback(
    (row: OverlayRow, action: TriageAction, until?: number) => {
      if (row.kind !== "single") return;
      triageThread(row.item.id, action, until);
    },
    [triageThread],
  );

  // ── Sélection multiple (desktop) ───────────────────────────────────────────
  const toggleRowSelected = useCallback((row: OverlayRow) => {
    setSelectedThreadIds((prev) => toggleRowSelection(row, prev));
  }, []);

  const clearSelection = useCallback(() => setSelectedThreadIds(new Set()), []);

  const runBulkAction = useCallback(
    async (kind: "archive" | "delete" | "read") => {
      if (!clientId || selectedThreadIds.size === 0 || bulkBusy) return;
      const ids = [...selectedThreadIds];
      setBulkBusy(true);
      if (kind === "read") {
        setRows((rs) =>
          rs.map<OverlayRow>((r) => {
            const strip = (it: ThreadListItem): ThreadListItem =>
              ids.includes(it.id)
                ? { ...it, labelIds: it.labelIds.filter((l) => l !== "UNREAD") }
                : it;
            return r.kind === "single"
              ? { ...r, item: strip(r.item) }
              : { ...r, items: r.items.map(strip) };
          }),
        );
      } else {
        for (const id of ids) dropThreadFromList(id);
        bumpTriaged(ids.length);
      }
      try {
        const triage: TriageAction = kind === "delete" ? "delete" : "archive";
        await Promise.all(
          ids.map((id) =>
            kind === "read"
              ? commitMutation({ threadId: id, kind: "modifyLabels", removeLabelIds: ["UNREAD"] }, () =>
                  markThreadRead(clientId, id),
                )
              : commitMutation(triageMutation(id, triage), () => applyTriage(clientId, id, triage)),
          ),
        );
        const title =
          kind === "read"
            ? `${ids.length} email(s) marqué(s) lu(s)`
            : kind === "delete"
              ? `${ids.length} email(s) supprimé(s)`
              : `${ids.length} email(s) archivé(s)`;
        setLiveMessage(title);
        toast({ title });
      } catch (err) {
        toast({
          title: "Action groupée partiellement échouée",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      } finally {
        setSelectedThreadIds(new Set());
        setBulkBusy(false);
        void loadList(query);
      }
    },
    [
      clientId,
      selectedThreadIds,
      bulkBusy,
      dropThreadFromList,
      toast,
      loadList,
      query,
      commitMutation,
      setRows,
    ],
  );

  const deleteGroup = useCallback(
    async (group: GroupRow) => {
      if (!clientId || bulkBusy) return;
      const ids = group.items.map((it) => it.id);
      if (ids.length === 0) return;
      const ok = await confirm({
        title: `Supprimer ${ids.length} email${ids.length > 1 ? "s" : ""} ?`,
        description: `Tous les emails du groupe « ${group.title} » seront déplacés dans la corbeille.`,
        destructive: true,
        confirmLabel: "Supprimer",
      });
      if (!ok) return;
      setBulkBusy(true);
      for (const id of ids) dropThreadFromList(id);
      bumpTriaged(ids.length);
      setSelectedGroup(null);
      setSelectedThreadId(null);
      setThread(null);
      try {
        await Promise.all(
          ids.map((id) =>
            commitMutation(
              { threadId: id, kind: "trash", removeLabelIds: [INBOX_LABEL], dropThread: true },
              () => applyTriage(clientId, id, "delete"),
            ),
          ),
        );
        toast({
          title: `${ids.length} email${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`,
        });
      } catch (err) {
        toast({
          title: "Suppression partiellement échouée",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      } finally {
        setBulkBusy(false);
        void loadList(query);
      }
    },
    [clientId, bulkBusy, confirm, dropThreadFromList, toast, loadList, query, commitMutation],
  );

  const markGroupRead = useCallback(
    async (group: GroupRow) => {
      if (!clientId) return;
      const ids = group.items.filter((it) => it.labelIds.includes("UNREAD")).map((it) => it.id);
      if (ids.length === 0) return;
      const strip = (it: ThreadListItem): ThreadListItem =>
        ids.includes(it.id) ? { ...it, labelIds: it.labelIds.filter((l) => l !== "UNREAD") } : it;
      setRows((rs) =>
        rs.map<OverlayRow>((r) =>
          r.kind === "single" ? { ...r, item: strip(r.item) } : { ...r, items: r.items.map(strip) },
        ),
      );
      setSelectedGroup((g) => (g ? { ...g, items: g.items.map(strip) } : g));
      try {
        await Promise.all(
          ids.map((id) =>
            commitMutation({ threadId: id, kind: "modifyLabels", removeLabelIds: ["UNREAD"] }, () =>
              markThreadRead(clientId, id),
            ),
          ),
        );
        toast({
          title: `${ids.length} marqué${ids.length > 1 ? "s" : ""} comme lu${ids.length > 1 ? "s" : ""}`,
        });
      } catch (err) {
        toast({
          title: "Marquage « lu » partiellement échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
        void loadList(query);
      }
    },
    [clientId, toast, loadList, query, commitMutation, setRows],
  );

  // ── Resynchronisation des labels optimistes ────────────────────────────────
  const syncThreadLabels = useCallback(
    (id: string, labelIds: string[]) => {
      const apply = (it: ThreadListItem): ThreadListItem =>
        it.id === id ? { ...it, labelIds } : it;
      setRows((rs) => {
        const items = rs.flatMap((r) => (r.kind === "single" ? [r.item] : r.items)).map(apply);
        return buildMailOverlay(computeVisible(items), labelNames, selfAddresses, flatLabelIds());
      });
      setCumItems((items) => items.map(apply));
      setSelectedGroup((g) =>
        g && g.items.some((it) => it.id === id) ? { ...g, items: g.items.map(apply) } : g,
      );
      setThread((t) =>
        t && t.id === id ? { ...t, labelIds, messages: t.messages.map((m) => ({ ...m })) } : t,
      );
    },
    [labelNames, selfAddresses, computeVisible, flatLabelIds, setRows, setCumItems],
  );

  const handleApplyLabel = useCallback(
    (threadId: string, labelId: string) => {
      if (!clientId || !labelId) return;
      const tagged = cumItems.find((it) => it.id === threadId);
      if (tagged) recordAction(tagged.from.email, "label", labelId);
      const rebuild = (items: ThreadListItem[]) =>
        setRows(
          buildMailOverlay(computeVisible(items), labelNames, selfAddresses, flatLabelIds()),
        );
      let prev: ThreadListItem[] | null = null;
      setCumItems((items) => {
        prev = items;
        const next = items.map((it) =>
          it.id === threadId && !it.labelIds.includes(labelId)
            ? { ...it, labelIds: [...it.labelIds, labelId] }
            : it,
        );
        rebuild(next);
        return next;
      });
      setThread((t) =>
        t && t.id === threadId && !t.labelIds.includes(labelId)
          ? { ...t, labelIds: [...t.labelIds, labelId] }
          : t,
      );
      void commitMutation({ threadId, kind: "modifyLabels", addLabelIds: [labelId] }, () =>
        addThreadLabel(clientId, threadId, labelId),
      )
        .then(() => toast({ title: "Tag appliqué" }))
        .catch((err) => {
          if (prev) {
            const restored = prev;
            setCumItems(() => {
              rebuild(restored);
              return restored;
            });
          }
          setThread((t) =>
            t && t.id === threadId
              ? { ...t, labelIds: t.labelIds.filter((l) => l !== labelId) }
              : t,
          );
          toast({
            title: "Ajout du tag échoué",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
        });
    },
    [
      clientId,
      cumItems,
      labelNames,
      selfAddresses,
      toast,
      commitMutation,
      computeVisible,
      flatLabelIds,
      setRows,
      setCumItems,
    ],
  );

  // ── Classement automatique (IA locale) ─────────────────────────────────────
  const autoLabel = useMailAutoLabel({
    enabled: Boolean(settings.gmail.autoLabel) && aiConfigured,
    clientId,
    minConfidence: confidenceThreshold(settings.gmail.autoLabelConfidence),
    items: cumItems,
    labelNames,
    applyLabel: handleApplyLabel,
    onLabelCreated: addLabel,
  });

  // ── Mini-résumés de liste (IA locale) ──────────────────────────────────────
  // Le corps vient du miroir local : aucune requête Gmail ajoutée, aucun quota.
  const listSummaries = useMailSummaries({
    enabled: Boolean(settings.gmail.listSummary) && aiConfigured,
    accountId,
    items: cumItems,
  });
  runSummariesRef.current = listSummaries.runNow;

  const toggleRowStar = useCallback(
    (id: string, current: string[]) => {
      if (!clientId) return;
      const next = !current.includes("STARRED");
      const nextIds = next ? [...current, "STARRED"] : current.filter((l) => l !== "STARRED");
      syncThreadLabels(id, nextIds);
      void commitMutation(
        {
          threadId: id,
          kind: "modifyLabels",
          ...(next ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] }),
        },
        () => toggleStar(clientId, id, next),
      ).catch((err) => {
        syncThreadLabels(id, current);
        toast({
          title: next ? "Ajout de l'étoile échoué" : "Retrait de l'étoile échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      });
    },
    [clientId, syncThreadLabels, toast, commitMutation],
  );

  const handleMarkRowRead = useCallback(
    (row: OverlayRow, read: boolean) => {
      if (row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      const current = row.item.labelIds;
      const nextIds = read ? current.filter((l) => l !== "UNREAD") : [...current, "UNREAD"];
      syncThreadLabels(id, nextIds);
      void commitMutation(
        {
          threadId: id,
          kind: "modifyLabels",
          ...(read ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] }),
        },
        () => (read ? markThreadRead(clientId, id) : markThreadUnread(clientId, id)),
      ).catch((err) => {
        syncThreadLabels(id, current);
        toast({
          title: read ? "Marquage « lu » échoué" : "Marquage « non lu » échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      });
    },
    [clientId, syncThreadLabels, toast, commitMutation],
  );

  /**
   * « Tout marquer lu » d'une section : optimiste en UNE reconstruction de la
   * surcouche pour tout le lot (appeler `syncThreadLabels` fil par fil la
   * referait N fois), puis une mutation par fil — l'API Gmail n'expose pas de
   * modification de labels groupée. En cas d'échec, on recharge la liste plutôt
   * que de deviner quels fils sont réellement passés.
   */
  const markThreadsRead = useCallback(
    (threadIds: string[]) => {
      if (!clientId || threadIds.length === 0) return;
      const ids = new Set(threadIds);
      const strip = (it: ThreadListItem): ThreadListItem =>
        ids.has(it.id) && it.labelIds.includes("UNREAD")
          ? { ...it, labelIds: it.labelIds.filter((l) => l !== "UNREAD") }
          : it;
      setRows((rs) =>
        buildMailOverlay(
          computeVisible(
            rs.flatMap((r) => (r.kind === "single" ? [r.item] : r.items)).map(strip),
          ),
          labelNames,
          selfAddresses,
          flatLabelIds(),
        ),
      );
      setCumItems((items) => items.map(strip));
      setSelectedGroup((g) => (g ? { ...g, items: g.items.map(strip) } : g));
      setLiveMessage(`${threadIds.length} email(s) marqué(s) lu(s)`);
      void Promise.all(
        threadIds.map((id) =>
          commitMutation(
            { threadId: id, kind: "modifyLabels", removeLabelIds: ["UNREAD"] },
            () => markThreadRead(clientId, id),
          ),
        ),
      ).catch((err) => {
        toast({
          title: "Marquage « lu » partiellement échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
        void loadList(query);
      });
    },
    [
      clientId,
      commitMutation,
      computeVisible,
      flatLabelIds,
      labelNames,
      selfAddresses,
      setRows,
      setCumItems,
      toast,
      loadList,
      query,
    ],
  );

  // ── Fils ignorés / expéditeurs bloqués ─────────────────────────────────────
  // L'API Gmail n'a ni « mute » ni filtre de blocage accessible : on applique
  // donc la règle nous-mêmes à chaque rafraîchissement de la boîte. Silencieux
  // par construction — l'utilisateur a demandé à ne plus voir ces fils.
  useEffect(() => {
    if (!clientId || cumItems.length === 0) return;
    const ids = threadsToAutoArchive(cumItems, loadMutedThreads(), loadBlockedSenders());
    if (ids.length === 0) return;
    for (const id of ids) dropThreadFromList(id);
    for (const id of ids) {
      void commitMutation(
        { threadId: id, kind: "modifyLabels", removeLabelIds: [INBOX_LABEL], dropThread: true },
        () => applyTriage(clientId, id, "archive"),
      ).catch(() => {
        /* best-effort : la règle sera ré-appliquée au prochain chargement */
      });
    }
  }, [cumItems, clientId, dropThreadFromList, commitMutation]);

  // ── Règles locales ─────────────────────────────────────────────────────────
  // Appliquées à chaque rafraîchissement de la boîte, une seule règle par fil
  // (la première qui correspond) : deux règles contradictoires ne se battent
  // pas sur le même email. Une règle n'efface jamais un email.
  useEffect(() => {
    if (!clientId || cumItems.length === 0) return;
    const matches = matchRules(cumItems, loadRules());
    if (matches.length === 0) return;
    for (const { thread: item, rule } of matches) {
      const add: string[] = [];
      const remove: string[] = [];
      if (rule.then.addLabelId && !item.labelIds.includes(rule.then.addLabelId)) {
        add.push(rule.then.addLabelId);
      }
      if (rule.then.star && !item.labelIds.includes("STARRED")) add.push("STARRED");
      if (rule.then.markRead && item.labelIds.includes("UNREAD")) remove.push("UNREAD");
      if (rule.then.archive) remove.push(INBOX_LABEL);
      if (add.length === 0 && remove.length === 0) continue;

      if (rule.then.archive) dropThreadFromList(item.id);
      else syncThreadLabels(item.id, [...item.labelIds.filter((l) => !remove.includes(l)), ...add]);

      bumpApplied(rule.id);
      void commitMutation(
        {
          threadId: item.id,
          kind: "modifyLabels",
          addLabelIds: add,
          removeLabelIds: remove,
          ...(rule.then.archive ? { dropThread: true } : {}),
        },
        () => modifyThreadLabels(clientId, item.id, { addLabelIds: add, removeLabelIds: remove }),
      ).catch(() => {
        /* best-effort : la règle sera ré-appliquée au prochain chargement */
      });
    }
  }, [cumItems, clientId, dropThreadFromList, syncThreadLabels, commitMutation]);

  // ── Gestes tactiles (mobile) ───────────────────────────────────────────────
  // Glisser une ligne : droite = archiver, gauche = reporter (choix de
  // l'échéance, pour ne pas décider à la place de l'utilisateur).
  const handleSwipeRow = useCallback(
    (row: OverlayRow, action: SwipeAction) => {
      if (row.kind !== "single") return;
      if (action === "archive") {
        triageThread(row.item.id, "archive");
        return;
      }
      setSnoozeTarget({ id: row.item.id, subject: row.item.subject });
    },
    [triageThread],
  );

  const handleLongPressRow = useCallback((row: OverlayRow) => {
    if (row.kind !== "single") return;
    setSheetItem(row.item);
  }, []);

  // Tirer pour rafraîchir : resynchronise la boîte (mirror + Gmail).
  const { pull, refreshing } = usePullToRefresh(
    listScrollRef,
    () => loadList(query),
    isMobile && mailTab !== "todo",
  );

  // ── Matrice todo : 4 labels Gmail ──────────────────────────────────────────
  const loadTodoLabels = useCallback(async () => {
    const labels = await ensureTodoLabels(clientId, labelNames);
    for (const l of Object.values(labels)) addLabel(l);
    return labels;
  }, [clientId, labelNames, addLabel]);

  const assignQuadrant = useCallback(
    (threadId: string, quadrant: EisenhowerQuadrant) => {
      if (!clientId) return;
      let prev: ThreadListItem[] | null = null;
      void loadTodoLabels()
        .then((labels) => {
          const change = todoLabelChange(labels, quadrant);
          setCumItems((items) => {
            prev = items;
            return items.map((it) =>
              it.id === threadId ? { ...it, labelIds: applyLabelChange(it.labelIds, change) } : it,
            );
          });
          setThread((t) =>
            t && t.id === threadId ? { ...t, labelIds: applyLabelChange(t.labelIds, change) } : t,
          );
          return commitMutation({ threadId, kind: "modifyLabels", ...change }, () =>
            modifyThreadLabels(clientId, threadId, change),
          );
        })
        .catch((err) => {
          if (prev) setCumItems(prev);
          toast({
            title: "Rangement dans la matrice échoué",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
        });
    },
    [clientId, loadTodoLabels, commitMutation, setCumItems, toast],
  );

  const handleConvertRow = useCallback(
    (row: OverlayRow, quadrant: EisenhowerQuadrant) => {
      if (row.kind === "single") assignQuadrant(row.item.id, quadrant);
    },
    [assignQuadrant],
  );

  const migrationStartedRef = useRef(false);
  useEffect(() => {
    if (!connected || !clientId || migrationStartedRef.current || !hasLegacyTodoBindings()) return;
    migrationStartedRef.current = true;
    void loadTodoLabels()
      .then((labels) =>
        migrateLegacyTodoBindings(labels, (id, change) => modifyThreadLabels(clientId, id, change)),
      )
      .then((n) => {
        if (n === 0) return;
        toast({ title: `${n} email(s) déplacé(s) vers les labels Todo` });
        void loadList(query);
      })
      .catch(() => {
        migrationStartedRef.current = false;
      });
  }, [connected, clientId, loadTodoLabels, toast, loadList, query]);

  // ── Réponse envoyée : re-fetch fil + liste ─────────────────────────────────
  const handleReplied = useCallback(() => {
    const id = selectedThreadId;
    const group = selectedGroup;
    const wishToken = reqRef.current;
    void loadList(query).then(() => {
      if (!id) return;
      if (reqRef.current !== wishToken) return;
      setSelectedGroup(group);
      setSelectedThreadId(id);
      const reqId = ++reqRef.current;
      getThread(clientId, id)
        .then((t) => {
          if (reqId !== reqRef.current) return;
          setThread(t);
        })
        .catch(() => {
          /* re-fetch best-effort : la liste rechargée reflète déjà l'envoi */
        });
    });
  }, [clientId, selectedThreadId, selectedGroup, query, loadList]);

  // Triage émis DEPUIS le fil ouvert (TriageBar a déjà poussé Gmail).
  const handleTriaged = useCallback(
    (action: TriageAction) => {
      const id = selectedThreadId;
      setSelectedThreadId(null);
      setThread(null);
      if (!id) return;
      if (action === "done") stripTodoLabels(id);
      dropThreadFromList(id);
      bumpTriaged();
      patchMirror(
        action === "delete"
          ? { threadId: id, kind: "trash", dropThread: true }
          : {
              threadId: id,
              kind: "modifyLabels",
              removeLabelIds: [INBOX_LABEL],
              dropThread: true,
            },
      );
      offerUndo(id, action);
    },
    [selectedThreadId, stripTodoLabels, offerUndo, patchMirror, dropThreadFromList],
  );

  // Le fil a déjà poussé Gmail et resynchronisé ses labels (onLabelsChanged).
  const handleConvertedToTodo = useCallback(
    (
      threadId: string,
      todoLabels: GmailLabel[],
      change: { addLabelIds: string[]; removeLabelIds: string[] },
    ) => {
      for (const l of todoLabels) addLabel(l);
      patchMirror({ threadId, kind: "modifyLabels", ...change });
      setSelectedThreadId(null);
      setThread(null);
    },
    [addLabel, patchMirror],
  );

  // ── Onglet Todo ────────────────────────────────────────────────────────────
  const handleTodoOpen = useCallback(
    (threadId: string) => {
      setSelectedGroup(null);
      void openThread(threadId);
    },
    [openThread],
  );

  const handleTodoDone = useCallback(
    (item: ThreadListItem) => {
      if (!clientId) return;
      const quadrant = quadrantOfLabels(item.labelIds, todoLabelIds);
      void loadTodoLabels()
        .then(async (labels) => {
          const change = {
            addLabelIds: [],
            removeLabelIds: [...todoLabelChange(labels, null).removeLabelIds, INBOX_LABEL],
          };
          dropThreadFromList(item.id);
          bumpTriaged();
          await commitMutation({ threadId: item.id, kind: "modifyLabels", ...change }, () =>
            modifyThreadLabels(clientId, item.id, change),
          );
          const back = {
            addLabelIds: quadrant ? [labels[quadrant].id, INBOX_LABEL] : [INBOX_LABEL],
            removeLabelIds: [],
          };
          toast({
            title: TRIAGE_DONE_LABEL.done,
            duration: UNDO_TOAST_DURATION_MS,
            action: {
              label: "Annuler",
              onClick: () =>
                void commitMutation({ threadId: item.id, kind: "modifyLabels", ...back }, () =>
                  modifyThreadLabels(clientId, item.id, back),
                ).then(() => loadList(query)),
            },
          });
        })
        .catch((err) => {
          toast({
            title: "Action échouée",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
          void loadList(query);
        });
    },
    [clientId, todoLabelIds, loadTodoLabels, dropThreadFromList, commitMutation, toast, loadList, query],
  );

  const handleTodoMoveQuadrant = useCallback(
    (item: ThreadListItem, quadrant: EisenhowerQuadrant) => assignQuadrant(item.id, quadrant),
    [assignQuadrant],
  );

  // ── Curseurs clavier ───────────────────────────────────────────────────────
  useEffect(() => {
    setSelectedRowIndex((cur) => {
      if (displayRows.length === 0) return -1;
      if (cur < 0) {
        return !isMobile && !selectedThreadId && !selectedGroup ? 0 : cur;
      }
      return Math.min(cur, displayRows.length - 1);
    });
  }, [displayRows, isMobile, selectedThreadId, selectedGroup]);

  const selectedGroupKey = selectedGroup?.key ?? null;
  useEffect(() => {
    setGroupCursor(0);
  }, [selectedGroupKey]);

  useEffect(() => {
    if (!selectedGroup || pane !== "group") return;
    const el = groupScrollRef.current?.querySelector<HTMLElement>(
      `[data-mail-group-index="${groupCursor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [groupCursor, selectedGroup, pane]);

  useEffect(() => {
    setSelectedThreadIds((prev) => {
      if (prev.size === 0) return prev;
      const next = pruneSelection(prev, displayRows);
      return next.size === prev.size ? prev : next;
    });
  }, [displayRows]);

  useEffect(() => {
    if (selectedRowIndex < 0) return;
    const el = listScrollRef.current?.querySelector<HTMLElement>(
      `[data-mail-row-index="${selectedRowIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedRowIndex, displayRows]);

  useEffect(() => {
    if (!selectedThreadId) setPeekList(false);
  }, [selectedThreadId]);

  // ── Recherche ──────────────────────────────────────────────────────────────
  // Deux temps : la frappe filtre le MIRROR local (instantané, aucun réseau) ;
  // `↵` lance la recherche Gmail, qui couvre aussi ce qui n'est pas mirroré.
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSearchChange = useCallback(
    (next: string) => {
      setSearchText(next);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (isEmptyQuery(next)) {
        setLocalCount(null);
        setRemoteSearch(false);
        if (query !== DEFAULT_MAIL_QUERY) {
          setQuery(DEFAULT_MAIL_QUERY);
          void loadList(DEFAULT_MAIL_QUERY);
        } else {
          // Sortie de recherche sans changer de requête : on re-dérive la boîte
          // depuis les items déjà chargés, sans refetch.
          setRows(
      buildMailOverlay(computeVisible(cumItems), labelNames, selfAddresses, flatLabelIds()),
    );
        }
        return;
      }
      searchDebounceRef.current = setTimeout(() => {
        void searchLocal(next).then((count) => {
          setRemoteSearch(false);
          setLocalCount(count);
        });
      }, 120);
    },
    [
      query,
      loadList,
      searchLocal,
      setRows,
      computeVisible,
      flatLabelIds,
      cumItems,
      labelNames,
      selfAddresses,
    ],
  );

  const submitSearch = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) {
        setSearchText("");
        setLocalCount(null);
        setRemoteSearch(false);
        setQuery(DEFAULT_MAIL_QUERY);
        void loadList(DEFAULT_MAIL_QUERY);
        return;
      }
      pushSearchHistory(q);
      setSearchText(q);
      setRemoteSearch(true);
      setLocalCount(0);
      setQuery(q);
      void loadList(q);
    },
    [loadList],
  );

  const clearSearch = useCallback(() => {
    setSearchText("");
    setLocalCount(null);
    setRemoteSearch(false);
    setQuery(DEFAULT_MAIL_QUERY);
    void loadList(DEFAULT_MAIL_QUERY);
  }, [loadList]);

  // Les résultats Gmail remplacent les lignes : le compteur affiché suit.
  useEffect(() => {
    if (remoteSearch) setLocalCount(rows.length);
  }, [rows.length, remoteSearch]);

  const searchBox = (
    <MailSearchBar
      value={searchText}
      onChange={onSearchChange}
      onSubmit={submitSearch}
      onClear={clearSearch}
      inputRef={searchInputRef}
      localCount={localCount}
      remote={remoteSearch}
      leading={
        !isMobile ? (
          <Button variant="primary" onPress={openCompose}>
            <PencilSimple size={16} /> Nouveau message
          </Button>
        ) : null
      }
    />
  );

  // ── Clavier : câblage des actions (table déclarative → handlers) ────────────
  const kbContext: MailContext = selectedThreadId ? "thread" : selectedGroup ? "group" : "list";
  // Groupe qui a la main au clavier ; null quand ← a rendu la main à la liste.
  const activeGroup = pane === "group" ? selectedGroup : null;

  /** Fil visé par une action : le fil ouvert, sinon l'item sous le curseur. */
  const targetThreadId = useCallback((): string | null => {
    if (selectedThreadId) return selectedThreadId;
    if (activeGroup) return activeGroup.items[groupCursor]?.id ?? null;
    const row = displayRows[selectedRowIndex];
    return row && row.kind === "single" ? row.item.id : null;
  }, [selectedThreadId, activeGroup, groupCursor, displayRows, selectedRowIndex]);

  /** Sujet du fil visé (pour les intitulés de menus). */
  const targetSubject = useCallback((): string => {
    if (selectedThreadId) return thread?.messages[0]?.subject ?? "";
    if (activeGroup) return activeGroup.items[groupCursor]?.subject ?? "";
    const row = displayRows[selectedRowIndex];
    return row && row.kind === "single" ? row.item.subject : "";
  }, [selectedThreadId, thread, activeGroup, groupCursor, displayRows, selectedRowIndex]);

  /** Labels courants du fil visé (étoile / non-lu depuis la liste). */
  const targetItem = useCallback((): ThreadListItem | null => {
    if (activeGroup && !selectedThreadId) return activeGroup.items[groupCursor] ?? null;
    const row = displayRows[selectedRowIndex];
    if (!selectedThreadId && row && row.kind === "single") return row.item;
    return cumItems.find((it) => it.id === selectedThreadId) ?? null;
  }, [activeGroup, selectedThreadId, groupCursor, displayRows, selectedRowIndex, cumItems]);

  /** Ouvre le fil visé puis exécute une action qui n'a de sens que fil ouvert. */
  const openThenIntent = useCallback(
    (intent: MailActionId) => {
      if (selectedThreadId) {
        const h = threadRef.current;
        if (!h) return;
        if (intent === "reply") h.focusReply();
        else if (intent === "replyAll") h.replyAll();
        else if (intent === "forward") h.forward();
        else if (intent === "label") h.openLabelPicker();
        return;
      }
      const id = targetThreadId();
      if (!id) return;
      pendingIntentRef.current = intent;
      void openThread(id);
    },
    [selectedThreadId, targetThreadId, openThread],
  );

  const moveCursor = useCallback(
    (delta: 1 | -1) => {
      // Groupe ouvert : on feuillette ses items (et on ouvre au vol si un fil
      // est déjà affiché → lecture en rafale).
      if (activeGroup) {
        const items = activeGroup.items;
        if (items.length === 0) return;
        const next = Math.min(Math.max(groupCursor + delta, 0), items.length - 1);
        setGroupCursor(next);
        if (selectedThreadId) {
          const it = items[next];
          if (it) void openThread(it.id);
        }
        return;
      }
      // Fil ouvert hors groupe : on feuillette les lignes `single` de la liste.
      if (selectedThreadId) {
        const singles: number[] = [];
        for (let i = 0; i < displayRows.length; i++) {
          if (displayRows[i]?.kind === "single") singles.push(i);
        }
        const openRowIndex = displayRows.findIndex(
          (r) => r.kind === "single" && r.item.id === selectedThreadId,
        );
        const cur = singles.indexOf(openRowIndex);
        const pos = cur < 0 ? 0 : Math.min(Math.max(cur + delta, 0), singles.length - 1);
        const ri = singles[pos];
        if (ri == null) return;
        const r = displayRows[ri];
        if (r && r.kind === "single") {
          setSelectedRowIndex(ri);
          void openThread(r.item.id);
        }
        return;
      }
      setSelectedRowIndex((cur) =>
        displayRows.length === 0
          ? -1
          : cur < 0
            ? 0
            : Math.min(Math.max(cur + delta, 0), displayRows.length - 1),
      );
    },
    [activeGroup, groupCursor, selectedThreadId, displayRows, openThread],
  );

  const keyboardHandlers = useMemo<Partial<Record<MailActionId, () => void>>>(() => {
    const fileTodo = (quadrant: EisenhowerQuadrant) => () => {
      if (selectedThreadId) {
        threadRef.current?.fileTodo(quadrant);
        return;
      }
      const it = targetItem();
      if (it) assignQuadrant(it.id, quadrant);
    };
    const triage = (action: TriageAction) => () => {
      const id = targetThreadId();
      if (id) triageThread(id, action);
    };
    return {
      next: () => moveCursor(1),
      prev: () => moveCursor(-1),
      open: () => {
        if (activeGroup) {
          const it = activeGroup.items[groupCursor];
          if (it) void openThread(it.id);
          return;
        }
        const row = displayRows[selectedRowIndex];
        if (row) onPick(row);
      },
      close: () => {
        if (selectedThreadId) closeThread();
        else if (selectedGroup) setSelectedGroup(null);
      },
      paneGroup: () => {
        if (!selectedGroup?.items.length) return;
        setPane("group");
        setGroupCursor(0);
      },
      paneList: () => {
        if (!selectedGroup) return;
        setPane("list");
        const i = displayRows.findIndex((r) => r.kind === "group" && r.key === selectedGroup.key);
        if (i >= 0) setSelectedRowIndex(i);
      },
      goInbox: () => {
        setMailTab("inbox");
        resetSelection();
      },
      goTodo: () => {
        setMailTab("todo");
        resetSelection();
      },
      goStarred: () => submitSearch("is:starred"),
      archive: triage("archive"),
      done: triage("done"),
      snooze: triage("snooze"),
      delete: triage("delete"),
      snoozeMenu: () => {
        const id = targetThreadId();
        if (id) setSnoozeTarget({ id, subject: targetSubject() });
      },
      markUnread: () => {
        if (selectedThreadId) {
          threadRef.current?.markUnread();
          return;
        }
        const it = targetItem();
        if (it) handleMarkRowRead({ kind: "single", item: it }, false);
      },
      star: () => {
        if (selectedThreadId) {
          threadRef.current?.toggleStar();
          return;
        }
        const it = targetItem();
        if (it) toggleRowStar(it.id, it.labelIds);
      },
      label: () => openThenIntent("label"),
      todoDo: fileTodo("do"),
      todoSchedule: fileTodo("schedule"),
      todoDelegate: fileTodo("delegate"),
      todoEliminate: fileTodo("eliminate"),
      mute: () => {
        const id = targetThreadId();
        if (!id) return;
        muteThread(id);
        triageThread(id, "archive");
        toast({ title: "Fil ignoré", description: "Ses prochains messages seront archivés." });
      },
      spam: () => {
        const id = targetThreadId();
        if (!id || !clientId) return;
        dropThreadFromList(id);
        void markThreadSpam(clientId, id)
          .then(() => {
            patchMirror({
              threadId: id,
              kind: "modifyLabels",
              removeLabelIds: [INBOX_LABEL],
              dropThread: true,
            });
            setLiveMessage("Email signalé comme spam");
            toast({ title: "Signalé comme spam" });
          })
          .catch((err) => {
            toast({
              title: "Signalement échoué",
              description: err instanceof Error ? err.message : String(err),
              variant: "danger",
            });
            void loadList(query);
          });
      },
      select: () => {
        if (selectedRowIndex < 0) {
          const first = displayRows[0];
          setSelectedRowIndex(displayRows.length === 0 ? -1 : 0);
          if (first) toggleRowSelected(first);
          return;
        }
        const row = displayRows[selectedRowIndex];
        if (row) toggleRowSelected(row);
      },
      undo: () => {
        const last = lastUndoableRef.current;
        if (last && Date.now() - last.at < UNDO_WINDOW_MS) {
          performUndo(last.id, last.action, last.opId);
        }
      },
      reply: () => openThenIntent("reply"),
      replyAll: () => openThenIntent("replyAll"),
      forward: () => openThenIntent("forward"),
      compose: openCompose,
      aiDraft: () => void drafts.generate(),
      search: () => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      },
      assistant: () => {
        if (aiConfigured && accountId) setAssistantOpen((v) => !v);
      },
      help: () => setHelpOpen(true),
    };
  }, [
    moveCursor,
    selectedGroup,
    activeGroup,
    groupCursor,
    displayRows,
    selectedRowIndex,
    selectedThreadId,
    openThread,
    onPick,
    closeThread,
    resetSelection,
    submitSearch,
    loadList,
    query,
    targetThreadId,
    targetSubject,
    targetItem,
    triageThread,
    assignQuadrant,
    handleMarkRowRead,
    toggleRowStar,
    openThenIntent,
    toggleRowSelected,
    performUndo,
    openCompose,
    drafts,
    aiConfigured,
    accountId,
    clientId,
    dropThreadFromList,
    patchMirror,
    toast,
  ]);

  // Clavier actif sur desktop uniquement, et jamais par-dessus une modale.
  const chordPrefix = useMailKeyboard({
    enabled:
      !isMobile &&
      connected &&
      !captureOpen &&
      !composeOpen &&
      !helpOpen &&
      // L'assistant est un panneau par-dessus la boîte : laisser `e` archiver
      // le fil resté derrière serait une action invisible.
      !assistantOpen &&
      snoozeTarget === null,
    context: kbContext,
    handlers: keyboardHandlers,
  });

  // ── Scroll infini (chemin live : recherche / mode limité) ──────────────────
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = listScrollRef.current;
    if (!el || !root || !nextPageToken) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore(query);
      },
      { root, rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextPageToken, loadMore, query, rows.length]);

  const handleCaptureNote = async () => {
    const msg = thread?.messages[0];
    if (!msg) return;
    try {
      const id = await captureToNote(msg);
      toast({ title: "Note créée depuis l'email", description: "Dans Inbox." });
      navigate(`/notes/${id}`);
    } catch (err) {
      toast({
        title: "Échec de la capture",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  // Volet liste actif : le groupe ouvert perd son surlignage, sinon il masquerait
  // l'anneau du curseur posé dessus par ←.
  const activeKey = activeGroup?.key ?? (selectedThreadId ? `t:${selectedThreadId}` : undefined);

  // Barre d'actions groupées (desktop uniquement).
  const bulkBar =
    !isMobile && selectedThreadIds.size > 0 ? (
      <div
        className="sn-overlay-in flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--accent-subtle)" }}
      >
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="Tout désélectionner"
          onPress={clearSelection}
        >
          <X size={16} />
        </Button>
        <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
          {selectedThreadIds.size} sélectionné{selectedThreadIds.size > 1 ? "s" : ""}
        </span>
        <span className="flex-1" />
        <Tooltip content="Marquer lu">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Marquer lu"
            isDisabled={bulkBusy}
            onPress={() => void runBulkAction("read")}
          >
            <EnvelopeOpen size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="Archiver">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Archiver"
            isDisabled={bulkBusy}
            onPress={() => void runBulkAction("archive")}
          >
            <Archive size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="Supprimer">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="Supprimer"
            isDisabled={bulkBusy}
            onPress={() => void runBulkAction("delete")}
          >
            <Trash size={16} />
          </Button>
        </Tooltip>
      </div>
    ) : null;

  // Bandeau d'onglets « Inbox » / « Todo » / [groupes].
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "inbox", label: "Inbox" },
    { id: "todo", label: "Todo", count: todoCards.length || undefined },
    ...groups.map((g) => ({
      id: groupTabKey(g.id),
      label: g.name,
      count: filterGroupItems(cumItems, g).length || undefined,
    })),
  ];
  const tabStrip = (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div
        className="inline-flex rounded-full p-0.5"
        style={{ backgroundColor: "var(--surface-2)" }}
        role="tablist"
        aria-label="Vue mail"
      >
        {tabs.map((t) => {
          const active = mailTab === t.id;
          return (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              onPress={() => setMailTab(t.id)}
              className="sn-motion-colors whitespace-nowrap rounded-full px-3.5 py-1 text-sm font-medium"
              style={
                active
                  ? {
                      backgroundColor: "var(--surface-0)",
                      color: "var(--accent)",
                      boxShadow: "0 1px 2px rgb(0 0 0 / 0.08)",
                    }
                  : { backgroundColor: "transparent", color: "var(--text-muted)" }
              }
              aria-pressed={active}
            >
              {t.label}
              {t.count ? ` · ${t.count}` : ""}
            </Button>
          );
        })}
      </div>
      <Tooltip content="Gérer les groupes mail">
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          onPress={() => setGroupsManagerOpen(true)}
          aria-label="Gérer les groupes mail"
          className="shrink-0"
        >
          <Faders size={16} />
        </Button>
      </Tooltip>
      {/* Classement automatique : état et déclenchement manuel. */}
      {settings.gmail.autoLabel && aiConfigured && (
        <Tooltip
          content={
            autoLabel.busy
              ? "Classement en cours…"
              : autoLabel.remaining > 0
                ? `${autoLabel.remaining} email(s) à classer — cliquer pour lancer`
                : autoLabel.lastPass && autoLabel.lastPass.skipped > 0
                  ? `Tout est passé — ${autoLabel.lastPass.skipped} fil(s) laissé(s) sans tag, confiance insuffisante`
                  : "Tout est classé"
          }
        >
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            className="shrink-0"
            aria-label="Classer les emails avec l'IA locale"
            isDisabled={autoLabel.busy}
            onPress={autoLabel.runNow}
          >
            {autoLabel.busy ? (
              <Spinner size="sm" aria-hidden />
            ) : (
              <Sparkle size={16} style={autoLabel.remaining > 0 ? { color: "var(--accent)" } : undefined} />
            )}
          </Button>
        </Tooltip>
      )}
      {/* Mini-résumés de liste : état et déclenchement manuel. */}
      {settings.gmail.listSummary && aiConfigured && (
        <Tooltip
          content={
            listSummaries.busy
              ? "Résumés en cours…"
              : listSummaries.error
                ? `${listSummaries.error} — cliquer pour réessayer`
                : listSummaries.remaining > 0
                ? `${listSummaries.remaining} email(s) sans résumé — cliquer pour lancer`
                : "Tous les fils sont résumés"
          }
        >
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            className="shrink-0"
            aria-label="Résumer les emails avec l'IA locale"
            isDisabled={listSummaries.busy}
            onPress={listSummaries.runNow}
          >
            {listSummaries.busy ? (
              <Spinner size="sm" aria-hidden />
            ) : (
              <TextAlignLeft
                size={16}
                style={
                  listSummaries.error
                    ? { color: "var(--danger)" }
                    : listSummaries.remaining > 0
                      ? { color: "var(--accent)" }
                      : undefined
                }
              />
            )}
          </Button>
        </Tooltip>
      )}
      {/* Règles locales + propositions issues des gestes répétés. */}
      <Tooltip
        content={
          suggestionCount > 0
            ? `${suggestionCount} règle(s) proposée(s)`
            : "Règles de la boîte"
        }
      >
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          className="shrink-0"
          aria-label="Règles de la boîte"
          onPress={() => setRulesOpen(true)}
        >
          <Funnel size={16} style={suggestionCount > 0 ? { color: "var(--accent)" } : undefined} />
        </Button>
      </Tooltip>
      {/* Assistant de boîte (questions en langage naturel, IA locale). */}
      {aiConfigured && accountId && (
        <Tooltip content="Assistant de boîte (i)">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            className="shrink-0"
            aria-label="Ouvrir l'assistant de boîte"
            aria-pressed={assistantOpen}
            onPress={() => setAssistantOpen((v) => !v)}
          >
            <ChatCircleDots size={16} style={assistantOpen ? { color: "var(--accent)" } : undefined} />
          </Button>
        </Tooltip>
      )}
      {!isMobile && (
        <DropdownMenu
          trigger={
            <Tooltip content="Style des labels">
              <Button size="sm" variant="ghost" isIconOnly className="shrink-0" aria-label="Style des labels">
                <Palette size={16} />
              </Button>
            </Tooltip>
          }
          items={LABEL_STYLES.map((s) => ({
            key: s.id,
            label: (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={labelChipStyle(LABEL_STYLE_PREVIEW, s.id)}
              >
                <LabelMarker color={LABEL_STYLE_PREVIEW} style={s.id} size={11} />
                {s.name}
              </span>
            ),
            endContent: settings.gmail.labelStyle === s.id ? <Check size={14} /> : undefined,
            onPress: () => setLabelStyle(s.id),
          }))}
        />
      )}
      {!isMobile && (
        <Tooltip content="Raccourcis clavier (?)">
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            onPress={() => setHelpOpen(true)}
            aria-label="Afficher les raccourcis clavier"
            className="shrink-0"
          >
            <Keyboard size={16} />
          </Button>
        </Tooltip>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/* Rappels de relance en attente. */}
        <MailFollowupBadge onOpenThread={(id) => void openThread(id)} />
        {/* Envois programmés / en échec (file d'envoi différé). */}
        <MailOutgoingBadge />
        {accountId ? <MailOutboxBadge accountId={accountId} clientId={clientId} /> : null}
      </div>
      <MailRulesManager
        isOpen={rulesOpen}
        onClose={() => setRulesOpen(false)}
        labelNames={labelNames}
      />
      <MailGroupsManager
        isOpen={groupsManagerOpen}
        onClose={() => setGroupsManagerOpen(false)}
        labelNames={labelNames}
      />
    </div>
  );

  // Écran « inbox zero » : arriver à zéro doit valoir quelque chose.
  const inboxZero = (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <Confetti size={34} weight="duotone" style={{ color: "var(--accent)" }} aria-hidden />
      <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        Boîte vide — tu es à jour.
      </p>
      {dayStats.triaged > 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {dayStats.triaged} email{dayStats.triaged > 1 ? "s" : ""} traité
          {dayStats.triaged > 1 ? "s" : ""} aujourd'hui.
        </p>
      )}
      <Button variant="ghost" size="sm" className="mt-1" onPress={openCompose}>
        <PencilSimple size={15} /> Écrire un message
      </Button>
    </div>
  );

  const pane1 =
    mailTab === "todo" ? (
      <div
        className="flex h-full flex-col overflow-hidden"
        style={{ borderRight: "1px solid var(--border-subtle)" }}
      >
        {isMobile && tabStrip}
        <div className="flex-1 overflow-y-auto pb-4">
          <MailEisenhowerBoard
            cards={todoCards}
            summaries={listSummaries.summaries}
            onOpen={handleTodoOpen}
            onDone={handleTodoDone}
            onMoveQuadrant={handleTodoMoveQuadrant}
          />
        </div>
      </div>
    ) : (
      <div
        className="flex h-full flex-col overflow-hidden"
        style={{ borderRight: "1px solid var(--border-subtle)" }}
      >
        {isMobile && tabStrip}
        {/* Mobile : la recherche est repliée derrière l'action d'en-tête (la
            liste garde toute la hauteur) ; desktop : toujours visible. */}
        {(!isMobile || mobileSearchOpen) && searchBox}
        {bulkBar}
        {/* `relative` = bloc englobant : sans ça, un descendant `position:absolute`
            (ex. span interne de la Checkbox HeroUI) prend `html` comme référent,
            échappe au clip de l'overflow et fait scroller TOUT le document. */}
        <div ref={listScrollRef} className="relative flex-1 overflow-y-auto px-2 pb-4">
          {/* « Tirer pour rafraîchir » : l'indicateur suit le doigt puis tourne
              pendant la resynchronisation. */}
          {(pull > 0 || refreshing) && (
            <div
              className="flex items-center justify-center overflow-hidden"
              style={{ height: pull, transition: refreshing ? "height 160ms ease-out" : undefined }}
              aria-hidden={!refreshing}
            >
              <ArrowClockwise
                size={18}
                className={refreshing ? "animate-spin" : undefined}
                style={{
                  color: "var(--accent)",
                  transform: refreshing ? undefined : `rotate(${Math.round(pull * 3)}deg)`,
                }}
              />
            </div>
          )}
          {listLoading && (
            <div aria-hidden="true" className="flex flex-col gap-1 px-2 py-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex flex-col gap-1.5 rounded-md px-3 py-2.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          )}
          {listError && (
            <p className="px-3 py-2 text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
              {listError}
            </p>
          )}
          {!listLoading && !listError && rows.length === 0 && (
            groupIdFromTab(mailTab) !== null ? (
              <EmptyState
                icon={<EnvelopeOpen size={26} />}
                title="Aucun email dans ce groupe"
                description="Ce groupe ne contient aucun fil pour l'instant."
              />
            ) : query !== DEFAULT_MAIL_QUERY ? (
              <EmptyState
                icon={<MagnifyingGlass size={26} />}
                title="Aucun résultat"
                description="Aucun email ne correspond à cette recherche."
              />
            ) : (
              inboxZero
            )
          )}
          {!listLoading && !listError && rows.length > 0 && (
            <>
              <MailOverlayList
                rows={displayRows}
                activeKey={activeKey}
                onPick={onPick}
                onToggleStar={toggleRowStar}
                labelColors={labelColors}
                selectedIndex={isMobile || activeGroup ? undefined : selectedRowIndex}
                selectedThreadIds={isMobile ? undefined : selectedThreadIds}
                onToggleRowSelection={isMobile ? undefined : toggleRowSelected}
                onConvertRowToTodo={handleConvertRow}
                onTriageRow={handleTriageRow}
                onMarkRowRead={handleMarkRowRead}
                onApplyLabel={isMobile ? undefined : handleApplyLabel}
                userLabels={labelNames}
                scrollElementRef={listScrollRef}
                onSwipeRow={isMobile ? handleSwipeRow : undefined}
                onLongPressRow={isMobile ? handleLongPressRow : undefined}
                summaries={listSummaries.summaries}
                sections={sectionMarkers}
                onToggleSection={toggleSection}
                onMarkSectionRead={markThreadsRead}
              />
              {/* Sentinelle de scroll infini (chemin live seulement : le mirror
                  charge toute la boîte d'un coup). */}
              {nextPageToken && (
                <div ref={sentinelRef} className="px-1 pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    isDisabled={moreLoading}
                    onPress={() => void loadMore(query)}
                  >
                    {moreLoading ? "Chargement…" : "Charger plus"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );

  const pane2 = selectedGroup ? (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ borderRight: "1px solid var(--border-subtle)" }}
    >
      <div ref={groupScrollRef} className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
        <MailGroupList
          title={selectedGroup.title}
          items={selectedGroup.items}
          activeThreadId={selectedThreadId ?? undefined}
          cursorIndex={isMobile || pane !== "group" ? undefined : groupCursor}
          onPick={(id) => {
            setPane("group");
            void openThread(id);
          }}
          onDeleteAll={() => void deleteGroup(selectedGroup)}
          onMarkAllRead={() => void markGroupRead(selectedGroup)}
          deleteBusy={bulkBusy}
          summaries={listSummaries.summaries}
        />
      </div>
    </div>
  ) : null;

  // Capture = action SECONDAIRE → rangée discrète.
  const captureBar = thread ? (
    <div className="flex shrink-0 items-center gap-1 px-4 pb-1 pt-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Capturer :
      </span>
      <Tooltip content="Capturer en note">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label="Capturer en note"
          className="h-7"
          onPress={() => void handleCaptureNote()}
        >
          <FilePlus size={14} />
        </Button>
      </Tooltip>
      <Tooltip content="Capturer dans une base">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label="Capturer dans une base"
          className="h-7"
          onPress={() => setCaptureOpen(true)}
          isDisabled={!thread?.messages[0]}
        >
          <Database size={14} />
        </Button>
      </Tooltip>
    </div>
  ) : null;

  // Colonne « Brouillons IA ».
  const draftsOpen = aiConfigured && (drafts.busy || drafts.variants.length > 0);
  const draftsPanel = (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <MagicWand size={15} style={{ color: "var(--accent)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Brouillons IA
        </span>
        <span className="flex-1" />
        <Checkbox
          isSelected={drafts.useNotes}
          onChange={(sel) => drafts.setUseNotes(Boolean(sel))}
          aria-label="Rédiger à partir de mes notes (RAG)"
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Mes notes
          </span>
        </Checkbox>
        <Tooltip content="Régénérer">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Régénérer les brouillons"
            isDisabled={drafts.busy}
            onPress={() => void drafts.generate()}
          >
            <ArrowsClockwise size={14} />
          </Button>
        </Tooltip>
        <Tooltip content="Fermer">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Fermer les brouillons"
            onPress={drafts.clear}
          >
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {drafts.variants.map((v) => (
          <button
            key={v.tone}
            type="button"
            onClick={() => {
              threadRef.current?.loadDraft(v.text);
              drafts.clear();
            }}
            aria-label={`Charger le brouillon ${v.label}`}
            className="group flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:border-[var(--accent)]"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--surface-0, var(--background))",
            }}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                className="inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
                style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
              >
                {v.label}
              </span>
              <span
                className="text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--accent)" }}
              >
                Utiliser →
              </span>
            </span>
            <span
              className="whitespace-pre-wrap text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {v.text}
            </span>
          </button>
        ))}
        {drafts.busy && (
          <div
            className="flex items-center gap-2 px-1 py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <Spinner size="sm" /> Génération en cours…
          </div>
        )}
      </div>
    </div>
  );

  const pane3 = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {threadLoading && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner aria-label="Chargement de l'email" />
        </div>
      )}
      {!threadLoading && threadError && (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {threadError}
          </p>
        </div>
      )}
      {!threadLoading && !threadError && thread && (
        <div
          key={selectedThreadId ?? "thread"}
          className="sn-overlay-in flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {captureBar}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              ref={threadScrollRef}
              tabIndex={-1}
              aria-label="Contenu de l'email"
              className="min-w-0 flex-1 overflow-y-auto px-4 outline-none"
            >
              <EmailThreadView
                ref={threadRef}
                thread={thread}
                selfEmail={settings.gmail.connectedEmail}
                /* La page possède le clavier (useMailKeyboard) → pas de second
                   listener dans la vue fil. */
                enableShortcuts={false}
                onTriaged={handleTriaged}
                onReplied={handleReplied}
                onLabelsChanged={syncThreadLabels}
                onForward={handleForward}
                onConvertedToTodo={handleConvertedToTodo}
                onGenerateDrafts={() => void drafts.generate()}
                draftsBusy={drafts.busy}
              />
            </div>
            {draftsOpen && !isMobile && (
              <div
                className="sn-overlay-in h-full shrink-0 overflow-hidden border-l"
                style={{
                  flexGrow: 0,
                  flexShrink: 0,
                  flexBasis: "26rem",
                  borderColor: "var(--border-subtle)",
                  background: "var(--surface-1)",
                }}
              >
                {draftsPanel}
              </div>
            )}
          </div>
        </div>
      )}
      {!threadLoading && !threadError && !thread && (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
          style={{ color: "var(--text-muted)" }}
        >
          <EnvelopeOpen size={32} weight="thin" aria-hidden />
          <p className="text-sm">Sélectionne un email pour le lire ici.</p>
        </div>
      )}
    </div>
  );

  // Surfaces globales (modales, annonces) montées quel que soit le layout.
  const overlays = (
    <>
      <CaptureEmailModal
        isOpen={captureOpen}
        message={thread?.messages[0] ?? null}
        onClose={() => setCaptureOpen(false)}
      />
      <ComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        initialTo={composeInitial.to ?? ""}
        initialSubject={composeInitial.subject}
        initialBody={composeInitial.body}
      />
      <MailShortcutsHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <MailRowSheet
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onOpen={(id) => void openThread(id)}
        onTriage={(id, action) => triageThread(id, action)}
        onSnoozeMenu={(id, subject) => setSnoozeTarget({ id, subject })}
        onToggleStar={toggleRowStar}
        onMarkRead={(item, read) => handleMarkRowRead({ kind: "single", item }, read)}
        onMute={(id) => {
          muteThread(id);
          triageThread(id, "archive");
          toast({ title: "Fil ignoré", description: "Ses prochains messages seront archivés." });
        }}
      />
      <SnoozeMenu
        isOpen={snoozeTarget !== null}
        subject={snoozeTarget?.subject}
        onClose={() => setSnoozeTarget(null)}
        onPick={(until) => {
          if (snoozeTarget) triageThread(snoozeTarget.id, "snooze", until);
        }}
      />
      {assistantOpen && accountId && (
        <div
          className="sn-overlay-in fixed inset-0 z-40 md:inset-y-0 md:left-auto md:right-0 md:w-[26rem]"
          style={{
            background: "var(--surface-1)",
            borderLeft: "1px solid var(--border-subtle)",
            boxShadow: "-12px 0 30px color-mix(in oklch, var(--text-primary) 14%, transparent)",
          }}
        >
          <MailAssistantPanel
            accountId={accountId}
            onClose={() => setAssistantOpen(false)}
            onOpenThread={(id) => {
              setAssistantOpen(false);
              void openThread(id);
            }}
          />
        </div>
      )}
      {/* Annonce du résultat des actions aux lecteurs d'écran (le triage change
          la liste sans déplacer le focus : sans ça, rien n'est signalé). */}
      <div aria-live="polite" role="status" className="sr-only">
        {liveMessage}
      </div>
      {/* Indicateur d'accord clavier en cours (« g… »). */}
      {chordPrefix && (
        <div
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-2.5 py-1 text-xs font-medium"
          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
        >
          {chordPrefix}…
        </div>
      )}
    </>
  );

  if (!connected) {
    return (
      <AppShell>
        <div className="px-4 py-10 md:px-8">
          <div className="mx-auto max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold">Mail</h1>
            <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Connecte un compte Gmail pour lire tes emails ici.
            </p>
            <Button onPress={() => navigate("/parametres")}>Connecter Gmail</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (isMobile) {
    // Mobile : afficher uniquement le volet le plus profond actif.
    if (selectedThreadId !== null) {
      return (
        <AppShell>
          <div className="relative flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button variant="ghost" size="sm" onPress={closeThread}>
                <ArrowLeft size={16} /> Retour
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{pane3}</div>
            {draftsOpen && (
              <div
                className="sn-overlay-in absolute inset-0 z-40 flex flex-col"
                style={{ background: "var(--surface-1)" }}
              >
                {draftsPanel}
              </div>
            )}
          </div>
          {overlays}
        </AppShell>
      );
    }

    if (selectedGroup !== null) {
      return (
        <AppShell>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button variant="ghost" size="sm" onPress={() => setSelectedGroup(null)}>
                <ArrowLeft size={16} /> Retour
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <MailGroupList
                title={selectedGroup.title}
                items={selectedGroup.items}
                activeThreadId={selectedThreadId ?? undefined}
                onPick={(id) => void openThread(id)}
                onDeleteAll={() => void deleteGroup(selectedGroup)}
                onMarkAllRead={() => void markGroupRead(selectedGroup)}
                deleteBusy={bulkBusy}
                summaries={listSummaries.summaries}
              />
            </div>
          </div>
          {overlays}
        </AppShell>
      );
    }

    return (
      <AppShell>
        <div className="flex h-full flex-col overflow-hidden">{pane1}</div>
        {overlays}
      </AppShell>
    );
  }

  // Desktop : la boîte reste en fond, le fil s'affiche en drawer par-dessus.
  const drawerLeft = peekList ? "62%" : "18rem";
  const slide = `left ${prefersReducedMotion() ? "0ms" : "var(--sn-dur-4)"} var(--sn-ease-out)`;

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        {tabStrip}
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {selectedThreadId ? (
            <>
              <div className="absolute inset-0 overflow-hidden">{pane1}</div>
              {!peekList && (
                <button
                  type="button"
                  onClick={closeThread}
                  aria-label="Fermer l'email (revenir à la boîte)"
                  title="Cliquer pour revenir à la boîte"
                  className="absolute inset-y-0 left-0 z-10 cursor-pointer transition-colors hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]"
                  style={{ width: drawerLeft }}
                />
              )}
              <div
                className="sn-overlay-in absolute inset-y-0 right-0 z-20 flex overflow-hidden"
                style={{
                  left: drawerLeft,
                  transition: slide,
                  background: "var(--surface-0)",
                  borderLeft: "1px solid var(--border-subtle)",
                  boxShadow: "-12px 0 30px color-mix(in oklch, var(--text-primary) 14%, transparent)",
                }}
              >
                <button
                  type="button"
                  onClick={() => setPeekList((p) => !p)}
                  aria-label={peekList ? "Replier la boîte" : "Voir la boîte"}
                  title={peekList ? "Replier la boîte" : "Voir la boîte"}
                  className="group flex h-full w-4 shrink-0 items-center justify-center border-r transition-colors hover:bg-[var(--accent-subtle)]"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
                >
                  {peekList ? (
                    <CaretDoubleRight
                      size={12}
                      weight="bold"
                      className="group-hover:text-[var(--accent)]"
                      style={{ color: "var(--text-muted)" }}
                    />
                  ) : (
                    <CaretDoubleLeft
                      size={12}
                      weight="bold"
                      className="group-hover:text-[var(--accent)]"
                      style={{ color: "var(--text-muted)" }}
                    />
                  )}
                </button>
                {selectedGroup && (
                  <div className="h-full shrink-0 overflow-hidden" style={{ flexBasis: "18rem" }}>
                    {pane2}
                  </div>
                )}
                <div className="h-full min-w-0 flex-1 overflow-hidden">{pane3}</div>
              </div>
            </>
          ) : selectedGroup ? (
            <>
              <div className="h-full shrink-0 overflow-hidden" style={{ flexBasis: "50%" }}>
                {pane1}
              </div>
              <div className="h-full min-w-0 flex-1 overflow-hidden">{pane2}</div>
            </>
          ) : (
            <>
              <div className="h-full shrink-0 overflow-hidden" style={{ flexBasis: "50%" }}>
                {pane1}
              </div>
              <div className="h-full min-w-0 flex-1 overflow-hidden">{pane3}</div>
            </>
          )}
        </div>
      </div>
      {overlays}
    </AppShell>
  );
}
