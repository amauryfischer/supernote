import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Input } from "@heroui/react";
import { FilePlus, Database, ArrowLeft, MagnifyingGlass, PencilSimple, Archive, Trash, EnvelopeOpen, X } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { AppShell, useMobileTitle, useMobileFab } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { EmailThreadView } from "@/components/mail/EmailThreadView";
import { MailOverlayList } from "@/components/mail/MailOverlayList";
import { MailGroupList } from "@/components/mail/MailGroupList";
import { useCaptureEmail } from "@/components/mail/useCaptureEmail";
import { CaptureEmailModal } from "@/components/mail/CaptureEmailModal";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { MailEisenhowerBoard } from "@/components/mail/MailEisenhowerBoard";
import { listThreadSummariesPage, listLabels, getThread, modifyThreadLabels, markThreadRead, toggleStar, type EmailThread, type GmailLabelColor, type ThreadListItem } from "@/lib/gmail";
import { listDue, removeSnooze, applyTriage, undoTriage, INBOX_LABEL, type TriageAction } from "@/lib/mail-triage";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";
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
import { useToast } from "@supernote/ui";

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
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Mail" : null);

  const clientId = settings.googleDrive.clientId.trim();
  const connected = useGmailConnected();

  const { captureToNote } = useCaptureEmail();
  const { toast } = useToast();

  const [query, setQuery] = useState(DEFAULT_MAIL_QUERY);
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
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

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
        setRows(buildMailOverlay(visible, names, settings.gmail.connectedEmail));
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        setListLoading(false);
      }
    },
    [clientId, settings.gmail.connectedEmail],
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
        setRows(buildMailOverlay(visible, labelNames, settings.gmail.connectedEmail));
        return merged;
      });
      setNextPageToken(page.nextPageToken);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setMoreLoading(false);
    }
  }, [clientId, query, nextPageToken, moreLoading, labelNames, settings.gmail.connectedEmail]);

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
    setThreadLoading(true);
    setThreadError(null);
    setSelectedThreadId(threadId);
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
      setThread(await getThread(clientId, threadId));
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadLoading(false);
    }
  };

  const onPick = (row: OverlayRow) => {
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
    (index: number, action: "archive" | "delete") => {
      const row = rows[index];
      if (!row || row.kind !== "single" || !clientId) return;
      const id = row.item.id;
      dropThreadFromList(id);
      applyTriage(clientId, id, action)
        .then(() => {
          offerUndo(id, action);
        })
        .catch((err) => {
          toast({
            title: action === "delete" ? "Suppression échouée" : "Archivage échoué",
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
          // Échap vide la sélection si elle est active (sinon laisse passer).
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
    triageRowAt,
    toggleRowSelected,
    toggleSelectedRowAtCursor,
    clearSelection,
    selectedThreadIds,
  ]);

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

  // Après l'ENVOI d'une réponse : re-fetch le fil courant (la réponse y apparaît)
  // + recharge la liste pour refléter le nouvel état (ordre, snippet, non-lu).
  // `loadList` désélectionne le fil au passage : on le restaure ensuite pour que
  // le fil ouvert reste ouvert avec sa réponse fraîchement envoyée.
  const handleReplied = useCallback(() => {
    const id = selectedThreadId;
    void loadList(query).then(() => {
      if (!id) return;
      setSelectedThreadId(id);
      getThread(clientId, id)
        .then((t) => setThread(t))
        .catch(() => {
          /* re-fetch best-effort : la liste rechargée reflète déjà l'envoi */
        });
    });
  }, [clientId, selectedThreadId, query, loadList]);

  const activeKey = selectedGroup?.key ?? (selectedThreadId ? `t:${selectedThreadId}` : undefined);

  const searchBox = (
    <div className="flex gap-2 p-3">
      {!isMobile && (
        <Button variant="primary" onPress={openCompose}>
          <PencilSimple size={16} /> Nouveau
        </Button>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher…"
        className="flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter") void loadList(query);
        }}
      />
      <Button size="sm" variant="ghost" onPress={() => void loadList(query)} isIconOnly aria-label="Rechercher">
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
        <Button size="sm" variant="ghost" isDisabled={bulkBusy} onPress={() => void runBulkAction("read")}>
          <EnvelopeOpen size={16} /> Marquer lu
        </Button>
        <Button size="sm" variant="ghost" isDisabled={bulkBusy} onPress={() => void runBulkAction("archive")}>
          <Archive size={16} /> Archiver
        </Button>
        <Button size="sm" variant="ghost" isDisabled={bulkBusy} onPress={() => void runBulkAction("delete")}>
          <Trash size={16} /> Supprimer
        </Button>
      </div>
    ) : null;

  // Bandeau d'onglets « Inbox » / « Todo » au-dessus de la liste (pane1). Strip
  // de boutons (cohérent avec ViewTabs / la nav de /bases), pas le composant
  // Tabs : on garde la maîtrise du contenu rendu sous chaque onglet.
  const tabStrip = (
    <div
      className="flex items-center gap-1 border-b px-3 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
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
            className="sn-motion-colors sn-pressable rounded-md px-3 py-1.5 text-[13px] font-medium"
            style={
              active
                ? { backgroundColor: "var(--surface-2)", color: "var(--text-primary)" }
                : { color: "var(--text-muted)" }
            }
            aria-pressed={active}
          >
            {t.label}
            {t.id === "todo" && todoBindings.length > 0 ? ` · ${todoBindings.length}` : ""}
          </Button>
        );
      })}
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
      <div ref={listScrollRef} className="flex-1 overflow-y-auto px-2 pb-4">
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
        />
      </div>
    </div>
  ) : null;

  const captureBar = thread ? (
    <div className="flex shrink-0 gap-2 px-4 pb-2 pt-3">
      <Button variant="ghost" size="sm" onPress={() => void handleCaptureNote()}>
        <FilePlus size={16} /> Capturer en note
      </Button>
      <Button variant="ghost" size="sm" onPress={() => setCaptureOpen(true)} isDisabled={!thread?.messages[0]}>
        <Database size={16} /> Capturer dans une base
      </Button>
    </div>
  ) : null;

  const pane3 = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {threadLoading && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </p>
      )}
      {threadError && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
          {threadError}
        </p>
      )}
      {!threadLoading && !threadError && thread && (
        <div
          key={selectedThreadId ?? "thread"}
          className="sn-overlay-in flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {captureBar}
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <EmailThreadView
              thread={thread}
              selfEmail={settings.gmail.connectedEmail}
              onTriaged={handleTriaged}
              onReplied={handleReplied}
              onLabelsChanged={syncThreadLabels}
              onForward={handleForward}
              onConvertedToTodo={handleConvertedToTodo}
            />
          </div>
        </div>
      )}
      {!threadLoading && !threadError && !thread && (
        <p className="px-4 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
          Sélectionne un email.
        </p>
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
          <div className="flex h-full flex-col overflow-hidden">
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

  const basisTransition = `flex-basis ${prefersReducedMotion() ? "0ms" : "var(--sn-dur-4)"} var(--sn-ease-out)`;
  const listBasis = view === "group-thread" ? "17.5rem" : "50%";
  const groupBasis = view === "group" ? "50%" : view === "group-thread" ? "20rem" : "0px";

  return (
    <AppShell>
      <div className="flex h-full overflow-hidden">
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{ flexGrow: 0, flexShrink: 0, flexBasis: listBasis, transition: basisTransition }}
        >
          {pane1}
        </div>
        <div
          className="h-full shrink-0 overflow-hidden"
          style={{ flexGrow: 0, flexShrink: 0, flexBasis: groupBasis, transition: basisTransition }}
          aria-hidden={!selectedGroup}
        >
          {pane2}
        </div>
        <div className="h-full min-w-0 flex-1 overflow-hidden">{pane3}</div>
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
