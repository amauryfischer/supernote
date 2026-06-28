import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Spinner, Checkbox } from "@heroui/react";
import { FilePlus, Database, ArrowLeft, MagnifyingGlass, PencilSimple, Archive, Trash, EnvelopeOpen, X, CaretDoubleRight, CaretDoubleLeft, MagicWand, ArrowsClockwise, Faders } from "@phosphor-icons/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { AppShell, useMobileTitle, useMobileFab } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { useConfirm } from "@/hooks/usePrompt";
import { EmailThreadView, type EmailThreadHandle } from "@/components/mail/EmailThreadView";
import { MailOverlayList } from "@/components/mail/MailOverlayList";
import { MailGroupList } from "@/components/mail/MailGroupList";
import { useCaptureEmail } from "@/components/mail/useCaptureEmail";
import { CaptureEmailModal } from "@/components/mail/CaptureEmailModal";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { MailEisenhowerBoard } from "@/components/mail/MailEisenhowerBoard";
import { listThreadSummariesPage, listLabels, getThread, modifyThreadLabels, addThreadLabel, markThreadRead, markThreadUnread, toggleStar, type EmailThread, type GmailLabel, type GmailLabelColor, type ThreadListItem } from "@/lib/gmail";
import { listDue, removeSnooze, addSnooze, applyTriage, undoTriage, INBOX_LABEL, SNOOZE_PRESETS, type TriageAction } from "@/lib/mail-triage";
import { useConvertToTodo } from "@/components/mail/useConvertToTodo";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";
import {
  mirrorAvailable,
  mirrorListThreads,
  mirrorListLabels,
  mirrorGetThread,
  mirrorApplyMutation,
  mirrorCancelOutbox,
  type MirrorMutation,
} from "@/lib/mail-mirror";
import { syncMailbox, syncThreadDetail, flushOutbox } from "@/lib/mail-sync";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import { draftReplyVariants, type ReplyVariant, type MailAiThread, isAiConfigured } from "@/lib/mail-ai";
import { pickReplyTo } from "@/lib/mail-reply";
import { toggleRowSelection, pruneSelection } from "@/lib/mail-selection";
import {
  loadBindings,
  getBinding,
  removeBinding,
  updateBindingQuadrant,
  reconcileBindings,
  MAIL_BINDINGS_EVENT,
  type MailTodoBinding,
} from "@/lib/mail-todo-binding";
import { quadrantToTodoFields, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import {
  loadGroups,
  filterInboxItems,
  filterGroupItems,
  groupTabKey,
  groupIdFromTab,
  MAIL_GROUPS_EVENT,
  type MailGroup,
} from "@/lib/mail-groups";
import { MailGroupsManager } from "@/components/mail/MailGroupsManager";
import { MailOutboxBadge } from "@/components/mail/MailOutboxBadge";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { prefersReducedMotion } from "@/lib/motion";
import { useToast, Tooltip } from "@supernote/ui";

const DEFAULT_MAIL_QUERY = "in:inbox";

/** Nombre de fils chargés par page (chargement initial + « Charger plus »). */
const MAIL_PAGE_SIZE = 50;

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
  const { settings } = useSettings();
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
  // tôt (mirror indispo → chemin live → OAuth) et ne se relancerait jamais. On
  // re-déclenche loadList quand le worker devient prêt (event vault-ready).
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
  // effective (`query`) reste `in:inbox` quand le champ est vide : on ne montre
  // jamais la syntaxe brute « in:inbox » à l'utilisateur.
  const [searchText, setSearchText] = useState("");
  const [rows, setRows] = useState<OverlayRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Pagination « Charger plus » : items cumulés (toutes pages), map labelId→nom
  // (pour RECONSTRUIRE l'overlay sur l'ensemble cumulé), curseur page suivante.
  const [cumItems, setCumItems] = useState<ThreadListItem[]>([]);
  const [labelNames, setLabelNames] = useState<Map<string, string>>(new Map());
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [moreLoading, setMoreLoading] = useState(false);
  // Navigation clavier desktop : index de la ligne « curseur » dans `rows`
  // (distinct du fil ouvert). -1 = aucune sélection. Conteneur scrollable de la
  // liste pour le scroll-into-view de la ligne sélectionnée.
  const [selectedRowIndex, setSelectedRowIndex] = useState(-1);
  // Curseur clavier DANS un groupe ouvert (pane2). Index dans selectedGroup.items.
  // 0 par défaut à l'entrée du groupe. Conteneur scrollable du groupe pour le
  // scroll-into-view.
  const [groupCursor, setGroupCursor] = useState(0);
  const groupScrollRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  // Conteneur scrollable du fil ouvert : on s'y positionne EN BAS à l'ouverture
  // (dernier message = le plus récent) plutôt qu'en haut.
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  // Anti-course (race guards). Chaque ouverture de fil / rechargement de liste
  // s'attribue un jeton croissant ; une réponse réseau plus lente qu'un
  // souhait plus récent est ignorée (cf. emailReqIdRef de UnifiedSearchModal).
  //   reqRef     → openThread (et restauration de fil dans handleReplied)
  //   loadReqRef → loadList
  const reqRef = useRef(0);
  const loadReqRef = useRef(0);
  // Sélection multiple (desktop) : Set des threadIds cochés. Cocher un groupe
  // coche tous ses threads (cf. mail-selection). Pas activée sur mobile.
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  // Action groupée en cours (désactive la barre pendant l'appel réseau).
  const [bulkBusy, setBulkBusy] = useState(false);

  // Onglet du pane gauche : « inbox » (liste, défaut), « todo » (grille
  // Eisenhower des emails convertis), ou « g:<id> » (groupe = vue filtrée par
  // labels, cf. mail-groups). L'inbox et les groupes lisent les MÊMES items
  // (mirror INBOX) ; seul le filtre par labelId change → bascule instantanée.
  const [mailTab, setMailTab] = useState<string>("inbox");
  // Groupes mail (système zéro-inbox) : vues nommées alimentées par des labels.
  // Source de vérité = localStorage ; rechargés sur MAIL_GROUPS_EVENT.
  const [groups, setGroups] = useState<MailGroup[]>(() => loadGroups());
  const [groupsManagerOpen, setGroupsManagerOpen] = useState(false);
  useEffect(() => {
    const refresh = () => setGroups(loadGroups());
    window.addEventListener(MAIL_GROUPS_EVENT, refresh);
    return () => window.removeEventListener(MAIL_GROUPS_EVENT, refresh);
  }, []);
  // Refs lues par les reconstructions d'overlay (callbacks stables) : évitent de
  // recréer loadList/applyListData à chaque changement d'onglet ou de groupe.
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
  // Miroir local des liaisons thread ↔ todo (source de vérité = localStorage).
  // Rechargé à l'ouverture de l'onglet Todo et après chaque mutation optimiste.
  const [todoBindings, setTodoBindings] = useState<MailTodoBinding[]>([]);
  const refreshTodoBindings = useCallback(() => setTodoBindings(loadBindings()), []);
  // Résumé IA arrivé après coup (génération en tâche de fond) → recharge la
  // grille Todo pour l'afficher sans re-navigation.
  useEffect(() => {
    window.addEventListener(MAIL_BINDINGS_EVENT, refreshTodoBindings);
    return () => window.removeEventListener(MAIL_BINDINGS_EVENT, refreshTodoBindings);
  }, [refreshTodoBindings]);
  // Réconciliation localStorage ↔ coffre (dans les deux sens) :
  //   - reconstruit les liaisons manquantes (store vidé : cache, navigateur
  //     tiers, autre origine en dev) ;
  //   - élague les liaisons dont le todo est devenu `done` dans le coffre (tâche
  //     faite hors UI mail → la carte fantôme disparaît du board).
  // Rejouée au montage ET à chaque ouverture de l'onglet « Todo » (état du coffre
  // a pu changer depuis /todos sans remonter la page — SPA). L'event émis par
  // reconcileBindings rafraîchit le board via le listener ci-dessus. Best-effort :
  // pas de coffre ouvert / requête échouée → silencieux.
  useEffect(() => {
    let cancelled = false;
    void trpcVanillaClient.entities.list
      .query({ typeId: TODO_TYPE_ID })
      .then((res) => {
        if (!cancelled) reconcileBindings(res.items);
      })
      .catch(() => {
        /* pas de coffre / hors-ligne — best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [mailTab]);

  const [selectedGroup, setSelectedGroup] = useState<GroupRow | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  // Quand un fil est ouvert, la liste (et le groupe en amont) se réduit à un
  // rail de 30px — « savoir qu'elle existe ». `peekList` = on l'a dépliée par-
  // dessus le contenu (overlay) pour piocher un autre email.
  const [peekList, setPeekList] = useState(false);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  // Brouillons IA : colonne dédiée à droite du fil. Générés au niveau page (l'état
  // ne « fuit » pas dans EmailThreadView) ; `loadDraft` (ref impératif) injecte le
  // brouillon choisi dans la zone de réponse du fil.
  const threadRef = useRef<EmailThreadHandle>(null);
  const [draftVariants, setDraftVariants] = useState<ReplyVariant[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftUseNotes, setDraftUseNotes] = useState(false);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // Valeurs initiales du compose (transfert d'un message → objet/corps pré-remplis).
  const [composeInitial, setComposeInitial] = useState<{ subject: string; body: string }>({
    subject: "",
    body: "",
  });
  const [labelColors, setLabelColors] = useState<Map<string, GmailLabelColor>>(new Map());

  // Ouvre un compose vierge (« Nouveau message ») : réinitialise les valeurs
  // initiales pour ne pas réutiliser un transfert précédent.
  const openCompose = useCallback(() => {
    setComposeInitial({ subject: "", body: "" });
    setComposeOpen(true);
  }, []);

  // Transfert : pré-remplit le compose (objet « Fwd: … » + corps cité), To vide.
  const handleForward = useCallback((prefill: { subject: string; body: string }) => {
    setComposeInitial(prefill);
    setComposeOpen(true);
  }, []);

  // Action « créer » → FAB sur mobile (équivalent du bouton « Nouveau » desktop).
  useMobileFab(
    connected
      ? { icon: PencilSimple, label: "Nouveau message", onPress: openCompose }
      : null,
  );

  // Items visibles pour l'onglet ACTIF (lit des refs → callback stable) :
  //   - toujours : on retire les fils déjà convertis en tâche (binding local) ;
  //   - onglet groupe : on garde ceux portant un label du groupe ;
  //   - onglet inbox : zéro-inbox → on retire ceux portant un label ROUTÉ (ils
  //     vivent dans l'onglet de leur groupe).
  const computeVisible = useCallback((items: ThreadListItem[]): ThreadListItem[] => {
    const notTodo = items.filter((it) => !getBinding(it.id));
    const groupId = groupIdFromTab(mailTabRef.current);
    if (groupId !== null) {
      return filterGroupItems(notTodo, groupsRef.current.find((g) => g.id === groupId));
    }
    return filterInboxItems(notTodo, groupsRef.current);
  }, []);

  // Applique un jeu d'items + labels à l'état liste (rows / cumItems / labels /
  // curseur). Factorisé : utilisé par la lecture mirror ET le fetch live.
  const applyListData = useCallback(
    (items: ThreadListItem[], labels: GmailLabel[], nextToken: string | undefined) => {
      const names = new Map(labels.map((l) => [l.id, l.name]));
      setLabelNames(names);
      setLabelColors(
        new Map(labels.flatMap((l) => (l.color ? [[l.id, l.color] as const] : []))),
      );
      setCumItems(items);
      setNextPageToken(nextToken);
      setRows(buildMailOverlay(computeVisible(items), names, selfAddresses));
    },
    [selfAddresses, computeVisible],
  );

  // Chargement de la liste. Pour l'inbox (le flux « à gérer » du modèle inbox
  // zero) avec un coffre ouvert : lecture INSTANTANÉE depuis le mirror local,
  // puis reconciliation Gmail↔mirror en tâche de fond. Recherche libre / mode
  // limité (pas de worker) : fetch live Gmail comme avant.
  const loadList = useCallback(
    async (q: string) => {
      const reqId = ++loadReqRef.current;
      setListError(null);
      setSelectedGroup(null);
      setSelectedThreadId(null);
      setThread(null);

      const canMirror = q === DEFAULT_MAIL_QUERY && mirrorAvailable() && !!accountId;

      if (canMirror) {
        // 1) Affichage immédiat depuis le mirror (le `limit` couvre toute l'inbox
        //    — en inbox zero elle reste petite, pas de pagination nécessaire).
        try {
          const [items, labels] = await Promise.all([
            mirrorListThreads(accountId, { labelId: "INBOX", limit: 500 }),
            mirrorListLabels(accountId),
          ]);
          if (reqId !== loadReqRef.current) return;
          if (items.length > 0) {
            applyListData(items, labels, undefined);
            setListLoading(false);
          } else {
            setListLoading(true); // mirror vide → on attend le 1er sync
          }
        } catch {
          setListLoading(true); // mirror illisible → le sync ci-dessous reconstruit
        }
        // 2) Reconciliation en arrière-plan, puis relit le mirror (source locale).
        void syncMailbox(clientId, accountId)
          .then(async () => {
            if (reqId !== loadReqRef.current) return;
            const [items, labels] = await Promise.all([
              mirrorListThreads(accountId, { labelId: "INBOX", limit: 500 }),
              mirrorListLabels(accountId),
            ]);
            if (reqId !== loadReqRef.current) return;
            applyListData(items, labels, undefined);
          })
          .catch((err) => {
            if (reqId !== loadReqRef.current) return;
            setRows((rs) => {
              // Mirror vide ET sync échoué → on remonte l'erreur ; sinon on garde
              // l'affichage mirror (offline-friendly).
              if (rs.length === 0) {
                setListError(err instanceof Error ? err.message : String(err));
              }
              return rs;
            });
          })
          .finally(() => {
            if (reqId === loadReqRef.current) setListLoading(false);
          });
        return;
      }

      // Fallback live (recherche libre, ou pas de worker / mode limité).
      setListLoading(true);
      try {
        const [page, labels] = await Promise.all([
          listThreadSummariesPage(clientId, q, { maxResults: MAIL_PAGE_SIZE }),
          listLabels(clientId).catch(() => [] as Awaited<ReturnType<typeof listLabels>>),
        ]);
        if (reqId !== loadReqRef.current) return;
        applyListData(page.items, labels, page.nextPageToken);
      } catch (err) {
        if (reqId !== loadReqRef.current) return;
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === loadReqRef.current) setListLoading(false);
      }
    },
    [clientId, accountId, applyListData],
  );

  // Patch best-effort du mirror local après une mutation. L'UI émet déjà l'appel
  // Gmail direct (optimiste) → `enqueue: false` : on patche seulement le mirror,
  // sans ré-pousser via l'outbox. No-op en mode limité (pas de worker). Inbox
  // zero : une action done/archive/delete passe `dropThread` → le fil sort du
  // mirror (place récupérée). Toute dérive est rattrapée par la reconciliation.
  const patchMirror = useCallback(
    (m: MirrorMutation) => {
      if (!mirrorAvailable() || !accountId) return;
      void mirrorApplyMutation(accountId, { ...m, enqueue: false }).catch(() => {
        /* best-effort */
      });
    },
    [accountId],
  );

  // Pousse l'outbox vers Gmail en arrière-plan (coalescé par accountId côté
  // flushOutbox → sûr d'appeler en rafale, ex. action groupée).
  const pushOutboxNow = useCallback(() => {
    if (!mirrorAvailable() || !accountId || !clientId) return;
    void flushOutbox(clientId, accountId).catch(() => {
      /* best-effort : retry au prochain flush / sync */
    });
  }, [accountId, clientId]);

  // Write path OUTBOX-AUTHORITATIVE des mutations de la LISTE (gérées par la
  // page). Mirror dispo → persiste + enqueue outbox + push background (1 seule
  // voie, durable offline) et renvoie l'opId (pour l'Annuler). Mode limité (pas
  // de worker) → appel Gmail direct, renvoie null. Les mutations émises DEPUIS
  // EmailThreadView poussent Gmail elles-mêmes → restent en dual-write
  // (patchMirror), pas concernées ici.
  const commitMutation = useCallback(
    async (m: MirrorMutation, direct: () => Promise<void>): Promise<string | null> => {
      if (mirrorAvailable() && accountId) {
        const opId = await mirrorApplyMutation(accountId, { ...m, enqueue: true });
        pushOutboxNow();
        return opId;
      }
      await direct();
      return null;
    },
    [accountId, pushOutboxNow],
  );

  // « Charger plus » : récupère la page suivante (via nextPageToken), APPEND aux
  // items cumulés, puis RECONSTRUIT l'overlay sur l'ENSEMBLE cumulé (sinon le
  // regroupement label/expéditeur serait calculé page par page, donc faux).
  // Déduplication par id : Gmail peut renvoyer un thread déjà vu en bord de page.
  const loadMore = useCallback(async () => {
    if (!nextPageToken || moreLoading) return;
    setMoreLoading(true);
    setListError(null);
    try {
      const page = await listThreadSummariesPage(clientId, query, {
        pageToken: nextPageToken,
        maxResults: MAIL_PAGE_SIZE,
      });
      setCumItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        const merged = [...prev, ...page.items.filter((it) => !seen.has(it.id))];
        // Même filtre d'onglet que loadList (binding todo + routage zéro-inbox).
        setRows(buildMailOverlay(computeVisible(merged), labelNames, selfAddresses));
        return merged;
      });
      setNextPageToken(page.nextPageToken);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoreLoading(false);
    }
  }, [clientId, query, nextPageToken, moreLoading, labelNames, selfAddresses, computeVisible]);

  useEffect(() => {
    if (connected) void loadList(DEFAULT_MAIL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, workerReady]);

  // Bascule d'onglet inbox ↔ groupe : re-dérive les rows depuis les items DÉJÀ
  // chargés (mirror INBOX), sans refetch réseau → instantané. L'onglet todo a son
  // propre rendu (board) et ne touche pas à la liste. Re-déclenché aussi quand
  // les groupes changent (un label routé in/out modifie inbox et les groupes).
  useEffect(() => {
    if (mailTab === "todo") return;
    setRows(buildMailOverlay(computeVisible(cumItems), labelNames, selfAddresses));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailTab, groups, cumItems, labelNames, selfAddresses, computeVisible]);

  // Réveil auto des snoozes échus : au montage (compte connecté), on remet les
  // threads dont l'échéance est dépassée dans la boîte de réception, puis on
  // purge leur entrée snooze. Best-effort, non bloquant : chaque thread est
  // traité en parallèle et toute erreur réseau est avalée par thread (un échec
  // ne doit pas empêcher le réveil des autres ni perturber loadList).
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

  const openThread = async (threadId: string) => {
    const reqId = ++reqRef.current;
    setThreadError(null);
    setSelectedThreadId(threadId);
    setPeekList(false); // sélection faite → on referme l'overlay liste

    // Optimiste : ouvrir un fil le marque lu (cf. EmailThreadView) → retirer
    // UNREAD de la ligne correspondante pour que le style « non lu » disparaisse.
    setRows((rs) =>
      rs.map<OverlayRow>((r) => {
        if (r.kind === "single") {
          return r.item.id === threadId
            ? { ...r, item: { ...r.item, labelIds: r.item.labelIds.filter((id) => id !== "UNREAD") } }
            : r;
        }
        if (!r.items.some((it) => it.id === threadId)) return r;
        return {
          ...r,
          items: r.items.map((it) =>
            it.id === threadId ? { ...it, labelIds: it.labelIds.filter((id) => id !== "UNREAD") } : it,
          ),
        };
      }),
    );

    const canMirror = mirrorAvailable() && !!accountId;
    // Le fil est marqué lu à l'ouverture → patche le mirror (enqueue:false, le
    // markRead Gmail est émis par EmailThreadView).
    if (canMirror) patchMirror({ threadId, kind: "modifyLabels", removeLabelIds: ["UNREAD"] });

    // 1) Affichage instantané depuis le mirror si les messages y sont cachés.
    let shownFromMirror = false;
    if (canMirror) {
      try {
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

    // 2) Fetch live (et persistance mirror si dispo) pour rafraîchir / compléter.
    try {
      const t = canMirror
        ? await syncThreadDetail(clientId, accountId, threadId)
        : await getThread(clientId, threadId);
      // Un fil plus récent a été ouvert pendant le fetch → on ignore ce résultat
      // périmé pour ne pas écraser le fil courant.
      if (reqId !== reqRef.current) return;
      setThread(t);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      // Si on a déjà affiché la version cachée, on n'écrase pas par une erreur.
      if (!shownFromMirror) setThreadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqId === reqRef.current) setThreadLoading(false);
    }
  };

  // Ferme le fil ouvert (revient à la liste / au groupe). Hoisté en useCallback
  // pour être utilisable par le handler clavier (Échap/u) ET le rendu drawer.
  const closeThread = useCallback(() => {
    setSelectedThreadId(null);
    setThread(null);
    setThreadError(null);
    setPeekList(false);
  }, []);

  // Deep-link `/mail?thread=<id>` : ouvre directement le fil (ex. depuis une tâche
  // liée à un email dans /todos). On consomme le paramètre une fois.
  useEffect(() => {
    const tid = searchParams.get("thread");
    if (!tid || !connected || !clientId) return;
    void openThread(tid);
    const next = new URLSearchParams(searchParams);
    next.delete("thread");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, connected, clientId]);

  // À l'ouverture (ou re-fetch) d'un fil : on se place EN BAS du scroll (dernier
  // message). rAF + court délai pour rattraper les images du mail qui rallongent
  // la hauteur après le 1ᵉʳ rendu.
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

  const onPick = (row: OverlayRow) => {
    setPeekList(false); // sélection faite → referme l'overlay liste éventuel
    if (row.kind === "single") {
      setSelectedGroup(null);
      void openThread(row.item.id);
    } else {
      setSelectedGroup(row);
      setSelectedThreadId(null);
      setThread(null);
    }
  };

  // Retire un fil (par id) de la liste de gauche + désélectionne s'il était
  // ouvert. Mutualise la mécanique de `handleTriaged` pour le triage clavier sur
  // une ligne « curseur » (qui n'est pas forcément le fil ouvert).
  const dropThreadFromList = useCallback((id: string) => {
    setRows((rs) =>
      rs.flatMap<OverlayRow>((r) => {
        if (r.kind === "single") return r.item.id === id ? [] : [r];
        const items = r.items.filter((it) => it.id !== id);
        return items.length ? [{ ...r, items, count: items.length }] : [];
      }),
    );
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
  }, []);

  // Mécanisme « Annuler » (toast-action) : après un triage réussi, toast ~6 s avec
  // un bouton « Annuler ». `opId` présent = le triage est parti par l'outbox
  // (mirror) : on ANNULE l'op en attente (ack → supprimée si pas encore poussée)
  // puis on enqueue l'op inverse (ré-ajoute INBOX / untrash) — convergence quel
  // que soit l'état du push. `opId` absent (mode limité OU triage émis par
  // EmailThreadView qui a poussé Gmail lui-même) = undo Gmail direct. Dans les
  // deux cas, loadList re-affiche le fil restauré (mirror → reconciliation).
  const offerUndo = useCallback(
    (id: string, action: TriageAction, opId?: string | null) => {
      if (!clientId) {
        toast({ title: TRIAGE_DONE_LABEL[action] });
        return;
      }
      toast({
        title: TRIAGE_DONE_LABEL[action],
        duration: UNDO_TOAST_DURATION_MS,
        action: {
          label: "Annuler",
          onClick: () => {
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
                // Re-affiche le fil restauré : la liste (mirror) est la vérité.
                void loadList(query);
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
        },
      });
    },
    [clientId, accountId, toast, loadList, query, pushOutboxNow],
  );

  // Triage clavier d'une ligne « single » sélectionnée (archive `e`, delete `#`).
  // Optimiste : on retire la ligne immédiatement, puis on appelle Gmail. En cas
  // d'échec réseau on recharge la liste (source de vérité) et on prévient.
  const triageRowAt = useCallback(
    (index: number, action: TriageAction) => {
      const row = rows[index];
      if (!row || row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      dropThreadFromList(id);
      // Snooze clavier → échéance par défaut « Demain » (cf. TriageBar pour le
      // choix fin via popover). On note l'échéance AVANT la mutation, rollback
      // local en cas d'échec.
      if (action === "snooze") {
        const until = SNOOZE_PRESETS[1]!.computeUntil(new Date());
        addSnooze(id, until);
      }
      const errTitle =
        action === "delete"
          ? "Suppression échouée"
          : action === "snooze"
            ? "Report échoué"
            : action === "done"
              ? "Action échouée"
              : "Archivage échoué";
      // Outbox-authoritative : enqueue (mirror) OU appel Gmail direct (mode
      // limité). L'opId permet à l'Annuler de canceller l'op encore en attente.
      commitMutation(triageMutation(id, action), () => applyTriage(clientId, id, action))
        .then((opId) => {
          offerUndo(id, action, opId);
        })
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
    [rows, clientId, dropThreadFromList, toast, loadList, query, offerUndo, commitMutation],
  );

  // ─── Sélection multiple (desktop) ──────────────────────────────────────────
  // Bascule la sélection de TOUS les threads d'une ligne (single ou groupe).
  const toggleRowSelected = useCallback((row: OverlayRow) => {
    setSelectedThreadIds((prev) => toggleRowSelection(row, prev));
  }, []);

  const clearSelection = useCallback(() => setSelectedThreadIds(new Set()), []);

  // Coche/décoche la ligne « curseur » de la nav clavier (raccourci `x`).
  const toggleSelectedRowAtCursor = useCallback(() => {
    setSelectedRowIndex((idx) => {
      const row = rows[idx];
      if (row) setSelectedThreadIds((prev) => toggleRowSelection(row, prev));
      return idx;
    });
  }, [rows]);

  // Action groupée optimiste sur la sélection : on retire les threads de la liste
  // immédiatement, on applique l'effet (archive / delete / markRead) EN PARALLÈLE
  // sur chaque threadId, puis on recharge la liste (source de vérité). Tout échec
  // → toast + rechargement. La sélection est vidée dans tous les cas.
  const runBulkAction = useCallback(
    async (kind: "archive" | "delete" | "read") => {
      if (!clientId || selectedThreadIds.size === 0 || bulkBusy) return;
      const ids = [...selectedThreadIds];
      setBulkBusy(true);
      // Optimiste : archive/delete sortent de la liste ; markRead retire UNREAD.
      if (kind === "read") {
        setRows((rs) =>
          rs.map<OverlayRow>((r) => {
            const strip = (it: ThreadListItem): ThreadListItem =>
              ids.includes(it.id) ? { ...it, labelIds: it.labelIds.filter((l) => l !== "UNREAD") } : it;
            return r.kind === "single" ? { ...r, item: strip(r.item) } : { ...r, items: r.items.map(strip) };
          }),
        );
      } else {
        for (const id of ids) dropThreadFromList(id);
      }
      try {
        // Outbox-authoritative : chaque action passe par l'outbox (push coalescé)
        // ou Gmail direct (mode limité).
        const triage: TriageAction = kind === "delete" ? "delete" : "archive";
        await Promise.all(
          ids.map((id) =>
            kind === "read"
              ? commitMutation(
                  { threadId: id, kind: "modifyLabels", removeLabelIds: ["UNREAD"] },
                  () => markThreadRead(clientId, id),
                )
              : commitMutation(triageMutation(id, triage), () => applyTriage(clientId, id, triage)),
          ),
        );
        toast({
          title:
            kind === "read"
              ? `${ids.length} email(s) marqué(s) lu(s)`
              : kind === "delete"
                ? `${ids.length} email(s) supprimé(s)`
                : `${ids.length} email(s) archivé(s)`,
        });
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
    [clientId, selectedThreadIds, bulkBusy, dropThreadFromList, toast, loadList, query, commitMutation],
  );

  // Supprime TOUS les fils d'un groupe d'overlay en une fois. Destructif →
  // confirmation. Puis retrait optimiste + fermeture de la vue groupe (ses items
  // disparaissent), applyTriage("delete") en parallèle, et rechargement (source
  // de vérité). Échec partiel → toast danger.
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
      setSelectedGroup(null);
      setSelectedThreadId(null);
      setThread(null);
      try {
        // Pas d'« Annuler » ici → dropThread (place récupérée tout de suite).
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

  // Marque comme lus TOUS les fils non lus d'un groupe d'overlay. Optimiste :
  // retire le label système `UNREAD` des items concernés (dans `rows` ET le
  // groupe ouvert pour que l'indice non-lu disparaisse), puis markThreadRead en
  // parallèle. Échec → toast + rechargement (source de vérité).
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
            commitMutation(
              { threadId: id, kind: "modifyLabels", removeLabelIds: ["UNREAD"] },
              () => markThreadRead(clientId, id),
            ),
          ),
        );
        toast({ title: `${ids.length} marqué${ids.length > 1 ? "s" : ""} comme lu${ids.length > 1 ? "s" : ""}` });
      } catch (err) {
        toast({
          title: "Marquage « lu » partiellement échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
        void loadList(query);
      }
    },
    [clientId, toast, loadList, query, commitMutation],
  );

  // ─── Brouillons IA (colonne dédiée) ────────────────────────────────────────
  const aiConfigured = useMemo(() => isAiConfigured(), [settings.ia.ollamaModel]);
  // Adaptateur EmailThread → MailAiThread (texte brut uniquement, jamais le HTML).
  const aiThread = useMemo<MailAiThread | null>(
    () =>
      thread
        ? {
            id: thread.id,
            messages: thread.messages.map((m) => ({
              subject: m.subject,
              from: { name: m.from.name, email: m.from.email },
              date: m.date,
              bodyText: m.bodyText || m.snippet || "",
            })),
          }
        : null,
    [thread],
  );
  // Destinataire externe visé (« Nom <email> ») → oriente le brouillon vers X,
  // pas vers un associé interne (cf. pickReplyTo).
  const recipientLabel = useMemo(() => {
    if (!thread) return "";
    const to = pickReplyTo(thread, settings.gmail.connectedEmail).toLowerCase();
    if (!to) return "";
    for (const m of thread.messages) {
      if (m.from.email.toLowerCase() === to) return m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
      const a = m.to.find((x) => x.email.toLowerCase() === to);
      if (a) return a.name ? `${a.name} <${a.email}>` : a.email;
    }
    return to;
  }, [thread, settings.gmail.connectedEmail]);

  // Génère plusieurs brouillons (favorable / réservé / précisions) en séquentiel,
  // rendu progressif (chaque carte dès qu'elle est prête).
  const generateDrafts = useCallback(async () => {
    if (!aiThread || draftBusy) return;
    setDraftBusy(true);
    setDraftVariants([]);
    try {
      await draftReplyVariants(
        aiThread,
        { useNotes: draftUseNotes, ...(recipientLabel ? { recipient: recipientLabel } : {}) },
        (v) => setDraftVariants((prev) => [...prev, v]),
      );
    } catch (e) {
      toast({
        title: "Brouillon IA impossible",
        description: e instanceof Error ? e.message : "Ollama injoignable",
        variant: "danger",
      });
    } finally {
      setDraftBusy(false);
    }
  }, [aiThread, draftBusy, draftUseNotes, recipientLabel, toast]);

  // Charge le brouillon choisi dans la zone de réponse du fil (via le handle ref)
  // puis ferme la liste de propositions.
  const applyDraft = useCallback((text: string) => {
    threadRef.current?.loadDraft(text);
    setDraftVariants([]);
  }, []);

  // Reset des brouillons au changement de fil (pas de « fuite » d'un fil à l'autre).
  useEffect(() => {
    setDraftVariants([]);
    setDraftBusy(false);
  }, [selectedThreadId]);

  // Clamp/réinitialise le curseur clavier quand la liste change (recherche,
  // pagination, triage). Garde l'index dans [0, rows.length-1] ; -1 si vide.
  // Auto-active la 1ʳᵉ ligne dès qu'il y a du contenu (desktop, hors fil/groupe
  // ouvert) → curseur visible d'emblée + flèches opérantes SANS clic préalable.
  useEffect(() => {
    setSelectedRowIndex((cur) => {
      if (rows.length === 0) return -1;
      if (cur < 0) {
        return !isMobile && !selectedThreadId && !selectedGroup ? 0 : cur;
      }
      return Math.min(cur, rows.length - 1);
    });
  }, [rows, isMobile, selectedThreadId, selectedGroup]);

  // Entrée dans un groupe (ou bascule de groupe) → curseur clavier en tête.
  const selectedGroupKey = selectedGroup?.key ?? null;
  useEffect(() => {
    setGroupCursor(0);
  }, [selectedGroupKey]);

  // Scroll-into-view de l'item « curseur » du groupe ouvert (pane2).
  useEffect(() => {
    if (!selectedGroup) return;
    const el = groupScrollRef.current?.querySelector<HTMLElement>(
      `[data-mail-group-index="${groupCursor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [groupCursor, selectedGroup]);

  // Nettoie la sélection des threadIds qui ne sont plus dans la liste (après un
  // rechargement / triage). Évite d'agir sur des threads disparus.
  useEffect(() => {
    setSelectedThreadIds((prev) => {
      if (prev.size === 0) return prev;
      const next = pruneSelection(prev, rows);
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  // Scroll-into-view de la ligne sélectionnée au clavier.
  useEffect(() => {
    if (selectedRowIndex < 0) return;
    const el = listScrollRef.current?.querySelector<HTMLElement>(
      `[data-mail-row-index="${selectedRowIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedRowIndex]);

  // Triage rapide d'une ligne single (Fait/Archiver/Reporter/Supprimer), optimiste
  // + Annuler. Pour le snooze, on note l'échéance avant la mutation (rollback si KO).
  // Défini AVANT le handler clavier qui s'en sert (triage d'un item de groupe).
  const handleTriageRow = useCallback(
    (row: OverlayRow, action: TriageAction, until?: number) => {
      if (row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      dropThreadFromList(id);
      if (action === "snooze" && until != null) addSnooze(id, until);
      commitMutation(triageMutation(id, action), () => applyTriage(clientId, id, action))
        .then((opId) => offerUndo(id, action, opId))
        .catch((err) => {
          if (action === "snooze") removeSnooze(id);
          toast({
            title: "Triage échoué",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
          void loadList(query);
        });
    },
    [clientId, dropThreadFromList, offerUndo, toast, loadList, query, commitMutation],
  );

  // Navigation clavier desktop sur la liste (pas de listener sur mobile).
  // Désactivée quand le focus est dans un champ de saisie / contenteditable, ou
  // qu'une modale est ouverte (capture/compose), pour ne pas voler les frappes.
  useEffect(() => {
    if (isMobile || !connected) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (captureOpen || composeOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const key = e.key;
      const threadOpen = selectedThreadId !== null;

      // ── Contexte GROUPE (pane2) : un groupe est ouvert (avec ou sans fil). ──
      // j/k parcourent les items du groupe (et ouvrent au vol si un fil est déjà
      // ouvert → on feuillette) ; Enter ouvre ; Échap/←/h ferme le fil puis sort
      // du groupe ; e/d/#/s trient l'item sous le curseur.
      if (selectedGroup) {
        const items = selectedGroup.items;
        const openAt = (i: number) => {
          const it = items[i];
          if (it) void openThread(it.id);
        };
        const triageAt = (action: TriageAction) => {
          const it = items[groupCursor];
          if (it) {
            e.preventDefault();
            handleTriageRow({ kind: "single", item: it }, action);
          }
        };
        switch (key) {
          case "j":
          case "ArrowDown": {
            e.preventDefault();
            const n = items.length === 0 ? 0 : Math.min(groupCursor + 1, items.length - 1);
            setGroupCursor(n);
            if (threadOpen) openAt(n);
            break;
          }
          case "k":
          case "ArrowUp": {
            e.preventDefault();
            const n = Math.max(groupCursor - 1, 0);
            setGroupCursor(n);
            if (threadOpen) openAt(n);
            break;
          }
          case "Enter":
          case "o":
          case "O":
            e.preventDefault();
            openAt(groupCursor);
            break;
          case "u":
          case "U":
            if (threadOpen) {
              e.preventDefault();
              closeThread();
            }
            break;
          case "Escape":
          case "h":
          case "ArrowLeft":
            e.preventDefault();
            if (threadOpen) closeThread();
            else setSelectedGroup(null);
            break;
          case "e":
          case "E":
            triageAt("archive");
            break;
          case "d":
          case "D":
            triageAt("done");
            break;
          case "#":
            triageAt("delete");
            break;
          case "s":
          case "S":
            triageAt("snooze");
            break;
          default:
            break;
        }
        return;
      }

      // ── Contexte FIL OUVERT (single, hors groupe) : feuilleter les emails. ──
      // j/k = email suivant/précédent (parmi les lignes « single » de la liste) +
      // ouverture ; Échap/u ferme et revient à la liste ; e/d/#/s trient le fil.
      if (threadOpen) {
        const singles: number[] = [];
        for (let i = 0; i < rows.length; i++) if (rows[i]?.kind === "single") singles.push(i);
        const openRowIndex = rows.findIndex(
          (r) => r.kind === "single" && r.item.id === selectedThreadId,
        );
        const curPos = singles.indexOf(openRowIndex);
        const openSingleAt = (pos: number) => {
          if (pos < 0 || pos >= singles.length) return;
          const ri = singles[pos]!;
          const r = rows[ri];
          if (r && r.kind === "single") {
            setSelectedRowIndex(ri);
            void openThread(r.item.id);
          }
        };
        switch (key) {
          case "j":
          case "ArrowDown":
            e.preventDefault();
            openSingleAt(curPos < 0 ? 0 : Math.min(curPos + 1, singles.length - 1));
            break;
          case "k":
          case "ArrowUp":
            e.preventDefault();
            openSingleAt(curPos < 0 ? 0 : Math.max(curPos - 1, 0));
            break;
          case "Escape":
          case "u":
          case "U":
            e.preventDefault();
            closeThread();
            break;
          case "e":
          case "E":
            if (openRowIndex >= 0) {
              e.preventDefault();
              triageRowAt(openRowIndex, "archive");
            }
            break;
          case "d":
          case "D":
            if (openRowIndex >= 0) {
              e.preventDefault();
              triageRowAt(openRowIndex, "done");
            }
            break;
          case "#":
            if (openRowIndex >= 0) {
              e.preventDefault();
              triageRowAt(openRowIndex, "delete");
            }
            break;
          case "s":
          case "S":
            if (openRowIndex >= 0) {
              e.preventDefault();
              triageRowAt(openRowIndex, "snooze");
            }
            break;
          default:
            break;
        }
        return;
      }

      // ── Contexte OVERLAY (liste, rien d'ouvert) : navigation de base. ──
      switch (key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          // Première frappe sans sélection → curseur en tête ; sinon descend.
          setSelectedRowIndex((cur) =>
            rows.length === 0 ? -1 : cur < 0 ? 0 : Math.min(cur + 1, rows.length - 1),
          );
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setSelectedRowIndex((cur) =>
            rows.length === 0 ? -1 : cur < 0 ? 0 : Math.max(cur - 1, 0),
          );
          break;
        case "Enter":
        case "o":
        case "O":
        case "r":
        case "R": {
          if (selectedRowIndex < 0) return;
          const row = rows[selectedRowIndex];
          if (!row) return;
          e.preventDefault();
          onPick(row);
          break;
        }
        case "e":
        case "E":
          if (selectedRowIndex < 0) return;
          e.preventDefault();
          triageRowAt(selectedRowIndex, "archive");
          break;
        case "#":
          if (selectedRowIndex < 0) return;
          e.preventDefault();
          triageRowAt(selectedRowIndex, "delete");
          break;
        case "d":
        case "D":
          if (selectedRowIndex < 0) return;
          e.preventDefault();
          triageRowAt(selectedRowIndex, "done");
          break;
        case "s":
        case "S":
          if (selectedRowIndex < 0) return;
          e.preventDefault();
          triageRowAt(selectedRowIndex, "snooze");
          break;
        case "x":
        case "X":
          // Coche/décoche la ligne courante (sélection multiple). Active la
          // sélection même sans curseur (première frappe → tête de liste).
          e.preventDefault();
          if (selectedRowIndex < 0) {
            setSelectedRowIndex(rows.length === 0 ? -1 : 0);
            const first = rows[0];
            if (first) toggleRowSelected(first);
          } else {
            toggleSelectedRowAtCursor();
          }
          break;
        case "Escape":
          // Échap vide la sélection multiple si active.
          if (selectedThreadIds.size > 0) {
            e.preventDefault();
            clearSelection();
          }
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `onPick` est stable au sens comportemental (lit l'état via setters) ; on
    // dépend des valeurs réellement lues dans le handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isMobile,
    connected,
    captureOpen,
    composeOpen,
    rows,
    selectedRowIndex,
    selectedGroup,
    selectedThreadId,
    groupCursor,
    triageRowAt,
    handleTriageRow,
    closeThread,
    toggleRowSelected,
    toggleSelectedRowAtCursor,
    clearSelection,
    selectedThreadIds,
  ]);

  // Le rail liste n'existe que fil ouvert → pas de fil ⇒ pas de peek résiduel.
  useEffect(() => {
    if (!selectedThreadId) setPeekList(false);
  }, [selectedThreadId]);

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

  // Après un triage (Done/Archive/Snooze/Supprimer) : retire le fil de la liste +
  // désélectionne, puis propose « Annuler » (toast-action). `action` vient de
  // TriageBar via EmailThreadView.onTriaged(action).
  const handleTriaged = useCallback(
    (action: TriageAction) => {
      const id = selectedThreadId;
      setSelectedThreadId(null);
      setThread(null);
      if (!id) return;
      setRows((rs) =>
        rs.flatMap<OverlayRow>((r) => {
          if (r.kind === "single") return r.item.id === id ? [] : [r];
          const items = r.items.filter((it) => it.id !== id);
          return items.length ? [{ ...r, items }] : [];
        }),
      );
      setSelectedGroup((g) => {
        if (!g) return g;
        const items = g.items.filter((it) => it.id !== id);
        return items.length ? { ...g, items } : null;
      });
      // Inbox zero : le triage depuis le fil ouvert (EmailThreadView a déjà émis
      // l'appel Gmail) sort le fil de l'inbox → drop du mirror.
      patchMirror(
        action === "delete"
          ? { threadId: id, kind: "trash", dropThread: true }
          : { threadId: id, kind: "modifyLabels", removeLabelIds: [INBOX_LABEL], dropThread: true },
      );
      offerUndo(id, action);
    },
    [selectedThreadId, offerUndo, patchMirror],
  );

  // Après conversion d'un email en tâche Eisenhower (EmailThreadView a déjà créé
  // l'entité `todo`, enregistré la liaison et retiré `INBOX` côté Gmail) : on
  // retire le fil de la liste + on referme le fil ouvert, comme un « Fait ».
  // Pas d'« Annuler » ici (la tâche a été créée ; l'annulation serait ambiguë).
  const handleConvertedToTodo = useCallback(() => {
    const id = selectedThreadId;
    setSelectedThreadId(null);
    setThread(null);
    if (!id) return;
    setRows((rs) =>
      rs.flatMap<OverlayRow>((r) => {
        if (r.kind === "single") return r.item.id === id ? [] : [r];
        const items = r.items.filter((it) => it.id !== id);
        return items.length ? [{ ...r, items }] : [];
      }),
    );
    setSelectedGroup((g) => {
      if (!g) return g;
      const items = g.items.filter((it) => it.id !== id);
      return items.length ? { ...g, items } : null;
    });
    // Inbox zero : converti en tâche = sorti de l'inbox (INBOX retiré par
    // EmailThreadView) → drop du mirror local.
    patchMirror({ threadId: id, kind: "modifyLabels", removeLabelIds: [INBOX_LABEL], dropThread: true });
    // Resynchronise le miroir local des liaisons : la nouvelle tâche y figure.
    refreshTodoBindings();
  }, [selectedThreadId, refreshTodoBindings, patchMirror]);

  // ─── Onglet Todo : grille Eisenhower des emails convertis en tâches ──────────
  // Ouvrir un email-todo : charge le fil dans le pane de droite. La grille reste
  // affichée tant que l'onglet Todo est actif (le fil ouvert vit dans pane3).
  const handleTodoOpen = useCallback(
    (threadId: string) => {
      setSelectedGroup(null);
      void openThread(threadId);
    },
    // openThread est stable comportementalement (lit via setters / clientId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // « Fait » sur une carte : marque la tâche `done` (entities.update), retire la
  // liaison locale, et met à jour la grille de façon optimiste. Si la mise à jour
  // réseau échoue, on retire quand même la liaison (la carte ne doit pas rester
  // bloquée) mais on prévient l'utilisateur.
  const handleTodoDone = useCallback(
    (binding: MailTodoBinding) => {
      setTodoBindings((prev) => prev.filter((b) => b.threadId !== binding.threadId));
      removeBinding(binding.threadId);
      trpcVanillaClient.entities.update
        .mutate({ id: binding.todoId, fields: { done: true } })
        .then(() => {
          toast({ title: "Tâche marquée comme faite" });
        })
        .catch((err) => {
          toast({
            title: "Mise à jour de la tâche échouée",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
        });
    },
    [toast],
  );

  // « → quadrant » : reclasse la tâche. MAJ optimiste du store local + des axes
  // urgent/importance de l'entité todo (entities.update). Rollback du miroir
  // local + du store si l'appel réseau échoue.
  const handleTodoMoveQuadrant = useCallback(
    (binding: MailTodoBinding, quadrant: EisenhowerQuadrant) => {
      if (quadrant === binding.quadrant) return;
      const prevQuadrant = binding.quadrant;
      setTodoBindings((prev) =>
        prev.map((b) => (b.threadId === binding.threadId ? { ...b, quadrant } : b)),
      );
      updateBindingQuadrant(binding.threadId, quadrant);
      const axes = quadrantToTodoFields(quadrant);
      trpcVanillaClient.entities.update
        .mutate({ id: binding.todoId, fields: { urgent: axes.urgent, importance: axes.importance } })
        .catch((err) => {
          setTodoBindings((prev) =>
            prev.map((b) =>
              b.threadId === binding.threadId ? { ...b, quadrant: prevQuadrant } : b,
            ),
          );
          updateBindingQuadrant(binding.threadId, prevQuadrant);
          toast({
            title: "Déplacement de la tâche échoué",
            description: err instanceof Error ? err.message : String(err),
            variant: "danger",
          });
        });
    },
    [toast],
  );

  // Recharge le miroir des liaisons à l'entrée dans l'onglet Todo (le store a pu
  // changer via une conversion faite depuis la fiche email entre-temps).
  useEffect(() => {
    if (mailTab === "todo") refreshTodoBindings();
  }, [mailTab, refreshTodoBindings]);

  // Resynchronise les labelIds optimistes d'un thread (étoile / non-lu / ajout
  // ou retrait d'un tag) dans la liste de gauche, le groupe ouvert et le fil
  // ouvert — sans rechargement.
  //
  // On RECONSTRUIT l'overlay (et non un simple patch in-place des rows), sinon un
  // email qui gagne/perd un tag ne migre PAS dans/hors de son groupe-tag. Le
  // rebuild part des items ACTUELLEMENT AFFICHÉS (aplatis depuis `rows`) — vérité
  // déjà nettoyée des fils triés/supprimés/convertis — pour ne ressusciter aucun
  // fantôme. Re-grouper sur étoile/non-lu est un no-op (le regroupement ne dépend
  // que des tags user + expéditeur). On patche aussi `cumItems` (in-place, juste
  // l'item changé) pour rester cohérent vis-à-vis des reconstructions futures
  // (loadMore…), sans rebuild depuis lui (donc sans résurrection).
  const syncThreadLabels = useCallback(
    (id: string, labelIds: string[]) => {
      const apply = (it: ThreadListItem): ThreadListItem =>
        it.id === id ? { ...it, labelIds } : it;
      setRows((rs) => {
        const items = rs
          .flatMap((r) => (r.kind === "single" ? [r.item] : r.items))
          .map(apply);
        return buildMailOverlay(computeVisible(items), labelNames, selfAddresses);
      });
      setCumItems((items) => items.map(apply));
      setSelectedGroup((g) =>
        g && g.items.some((it) => it.id === id) ? { ...g, items: g.items.map(apply) } : g,
      );
      setThread((t) =>
        t && t.id === id
          ? { ...t, labelIds, messages: t.messages.map((m) => ({ ...m })) }
          : t,
      );
    },
    [labelNames, selfAddresses, computeVisible],
  );

  // Applique un tag (label Gmail) à un thread depuis la boîte : maj optimiste de
  // la liste cumulée + reconstruction de l'overlay (le fil migre dans le groupe-
  // tag, prioritaire sur le groupe-expéditeur), appel Gmail en fond, rollback +
  // toast si échec. Sert au drag-vers-groupe ET à l'action « Ajouter un tag » du
  // menu contextuel. Patche aussi le fil ouvert s'il s'agit du même thread.
  const handleApplyLabel = useCallback(
    (threadId: string, labelId: string) => {
      if (!clientId || !labelId) return;
      const rebuild = (items: ThreadListItem[]) =>
        setRows(buildMailOverlay(computeVisible(items), labelNames, selfAddresses));
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
      void commitMutation(
        { threadId, kind: "modifyLabels", addLabelIds: [labelId] },
        () => addThreadLabel(clientId, threadId, labelId),
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
    [clientId, labelNames, selfAddresses, toast, commitMutation, computeVisible],
  );

  // Toggle étoile depuis une ligne de la liste (optimiste, sans ouvrir le fil).
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

  // ─── Menu contextuel (clic droit) de la liste ─────────────────────────────
  const { convert: convertRowToTodo } = useConvertToTodo(clientId);

  // Convertir une ligne single en tâche Eisenhower ; au succès, retire le fil.
  const handleConvertRow = useCallback(
    (row: OverlayRow, quadrant: EisenhowerQuadrant) => {
      if (row.kind !== "single") return;
      const it = row.item;
      void convertRowToTodo({
        threadId: it.id,
        subject: it.subject,
        quadrant,
        snippet: it.snippet,
        fromName: it.from.name,
        fromEmail: it.from.email,
      }).then((ok) => {
        if (!ok) return;
        dropThreadFromList(it.id);
        // Inbox zero : converti = sorti de l'inbox (INBOX retiré par
        // convertRowToTodo) → drop du mirror local AUSSI, sinon le fil
        // réapparaîtrait au prochain `loadList` si sa liaison est perdue.
        patchMirror({ threadId: it.id, kind: "modifyLabels", removeLabelIds: [INBOX_LABEL], dropThread: true });
      });
    },
    [convertRowToTodo, dropThreadFromList, patchMirror],
  );

  // Marquer lu / non-lu une ligne single (optimiste + rollback).
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

  // Après l'ENVOI d'une réponse : re-fetch le fil courant (la réponse y apparaît)
  // + recharge la liste pour refléter le nouvel état (ordre, snippet, non-lu).
  // `loadList` désélectionne le fil au passage : on le restaure ensuite pour que
  // le fil ouvert reste ouvert avec sa réponse fraîchement envoyée.
  const handleReplied = useCallback(() => {
    const id = selectedThreadId;
    const group = selectedGroup;
    // Jeton « dernier souhait » : openThread incrémente reqRef. S'il change
    // pendant le rechargement, c'est que l'utilisateur a ouvert un autre fil →
    // on ne restaure pas l'ancien (sinon on écraserait sa navigation).
    const wishToken = reqRef.current;
    void loadList(query).then(() => {
      if (!id) return;
      if (reqRef.current !== wishToken) return;
      // Restaure le fil ouvert ET le volet groupe (loadList les a remis à null).
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

  const activeKey = selectedGroup?.key ?? (selectedThreadId ? `t:${selectedThreadId}` : undefined);

  // Lance une recherche : requête effective = texte saisi, sinon l'inbox par
  // défaut (jamais la syntaxe `in:inbox` exposée dans le champ).
  const submitSearch = () => {
    const q = searchText.trim() || DEFAULT_MAIL_QUERY;
    setQuery(q);
    void loadList(q);
  };
  // Efface la recherche → revient à l'inbox par défaut (reset direct : on ne
  // dépend pas du closure de `submitSearch` sur l'ancien `searchText`).
  const clearSearch = () => {
    setSearchText("");
    setQuery(DEFAULT_MAIL_QUERY);
    void loadList(DEFAULT_MAIL_QUERY);
  };
  const searchBox = (
    <div className="flex gap-2 p-3">
      {!isMobile && (
        <Button variant="primary" onPress={openCompose}>
          <PencilSimple size={16} /> Nouveau message
        </Button>
      )}
      <Input
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        placeholder="Rechercher dans les emails…"
        className="flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") submitSearch();
          if (e.key === "Escape" && searchText) {
            e.preventDefault();
            clearSearch();
          }
        }}
      />
      {searchText && (
        <Tooltip content="Effacer la recherche">
          <Button size="sm" variant="ghost" onPress={clearSearch} isIconOnly aria-label="Effacer la recherche">
            <X size={16} />
          </Button>
        </Tooltip>
      )}
      <Button size="sm" variant="ghost" onPress={submitSearch} isIconOnly aria-label="Rechercher">
        <MagnifyingGlass size={16} />
      </Button>
    </div>
  );

  // Barre d'actions groupées (desktop uniquement) : visible dès qu'au moins un
  // thread est sélectionné. Archiver / Supprimer / Marquer lu en parallèle.
  const bulkBar =
    !isMobile && selectedThreadIds.size > 0 ? (
      <div
        className="sn-overlay-in flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--accent-subtle)" }}
      >
        <Button size="sm" variant="ghost" isIconOnly aria-label="Tout désélectionner" onPress={clearSelection}>
          <X size={16} />
        </Button>
        <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
          {selectedThreadIds.size} sélectionné{selectedThreadIds.size > 1 ? "s" : ""}
        </span>
        <span className="flex-1" />
        <Tooltip content="Marquer lu">
          <Button size="sm" variant="ghost" isIconOnly aria-label="Marquer lu" isDisabled={bulkBusy} onPress={() => void runBulkAction("read")}>
            <EnvelopeOpen size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="Archiver">
          <Button size="sm" variant="ghost" isIconOnly aria-label="Archiver" isDisabled={bulkBusy} onPress={() => void runBulkAction("archive")}>
            <Archive size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="Supprimer">
          <Button size="sm" variant="ghost" isIconOnly aria-label="Supprimer" isDisabled={bulkBusy} onPress={() => void runBulkAction("delete")}>
            <Trash size={16} />
          </Button>
        </Tooltip>
      </div>
    ) : null;

  // Bandeau d'onglets « Inbox » / « Todo » / [groupes] au-dessus de la liste
  // (pane1). Strip de boutons (cohérent avec ViewTabs / la nav de /bases), pas le
  // composant Tabs : on garde la maîtrise du contenu rendu sous chaque onglet.
  // Compte par groupe : items du mirror portant un label du groupe (hors todo).
  const notTodoItems = cumItems.filter((it) => !getBinding(it.id));
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "inbox", label: "Inbox" },
    { id: "todo", label: "Todo", count: todoBindings.length || undefined },
    ...groups.map((g) => ({
      id: groupTabKey(g.id),
      label: g.name,
      count: filterGroupItems(notTodoItems, g).length || undefined,
    })),
  ];
  const tabStrip = (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {/* Segmented control (pilule) — onglet actif = pastille surface-0 + accent. */}
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
      {/* Gérer les groupes (zéro-inbox) : créer/éditer les vues par labels. */}
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
      {/* État de l'outbox (write path outbox-authoritative) : « N en attente » /
          « N échec(s) » + réessayer. Invisible quand tout est synchronisé. */}
      {accountId ? (
        <div className="ml-auto shrink-0">
          <MailOutboxBadge accountId={accountId} clientId={clientId} />
        </div>
      ) : null}
      <MailGroupsManager
        isOpen={groupsManagerOpen}
        onClose={() => setGroupsManagerOpen(false)}
        labelNames={labelNames}
      />
    </div>
  );

  const pane1 =
    mailTab === "todo" ? (
      <div
        className="flex h-full flex-col overflow-hidden"
        style={{ borderRight: "1px solid var(--border-subtle)" }}
      >
        {tabStrip}
        <div className="flex-1 overflow-y-auto pb-4">
          <MailEisenhowerBoard
            bindings={todoBindings}
            onOpen={handleTodoOpen}
            onDone={handleTodoDone}
            onMoveQuadrant={handleTodoMoveQuadrant}
          />
        </div>
      </div>
    ) : (
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: "1px solid var(--border-subtle)" }}>
      {tabStrip}
      {searchBox}
      {bulkBar}
      {/* `relative` = bloc englobant : sans ça, un descendant `position:absolute`
          (ex. span interne de la Checkbox HeroUI par ligne) prend `html` comme
          référent, échappe au clip de l'overflow et fait scroller TOUT le
          document (sidebar + panneaux remontent, bande blanche en bas). */}
      <div ref={listScrollRef} className="relative flex-1 overflow-y-auto px-2 pb-4">
        {listLoading && (
          <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
            Chargement…
          </p>
        )}
        {listError && (
          <p className="px-3 py-2 text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
            {listError}
          </p>
        )}
        {!listLoading && !listError && rows.length === 0 && (
          <p className="px-3 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {groupIdFromTab(mailTab) !== null
              ? "Aucun email dans ce groupe."
              : "Inbox vide — rien à traiter."}
          </p>
        )}
        {!listLoading && !listError && rows.length > 0 && (
          <>
            <MailOverlayList
              rows={rows}
              activeKey={activeKey}
              onPick={onPick}
              onToggleStar={toggleRowStar}
              labelColors={labelColors}
              selectedIndex={isMobile ? undefined : selectedRowIndex}
              selectedThreadIds={isMobile ? undefined : selectedThreadIds}
              onToggleRowSelection={isMobile ? undefined : toggleRowSelected}
              onConvertRowToTodo={handleConvertRow}
              onTriageRow={handleTriageRow}
              onMarkRowRead={handleMarkRowRead}
              onApplyLabel={isMobile ? undefined : handleApplyLabel}
              userLabels={labelNames}
            />
            {nextPageToken && (
              <div className="px-1 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  isDisabled={moreLoading}
                  onPress={() => void loadMore()}
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
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: "1px solid var(--border-subtle)" }}>
      <div ref={groupScrollRef} className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
        <MailGroupList
          title={selectedGroup.title}
          items={selectedGroup.items}
          activeThreadId={selectedThreadId ?? undefined}
          cursorIndex={isMobile ? undefined : groupCursor}
          onPick={(id) => void openThread(id)}
          onDeleteAll={() => void deleteGroup(selectedGroup)}
          onMarkAllRead={() => void markGroupRead(selectedGroup)}
          deleteBusy={bulkBusy}
        />
      </div>
    </div>
  ) : null;

  // Capture = action SECONDAIRE → rangée discrète (petits boutons muets), pour ne
  // pas concurrencer le triage/la réponse en haut du fil.
  const captureBar = thread ? (
    <div className="flex shrink-0 items-center gap-1 px-4 pb-1 pt-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Capturer :
      </span>
      <Tooltip content="Capturer en note">
        <Button variant="ghost" size="sm" isIconOnly aria-label="Capturer en note" className="h-7" onPress={() => void handleCaptureNote()}>
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

  // Colonne « Brouillons IA » : ouverte dès qu'on génère (busy) ou qu'au moins un
  // brouillon est prêt. Cartes en GRAND (texte complet, scrollable) + 1 clic charge.
  const draftsOpen = aiConfigured && (draftBusy || draftVariants.length > 0);
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
          isSelected={draftUseNotes}
          onChange={(sel) => setDraftUseNotes(Boolean(sel))}
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
            isDisabled={draftBusy}
            onPress={() => void generateDrafts()}
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
            onPress={() => setDraftVariants([])}
          >
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {draftVariants.map((v) => (
          <button
            key={v.tone}
            type="button"
            onClick={() => applyDraft(v.text)}
            aria-label={`Charger le brouillon ${v.label}`}
            className="group flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:border-[var(--accent)]"
            style={{ borderColor: "var(--border-subtle)", background: "var(--surface-0, var(--background))" }}
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
            <span className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {v.text}
            </span>
          </button>
        ))}
        {draftBusy && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
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
          {/* Ligne : fil (scroll, sticky header/composeur) + colonne BROUILLONS IA
              à droite. La colonne pousse le fil (reflow flex) sur desktop ; sur
              mobile elle s'affiche en overlay plein écran (cf. plus bas). */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Pas de pb : le composeur (sticky bottom-0) affleure le bas. */}
            <div ref={threadScrollRef} className="min-w-0 flex-1 overflow-y-auto px-4">
              <EmailThreadView
                ref={threadRef}
                thread={thread}
                selfEmail={settings.gmail.connectedEmail}
                onTriaged={handleTriaged}
                onReplied={handleReplied}
                onLabelsChanged={syncThreadLabels}
                onForward={handleForward}
                onConvertedToTodo={handleConvertedToTodo}
                onGenerateDrafts={generateDrafts}
                draftsBusy={draftBusy}
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

  if (!connected) {
    return (
      <AppShell>
        <div className="px-4 py-10 md:px-10">
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
    // Mobile : afficher uniquement le volet le plus profond actif
    if (selectedThreadId !== null) {
      return (
        <AppShell>
          <div className="relative flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  setSelectedThreadId(null);
                  setThread(null);
                }}
              >
                <ArrowLeft size={16} /> Retour
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pane3}
            </div>
            {/* Brouillons IA en plein écran sur mobile (pas de colonne). */}
            {draftsOpen && (
              <div className="sn-overlay-in absolute inset-0 z-40 flex flex-col" style={{ background: "var(--surface-1)" }}>
                {draftsPanel}
              </div>
            )}
          </div>
          <CaptureEmailModal
            isOpen={captureOpen}
            message={thread?.messages[0] ?? null}
            onClose={() => setCaptureOpen(false)}
          />
          <ComposeModal
            isOpen={composeOpen}
            onClose={() => setComposeOpen(false)}
            initialSubject={composeInitial.subject}
            initialBody={composeInitial.body}
          />
        </AppShell>
      );
    }

    if (selectedGroup !== null) {
      return (
        <AppShell>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 px-3 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setSelectedGroup(null)}
              >
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
              />
            </div>
          </div>
          <CaptureEmailModal
            isOpen={captureOpen}
            message={thread?.messages[0] ?? null}
            onClose={() => setCaptureOpen(false)}
          />
          <ComposeModal
            isOpen={composeOpen}
            onClose={() => setComposeOpen(false)}
            initialSubject={composeInitial.subject}
            initialBody={composeInitial.body}
          />
        </AppShell>
      );
    }

    return (
      <AppShell>
        <div className="flex h-full flex-col overflow-hidden">
          {pane1}
        </div>
        <CaptureEmailModal
          isOpen={captureOpen}
          message={thread?.messages[0] ?? null}
          onClose={() => setCaptureOpen(false)}
        />
      </AppShell>
    );
  }

  // Desktop : colonnes glissantes animées.
  //   list         → liste 50 % | (thread 50 % vide : placeholder)
  //   single       → liste 50 % | thread 50 %
  //   group        → liste 50 % | groupe 50 %
  //   group-thread → liste ~280px + groupe ~320px POUSSÉS à gauche | thread (reste)
  // La « poussée » émerge du reflow flex : on anime le flex-basis de chaque
  // colonne avec l'easing « liquid » de grands déplacements de layout.
  const view: "list" | "single" | "group" | "group-thread" =
    selectedGroup && selectedThreadId
      ? "group-thread"
      : selectedGroup
        ? "group"
        : selectedThreadId
          ? "single"
          : "list";

  // Fil ouvert → la BOÎTE reste en fond (vue normale, pleine largeur) et le
  // contenu de l'email s'affiche en DRAWER par-dessus (ombre à gauche), large.
  // - en lecture : la bande de boîte visible à gauche FERME le drawer au clic ;
  // - poignée : pousse le drawer à droite (`peekList`) → boîte révélée large +
  //   cliquable pour piocher un autre email.
  const drawerLeft = peekList ? "62%" : "18rem";
  const slide = `left ${prefersReducedMotion() ? "0ms" : "var(--sn-dur-4)"} var(--sn-ease-out)`;

  return (
    <AppShell>
      <div className="relative flex h-full overflow-hidden">
        {selectedThreadId ? (
          <>
            {/* La boîte, en fond, pleine largeur (vue normale) — interactive sur
                la partie laissée libre par le drawer. */}
            <div className="absolute inset-0 overflow-hidden">{pane1}</div>
            {/* Zone de fermeture : clic sur la bande de boîte visible (lecture)
                → ferme le drawer. Masquée en mode peek (boîte alors cliquable). */}
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
            {/* Contenu de l'email PAR-DESSUS, glissant. */}
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
              {/* Poignée : pousse le drawer à droite (révèle la boîte) / le ramène. */}
              <button
                type="button"
                onClick={() => setPeekList((p) => !p)}
                aria-label={peekList ? "Replier la boîte" : "Voir la boîte"}
                title={peekList ? "Replier la boîte" : "Voir la boîte"}
                className="group flex h-full w-4 shrink-0 items-center justify-center border-r transition-colors hover:bg-[var(--accent-subtle)]"
                style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
              >
                {peekList ? (
                  <CaretDoubleRight size={12} weight="bold" className="group-hover:text-[var(--accent)]" style={{ color: "var(--text-muted)" }} />
                ) : (
                  <CaretDoubleLeft size={12} weight="bold" className="group-hover:text-[var(--accent)]" style={{ color: "var(--text-muted)" }} />
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
            <div className="h-full shrink-0 overflow-hidden" style={{ flexBasis: "50%" }}>{pane1}</div>
            <div className="h-full min-w-0 flex-1 overflow-hidden">{pane2}</div>
          </>
        ) : (
          <>
            <div className="h-full shrink-0 overflow-hidden" style={{ flexBasis: "50%" }}>{pane1}</div>
            <div className="h-full min-w-0 flex-1 overflow-hidden">{pane3}</div>
          </>
        )}
      </div>
      <CaptureEmailModal
        isOpen={captureOpen}
        message={thread?.messages[0] ?? null}
        onClose={() => setCaptureOpen(false)}
      />
      <ComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        initialSubject={composeInitial.subject}
        initialBody={composeInitial.body}
      />
    </AppShell>
  );
}
