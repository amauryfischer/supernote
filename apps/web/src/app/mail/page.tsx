import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button, Input, Spinner, Checkbox } from "@heroui/react";
import { FilePlus, Database, ArrowLeft, MagnifyingGlass, PencilSimple, Archive, Trash, EnvelopeOpen, X, CaretDoubleRight, CaretDoubleLeft, MagicWand, ArrowsClockwise } from "@phosphor-icons/react";
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
import { listThreadSummariesPage, listLabels, getThread, modifyThreadLabels, markThreadRead, markThreadUnread, toggleStar, type EmailThread, type GmailLabelColor, type ThreadListItem } from "@/lib/gmail";
import { listDue, removeSnooze, addSnooze, applyTriage, undoTriage, INBOX_LABEL, SNOOZE_PRESETS, type TriageAction } from "@/lib/mail-triage";
import { useConvertToTodo } from "@/components/mail/useConvertToTodo";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";
import { draftReplyVariants, type ReplyVariant, type MailAiThread, isAiConfigured } from "@/lib/mail-ai";
import { pickReplyTo } from "@/lib/mail-reply";
import { toggleRowSelection, pruneSelection } from "@/lib/mail-selection";
import {
  loadBindings,
  getBinding,
  removeBinding,
  updateBindingQuadrant,
  type MailTodoBinding,
} from "@/lib/mail-todo-binding";
import { quadrantToTodoFields, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { prefersReducedMotion } from "@/lib/motion";
import { useToast, Tooltip } from "@supernote/ui";

const DEFAULT_MAIL_QUERY = "in:inbox";

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

export default function MailPage() {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Mail" : null);

  const clientId = settings.googleDrive.clientId.trim();
  const connected = useGmailConnected();
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
  const listScrollRef = useRef<HTMLDivElement | null>(null);
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

  // Onglet du pane gauche : « inbox » (liste Gmail, défaut) ou « todo » (grille
  // Eisenhower des emails convertis en tâches, alimentée par le store local).
  const [mailTab, setMailTab] = useState<"inbox" | "todo">("inbox");
  // Miroir local des liaisons thread ↔ todo (source de vérité = localStorage).
  // Rechargé à l'ouverture de l'onglet Todo et après chaque mutation optimiste.
  const [todoBindings, setTodoBindings] = useState<MailTodoBinding[]>([]);
  const refreshTodoBindings = useCallback(() => setTodoBindings(loadBindings()), []);

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

  const loadList = useCallback(
    async (q: string) => {
      const reqId = ++loadReqRef.current;
      setListLoading(true);
      setListError(null);
      setSelectedGroup(null);
      setSelectedThreadId(null);
      setThread(null);
      try {
        const [page, labels] = await Promise.all([
          listThreadSummariesPage(clientId, q),
          listLabels(clientId).catch(() => [] as Awaited<ReturnType<typeof listLabels>>),
        ]);
        // Un rechargement plus récent a démarré entre-temps → on n'écrase pas son
        // état (rows / curseur / labels / pagination) avec une réponse périmée.
        if (reqId !== loadReqRef.current) return;
        const names = new Map(labels.map((l) => [l.id, l.name]));
        setLabelNames(names);
        setLabelColors(
          new Map(labels.flatMap((l) => (l.color ? [[l.id, l.color] as const] : []))),
        );
        setCumItems(page.items);
        setNextPageToken(page.nextPageToken);
        // Sécurité : exclut de l'inbox les fils déjà convertis en tâche (binding
        // local) — au cas où un fil todo'd traînerait encore dans la liste.
        const visible = page.items.filter((it) => !getBinding(it.id));
        setRows(buildMailOverlay(visible, names, selfAddresses));
      } catch (err) {
        if (reqId !== loadReqRef.current) return;
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reqId === loadReqRef.current) setListLoading(false);
      }
    },
    [clientId, selfAddresses],
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
      const page = await listThreadSummariesPage(clientId, query, { pageToken: nextPageToken });
      setCumItems((prev) => {
        const seen = new Set(prev.map((it) => it.id));
        const merged = [...prev, ...page.items.filter((it) => !seen.has(it.id))];
        // Même exclusion que loadList : on cache les fils déjà convertis en tâche.
        const visible = merged.filter((it) => !getBinding(it.id));
        setRows(buildMailOverlay(visible, labelNames, selfAddresses));
        return merged;
      });
      setNextPageToken(page.nextPageToken);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoreLoading(false);
    }
  }, [clientId, query, nextPageToken, moreLoading, labelNames, selfAddresses]);

  useEffect(() => {
    if (connected) void loadList(DEFAULT_MAIL_QUERY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

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
    setThreadLoading(true);
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
    try {
      const t = await getThread(clientId, threadId);
      // Un fil plus récent a été ouvert pendant le fetch → on ignore ce résultat
      // périmé pour ne pas écraser le fil courant.
      if (reqId !== reqRef.current) return;
      setThread(t);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      setThreadError(err instanceof Error ? err.message : String(err));
    } finally {
      if (reqId === reqRef.current) setThreadLoading(false);
    }
  };

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

  // Mécanisme « Annuler » (toast-action) : après un triage réussi, on affiche un
  // toast ~6 s avec un bouton « Annuler ». Au clic, on défait la mutation Gmail
  // (undoTriage : ré-ajoute INBOX ; untrash pour delete ; purge snooze) puis on
  // recharge la liste — le plus simple pour RE-AFFICHER le fil restauré (l'undo
  // a pu changer l'ordre / le snippet / les labels). On choisit le toast-action
  // plutôt qu'une bannière inline car `useToast` (@supernote/ui) supporte
  // nativement `action: { label, onClick }` et `duration` — pas de surface UI à
  // maintenir, cohérent avec les autres notifications de la page.
  const offerUndo = useCallback(
    (id: string, action: TriageAction) => {
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
            undoTriage(clientId, id, action)
              .then(() => {
                // Re-affiche le fil restauré : la liste est la source de vérité.
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
    [clientId, toast, loadList, query],
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
      applyTriage(clientId, id, action)
        .then(() => {
          offerUndo(id, action);
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
    [rows, clientId, dropThreadFromList, toast, loadList, query, offerUndo],
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
        await Promise.all(
          ids.map((id) =>
            kind === "read"
              ? markThreadRead(clientId, id)
              : applyTriage(clientId, id, kind === "delete" ? "delete" : "archive"),
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
    [clientId, selectedThreadIds, bulkBusy, dropThreadFromList, toast, loadList, query],
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
        await Promise.all(ids.map((id) => applyTriage(clientId, id, "delete")));
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
    [clientId, bulkBusy, confirm, dropThreadFromList, toast, loadList, query],
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
        await Promise.all(ids.map((id) => markThreadRead(clientId, id)));
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
    [clientId, toast, loadList, query],
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
  useEffect(() => {
    setSelectedRowIndex((cur) => {
      if (rows.length === 0) return -1;
      if (cur < 0) return cur; // pas encore activé : on ne force pas une sélection
      return Math.min(cur, rows.length - 1);
    });
  }, [rows]);

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

      switch (e.key) {
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
          // Échap ferme d'abord l'overlay liste, sinon vide la sélection.
          if (peekList) {
            e.preventDefault();
            setPeekList(false);
          } else if (selectedThreadIds.size > 0) {
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
    triageRowAt,
    toggleRowSelected,
    toggleSelectedRowAtCursor,
    clearSelection,
    selectedThreadIds,
    peekList,
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
      offerUndo(id, action);
    },
    [selectedThreadId, offerUndo],
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
    // Resynchronise le miroir local des liaisons : la nouvelle tâche y figure.
    refreshTodoBindings();
  }, [selectedThreadId, refreshTodoBindings]);

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

  // Resynchronise les labelIds optimistes d'un thread (étoile / non-lu) dans la
  // liste de gauche, le groupe ouvert et le fil ouvert — sans rechargement.
  const syncThreadLabels = useCallback((id: string, labelIds: string[]) => {
    const apply = (it: ThreadListItem): ThreadListItem =>
      it.id === id ? { ...it, labelIds } : it;
    setRows((rs) =>
      rs.map<OverlayRow>((r) =>
        r.kind === "single"
          ? r.item.id === id
            ? { ...r, item: apply(r.item) }
            : r
          : r.items.some((it) => it.id === id)
            ? { ...r, items: r.items.map(apply) }
            : r,
      ),
    );
    setSelectedGroup((g) =>
      g && g.items.some((it) => it.id === id) ? { ...g, items: g.items.map(apply) } : g,
    );
    setThread((t) =>
      t && t.id === id
        ? { ...t, labelIds, messages: t.messages.map((m) => ({ ...m })) }
        : t,
    );
  }, []);

  // Toggle étoile depuis une ligne de la liste (optimiste, sans ouvrir le fil).
  const toggleRowStar = useCallback(
    (id: string, current: string[]) => {
      if (!clientId) return;
      const next = !current.includes("STARRED");
      const nextIds = next ? [...current, "STARRED"] : current.filter((l) => l !== "STARRED");
      syncThreadLabels(id, nextIds);
      toggleStar(clientId, id, next).catch((err) => {
        syncThreadLabels(id, current);
        toast({
          title: next ? "Ajout de l'étoile échoué" : "Retrait de l'étoile échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      });
    },
    [clientId, syncThreadLabels, toast],
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
        if (ok) dropThreadFromList(it.id);
      });
    },
    [convertRowToTodo, dropThreadFromList],
  );

  // Triage rapide d'une ligne single (Fait/Archiver/Reporter/Supprimer), optimiste
  // + Annuler. Pour le snooze, on note l'échéance avant la mutation (rollback si KO).
  const handleTriageRow = useCallback(
    (row: OverlayRow, action: TriageAction, until?: number) => {
      if (row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      dropThreadFromList(id);
      if (action === "snooze" && until != null) addSnooze(id, until);
      applyTriage(clientId, id, action)
        .then(() => offerUndo(id, action))
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
    [clientId, dropThreadFromList, offerUndo, toast, loadList, query],
  );

  // Marquer lu / non-lu une ligne single (optimiste + rollback).
  const handleMarkRowRead = useCallback(
    (row: OverlayRow, read: boolean) => {
      if (row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      const current = row.item.labelIds;
      const nextIds = read ? current.filter((l) => l !== "UNREAD") : [...current, "UNREAD"];
      syncThreadLabels(id, nextIds);
      (read ? markThreadRead(clientId, id) : markThreadUnread(clientId, id)).catch((err) => {
        syncThreadLabels(id, current);
        toast({
          title: read ? "Marquage « lu » échoué" : "Marquage « non lu » échoué",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        });
      });
    },
    [clientId, syncThreadLabels, toast],
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

  // Bandeau d'onglets « Inbox » / « Todo » au-dessus de la liste (pane1). Strip
  // de boutons (cohérent avec ViewTabs / la nav de /bases), pas le composant
  // Tabs : on garde la maîtrise du contenu rendu sous chaque onglet.
  const tabStrip = (
    <div className="border-b px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
      {/* Segmented control (pilule) — onglet actif = pastille surface-0 + accent. */}
      <div
        className="inline-flex rounded-full p-0.5"
        style={{ backgroundColor: "var(--surface-2)" }}
        role="tablist"
        aria-label="Vue mail"
      >
        {(
          [
            { id: "inbox" as const, label: "Inbox" },
            { id: "todo" as const, label: "Todo" },
          ] satisfies { id: "inbox" | "todo"; label: string }[]
        ).map((t) => {
          const active = mailTab === t.id;
          return (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              onPress={() => setMailTab(t.id)}
              className="sn-motion-colors rounded-full px-3.5 py-1 text-sm font-medium"
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
              {t.id === "todo" && todoBindings.length > 0 ? ` · ${todoBindings.length}` : ""}
            </Button>
          );
        })}
      </div>
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
        {!listLoading && !listError && (
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
      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-3">
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
            <div className="min-w-0 flex-1 overflow-y-auto px-4">
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
  const closeThread = () => {
    setSelectedThreadId(null);
    setThread(null);
    setPeekList(false);
  };

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
