"use client";

/**
 * InboxAutoSort — passe de rangement de l'inbox par l'IA locale.
 *
 * Monté une fois dans le shell, ce composant ne rend qu'une modale (le
 * journal) : il écoute l'inactivité (pas de frappe depuis 60 s, onglet
 * visible), classe chaque note de l'inbox dans un dossier EXISTANT via
 * `classifyNoteFolder`, applique le déplacement via `entities.moveIfFree`, et
 * quand aucun dossier ne convient — ou qu'il n'en existe aucun — PROPOSE d'en
 * créer un, sans jamais le créer lui-même.
 *
 * Les gardes de REPOS (onglet au premier plan, 60 s sans frappe) ne valent que
 * pour les passes de fond : elles évitent de surprendre quelqu'un qui n'a rien
 * demandé. « Trier maintenant » les traverse — un bouton arrêté par l'obstacle
 * que l'interface vient de nommer juste au-dessus est pire que le silence.
 *
 * Trois invariants portent tout le reste, manuel compris :
 *   - rien ne bouge pendant la frappe (la première touche interrompt la passe
 *     et avorte les requêtes Ollama en vol), et une note ouverte est écartée de
 *     la passe — écartée seule, pas au prix des autres ;
 *   - aucun dossier n'apparaît sans un clic de l'utilisateur. C'est LA garde
 *     contre la prolifération de l'arborescence ; interdire la proposition
 *     rendait simplement le tri inerte sur un coffre neuf ;
 *   - aucune écriture par-dessus un chemin occupé. Le test d'occupation vit
 *     dans le worker, pas ici : côté client il serait non atomique (minutes
 *     entre le scan et l'écriture, sync distante, création à la souris) et le
 *     déplacement écrit la destination AVANT de supprimer la source — une
 *     collision détruisait deux notes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowUUpLeft, FolderSimple } from "@phosphor-icons/react";
import { Button, Modal, Tooltip, useToast } from "@supernote/ui";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
import { isWorkerReady, getLastVaultReady } from "@/lib/trpc/browser-link";
import {
  aiStatusHint,
  aiStatusLabel,
  probeAiStatus,
} from "@/components/shell/AiStatusIndicator";
import { isSystemFolder } from "@/lib/system-folders";
import { isAttachmentPath } from "@/lib/attachments-path";
import { isAiRuntimeAllowed } from "./ai-runtime";
import {
  INBOX_FOLDER,
  classifyNoteFolder,
  clearInboxSortCache,
  isInboxSortEnabled,
  isMountedFolder,
  isSortable,
  proposeFolderGroups,
} from "./inboxSort";
import {
  OPEN_JOURNAL_EVENT,
  RUN_INBOX_SORT_EVENT,
  type ProposedFolder,
  type ProposedNote,
  type SortMove,
  bindSortJournalToVault,
  folderNameKey,
  getInboxSortStatus,
  getProposedFolders,
  getRefusedFolderNames,
  getSortMoves,
  hasAnyRefusal,
  isConclusivePhase,
  isDestinationRefused,
  noteInboxSortPass,
  pendingSortMoves,
  refuseDestination,
  setInboxSortPhase,
  updateProposedFolders,
  updateSortMoves,
  useInboxSortStatus,
  useProposedFolders,
  useSortMoves,
} from "./inboxSortJournal";
import {
  FolderProposalCard,
  UNDO_PASS_EVENT,
  inboxSortStatusLabel,
  useFolderProposalActions,
} from "./InboxSortJournalEntry";
import { getOpenNoteIds } from "./openNotes";
import { openInboxSortPeers, type PeerState } from "./inboxSortPeers";

/** Inactivité clavier exigée avant une passe de repos. */
const IDLE_MS = 60_000;
/** Inactivité, plus courte, exigée pour la passe de démarrage. */
const STARTUP_IDLE_MS = 5_000;
/** Délai après le montage avant la passe de démarrage (le worker boote). */
const STARTUP_DELAY_MS = 8_000;
const POLL_MS = 5_000;
/** Deux passes ne s'enchaînent pas : l'utilisateur doit pouvoir souffler. */
const MIN_PASS_INTERVAL_MS = 5 * 60_000;
/** Plafond par passe — borne le temps machine et la taille du « Annuler ». */
const MAX_NOTES_PER_PASS = 20;
/**
 * Deux propositions au plus par passe. Sept dossiers proposés pour sept notes
 * seraient exactement la prolifération que la confirmation doit éviter.
 */
const MAX_PROPOSALS_PER_PASS = 2;
const PAGE_SIZE = 500;
/**
 * Pages lues au plus pour trouver des notes d'inbox. `listSummaries` trie par
 * `updatedAt DESC` : une seule page laisserait les vieilles notes d'inbox
 * invisibles à vie dans un coffre bien rempli, mais on s'arrête dès qu'on en
 * a assez pour la passe — en pratique, une page.
 */
const MAX_PAGES = 20;
const TOAST_DURATION_MS = 12_000;

interface NoteRow {
  id: string;
  filePath: string;
  title: string;
  body: string;
  tags: readonly string[];
}

function readTitle(fields: Record<string, unknown>, filePath: string): string {
  const t = fields["title"];
  if (typeof t === "string" && t.trim()) return t.trim();
  return filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
}

function isArchived(fields: Record<string, unknown>): boolean {
  const v = fields["archivedAt"];
  return typeof v === "string" && v.length > 0;
}

/**
 * Vrai si la note est dans l'inbox telle que l'utilisateur la voit : le
 * dossier `Inbox/`, mais aussi la racine du coffre — `adapters.ts` et l'arbre
 * du worker mappent tous deux `x.md` sur « Inbox ». Exclure la racine
 * laissait une part visible de l'inbox jamais rangée, sans explication.
 */
function isInboxPath(filePath: string): boolean {
  if (filePath.startsWith(`${INBOX_FOLDER}/`)) {
    return !filePath.slice(INBOX_FOLDER.length + 1).includes("/");
  }
  return !filePath.includes("/");
}

function allOpenHint(count: number): string {
  return count > 1
    ? "Les notes de la boîte de réception sont ouvertes — elles restent en place ; ferme-les pour qu'elles soient rangées."
    : "La note ouverte est laissée en place — ferme-la pour qu'elle soit rangée.";
}

/** Id de la note ouverte en pleine page, lu depuis l'URL (`/notes/<id>`). */
function openNoteIdFromPath(pathname: string): string | null {
  const m = /^\/notes\/([^/?#]+)/.exec(pathname);
  return m?.[1] ?? null;
}

/** Patch ciblé d'une ligne du journal (identifiée par note + horodatage). */
function markMove(move: SortMove, patch: Partial<SortMove>): void {
  updateSortMoves((prev) =>
    prev.map((m) =>
      m.noteId === move.noteId && m.at === move.at ? { ...m, ...patch } : m,
    ),
  );
}

// Garde inter-instances : StrictMode monte deux fois en dev, et deux passes
// concurrentes déplaceraient deux fois les mêmes fichiers.
let passInFlight = false;

export function InboxAutoSort() {
  const location = useLocation();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const moveMutation = trpc.entities.moveIfFree.useMutation();

  const journal = useSortMoves();
  const proposals = useProposedFolders();
  const status = useInboxSortStatus();
  // Mêmes gestes que le panneau droit, même implémentation.
  const proposalActions = useFolderProposalActions();
  const [journalOpen, setJournalOpen] = useState(false);

  // 0, pas `Date.now()` : un onglet fraîchement monté annonçait une frappe
  // qu'il n'avait pas vue, bloquant les autres onglets 60 s (famine mutuelle
  // en ouvrant un onglet toutes les 5 min). Le gate de démarrage suffit à
  // couvrir le boot.
  const lastInputRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const lastPassAtRef = useRef(0);
  const startupDoneRef = useRef(false);
  const openNoteIdRef = useRef<string | null>(null);
  /**
   * Inbox vue par la dernière passe. Le tick s'en sert pour répondre « tout est
   * ouvert » sans toucher au worker ni à Ollama — et donc sans promettre une
   * passe qui écarterait toutes les notes.
   */
  const inboxSnapshotRef = useRef<{ ids: readonly string[]; at: number }>({
    ids: [],
    at: 0,
  });
  const journalOpenRef = useRef(false);
  const aliveRef = useRef(true);
  /** Avorte les requêtes Ollama de la passe courante dès la première frappe. */
  const passAbortRef = useRef<AbortController | null>(null);
  const moveIfFreeRef = useRef(moveMutation.mutateAsync);
  moveIfFreeRef.current = moveMutation.mutateAsync;
  openNoteIdRef.current = openNoteIdFromPath(location.pathname);
  journalOpenRef.current = journalOpen;

  // Changement de coffre : le journal porte des ids du coffre précédent (« Tout
  // remettre » émettrait des updates sur des entités absentes) et le cache de
  // décision est indexé sur des dossiers qui n'existent plus.
  useEffect(() => {
    const rebind = () => {
      bindSortJournalToVault(getLastVaultReady()?.vaultId ?? null);
      clearInboxSortCache();
      lastPassAtRef.current = 0;
      startupDoneRef.current = false;
      mountedAtRef.current = Date.now();
    };
    rebind();
    window.addEventListener("supernote:vault-ready", rebind);
    return () => window.removeEventListener("supernote:vault-ready", rebind);
  }, []);

  /** Ids ouverts dans CET onglet : URL + colonnes empilées. */
  const localOpenIds = useCallback((): string[] => {
    const ids = new Set(getOpenNoteIds());
    if (openNoteIdRef.current) ids.add(openNoteIdRef.current);
    return [...ids];
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      passAbortRef.current?.abort();
      // `passInFlight` est au niveau module : sans ça, un démontage pendant
      // une passe (HMR, StrictMode) laisserait le verrou fermé à vie.
      passInFlight = false;
    };
  }, []);

  useEffect(() => {
    const bump = () => {
      lastInputRef.current = Date.now();
      // La frappe coupe la passe en cours, requêtes en vol comprises.
      passAbortRef.current?.abort();
    };
    // `beforeinput` attrape aussi le collage et la saisie IME, que `keydown`
    // rate — l'un et l'autre sont de la frappe du point de vue de la garde.
    window.addEventListener("keydown", bump, { capture: true });
    window.addEventListener("beforeinput", bump, { capture: true });
    return () => {
      window.removeEventListener("keydown", bump, { capture: true });
      window.removeEventListener("beforeinput", bump, { capture: true });
    };
  }, []);

  const peersRef = useRef<ReturnType<typeof openInboxSortPeers> | null>(null);
  useEffect(() => {
    const peers = openInboxSortPeers(() => ({
      lastInputAt: lastInputRef.current,
      openNoteIds: localOpenIds(),
      busy: passInFlight,
    }));
    peersRef.current = peers;
    return () => {
      peersRef.current = null;
      peers.close();
    };
  }, [localOpenIds]);

  useEffect(() => {
    const open = () => setJournalOpen(true);
    window.addEventListener(OPEN_JOURNAL_EVENT, open);
    return () => window.removeEventListener(OPEN_JOURNAL_EVENT, open);
  }, []);

  /**
   * Une seule invalidation, en fin d'opération. Une par note déplacée
   * enchaînait jusqu'à 20 vagues de refetch de tous les widgets montés.
   */
  const invalidateAfterMoves = useCallback(() => {
    void utils.entities.list.invalidate({ typeId: "note" });
    void utils.entities.listSummaries.invalidate();
    void utils.vault.folders.list.invalidate();
  }, [utils]);

  /**
   * Notes de l'inbox, au plus `MAX_NOTES_PER_PASS`. On s'arrête dès qu'on en a
   * assez : le tri `updatedAt DESC` les remonte en tête, donc une page suffit
   * presque toujours. `gcTime: 0` évite de laisser un instantané du coffre
   * résident dans le QueryClient entre deux passes.
   */
  const fetchInboxNotes = useCallback(async (): Promise<NoteRow[]> => {
    const out: NoteRow[] = [];
    for (let page = 0; page < MAX_PAGES && out.length < MAX_NOTES_PER_PASS; page++) {
      const res = await utils.entities.listSummaries.fetch(
        { typeId: "note", limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        { staleTime: 0, gcTime: 0 },
      );
      for (const e of res.items) {
        if (!isInboxPath(e.filePath)) continue;
        if (isArchived(e.fields) || isAttachmentPath(e.filePath)) continue;
        out.push({
          id: e.id,
          filePath: e.filePath,
          title: readTitle(e.fields, e.filePath),
          body: e.body ?? "",
          tags: e.tags,
        });
      }
      if (res.items.length < PAGE_SIZE) break;
    }
    return out;
  }, [utils]);

  const undoMove = useCallback(
    async (move: SortMove): Promise<boolean> => {
      // Le refus est enregistré dès la DEMANDE d'annulation, pas à son succès :
      // une note qu'on n'a pas su remettre reste une note que l'utilisateur ne
      // veut pas voir rangée là.
      refuseDestination(move.noteId, move.folder);
      try {
        // staleTime/gcTime 0 — le QueryClient global garde 30 s de fraîcheur, et
        // un filePath périmé ferait passer le déplacement pour un geste de
        // l'utilisateur, donc annulerait l'annulation.
        const current = await utils.entities.get.fetch(
          { id: move.noteId },
          { staleTime: 0, gcTime: 0 },
        );
        // La note a été déplacée à la main depuis : la remettre serait défaire
        // un geste de l'utilisateur, pas le nôtre.
        if (current.filePath !== move.toFilePath) {
          markMove(move, { stale: true, failed: false });
          return false;
        }

        // Le dossier d'origine mémorisé au déplacement, pas le chemin : le
        // worker choisit un nom libre de façon atomique, et deux entrées de
        // journal de même `fromFilePath` ne s'écrasent plus. `"."` = racine.
        await moveIfFreeRef.current({
          id: move.noteId,
          folder: move.fromFolder || ".",
        });
        markMove(move, { undone: true, failed: false });
        return true;
      } catch (err) {
        console.warn("[InboxAutoSort] annulation impossible", move.toFilePath, err);
        // Échec transitoire : la ligne reste annulable, elle n'est pas figée.
        markMove(move, { failed: true });
        return false;
      }
    },
    [utils],
  );

  const undoMoves = useCallback(
    async (targets: readonly SortMove[]) => {
      if (targets.length === 0) return;
      let restored = 0;
      for (const m of targets) {
        if (await undoMove(m)) restored++;
      }
      invalidateAfterMoves();
      const failed = targets.length - restored;
      toast({
        title:
          restored > 0
            ? `${restored} note${restored > 1 ? "s" : ""} remise${restored > 1 ? "s" : ""} dans la boîte de réception`
            : "Aucune note remise",
        description:
          failed > 0
            ? `${failed} non remise${failed > 1 ? "s" : ""} — déplacée${failed > 1 ? "s" : ""} depuis, ou erreur d'écriture`
            : undefined,
        variant: restored > 0 ? "success" : "warning",
      });
    },
    [undoMove, invalidateAfterMoves, toast],
  );

  // Le toast survit au rendu qui l'a créé : on relit le store à l'instant du
  // clic plutôt que de capturer la liste des déplacements dans la closure.
  const undoPass = useCallback(
    (passId: string) => {
      void undoMoves(
        pendingSortMoves(getSortMoves()).filter((m) => m.passId === passId),
      );
    },
    [undoMoves],
  );

  /**
   * `manual` = clic explicite de l'utilisateur. Les gardes de REPOS (onglet au
   * premier plan, 60 s sans frappe) ne s'y appliquent pas : elles protègent
   * d'une passe de fond surprise, pas d'une demande. Restent opposables en
   * toutes circonstances : la note ouverte ne bouge pas, et aucun dossier n'est
   * créé sans confirmation.
   */
  const runPass = useCallback(async (manual = false) => {
    if (passInFlight) return;
    passInFlight = true;
    setInboxSortPhase("running");
    const abort = new AbortController();
    passAbortRef.current = abort;
    const passStartedAt = Date.now();
    const interrupted = () =>
      abort.signal.aborted ||
      !aliveRef.current ||
      lastInputRef.current > passStartedAt ||
      // Garde de repos, pas de sûreté : elle évite de surprendre quelqu'un qui
      // n'a rien demandé. Appliquée à un clic délibéré, elle arrêtait « Trier
      // maintenant » avec l'obstacle que le popover venait de nommer juste
      // au-dessus du bouton — pire que le silence d'avant.
      (!manual && document.visibilityState !== "visible");

    /** Vrai si un autre onglet ecrit, range, ou tient une note d'inbox ouverte. */
    const peersBusy = async (): Promise<{ busy: boolean; openIds: string[] }> => {
      const peers: PeerState[] = (await peersRef.current?.probe()) ?? [];
      return {
        // `p.busy` reste opposable même en manuel : deux passes concurrentes
        // déplaceraient deux fois les mêmes fichiers. L'inactivité d'un pair,
        // elle, est la même garde de repos que ci-dessus.
        busy: peers.some(
          (p) => p.busy || (!manual && Date.now() - p.lastInputAt < IDLE_MS),
        ),
        openIds: peers.flatMap((p) => p.openNoteIds),
      };
    };

    const failures: string[] = [];
    const moves: SortMove[] = [];
    const passId = passStartedAt.toString(36);
    /** Notes qu'aucun dossier existant n'accueille — matière du groupement. */
    const unclassified: NoteRow[] = [];
    let examined = 0;
    let skippedOpen = 0;
    let heldForConfirmation = 0;
    let noCandidates = false;
    try {
      // Redondant avec le tick, mais `runPass` est aussi appelable après un
      // redimensionnement : aucun appel modèle ne doit partir en mode mobile.
      if (!isAiRuntimeAllowed()) {
        setInboxSortPhase("mobile");
        return;
      }
      // Idempotent : rattrape le cas où le composant a manqué l'événement
      // `vault-ready` (montage après coup), sans quoi les refus persistés du
      // coffre courant ne seraient jamais chargés.
      bindSortJournalToVault(getLastVaultReady()?.vaultId ?? null);

      const first = await peersBusy();
      if (first.busy) {
        setInboxSortPhase("peer-busy");
        return;
      }

      const snapshot = await probeAiStatus();
      if (snapshot.status !== "ready") {
        setInboxSortPhase(
          "ai-offline",
          aiStatusHint(snapshot) ?? aiStatusLabel(snapshot),
        );
        noteInboxSortPass(aiStatusLabel(snapshot));
        return;
      }

      const folders = await utils.vault.folders.list.fetch();
      const candidates = folders
        .map((f) => f.path)
        .filter(
          (p) =>
            p !== INBOX_FOLDER &&
            !p.startsWith(`${INBOX_FOLDER}/`) &&
            !isSystemFolder(p) &&
            !isAttachmentPath(p) &&
            // Un sous-arbre monte appartient a un AUTRE coffre : y deposer une
            // note native pousserait son op dans le salon du pere avec un
            // chemin `@mounts/...` — contamination inter-coffres.
            !isMountedFolder(p),
        );
      // Zéro dossier n'est plus une impasse : la passe bascule entièrement sur
      // la proposition. Sans ça, un coffre neuf ne pouvait RIEN faire, à vie.
      noCandidates = candidates.length === 0;

      const inbox = await fetchInboxNotes();
      inboxSnapshotRef.current = { ids: inbox.map((n) => n.id), at: Date.now() };

      // `fetchInboxNotes` s'arrête au plafond de la passe : au-delà, on n'a pas
      // vu toute l'inbox et on ne peut rien conclure sur ce qui en est sorti.
      if (inbox.length < MAX_NOTES_PER_PASS) {
        const stillInInbox = new Set(inbox.map((n) => n.id));
        // Une note rangée à la main entre-temps ne doit plus retenir de
        // décision : la proposition réclamerait un arbitrage pour rien.
        updateProposedFolders((prev) => {
          const next = prev
            .map((p) => ({ ...p, notes: p.notes.filter((n) => stillInInbox.has(n.id)) }))
            .filter((p) => p.notes.length > 0);
          return next.length === prev.length &&
            next.every((p, i) => p.notes.length === prev[i]!.notes.length)
            ? prev
            : next;
        });
      }

      if (inbox.length === 0) {
        setInboxSortPhase("empty-inbox");
        noteInboxSortPass("boîte de réception vide");
        return;
      }

      const openIds = new Set([...localOpenIds(), ...first.openIds]);
      // Une note ouverte est écartée d'elle-même. Renoncer à la passe entière
      // parce qu'UNE note est ouverte laissait le tri inerte au moment précis
      // où l'utilisateur l'attendait — sa note ouverte devant lui.
      const queue = inbox.filter((e) => !openIds.has(e.id));
      skippedOpen = inbox.length - queue.length;
      if (queue.length === 0) {
        setInboxSortPhase("all-open", allOpenHint(inbox.length));
        noteInboxSortPass(
          `${inbox.length} note${inbox.length > 1 ? "s" : ""} ouverte${inbox.length > 1 ? "s" : ""}, laissée${inbox.length > 1 ? "s" : ""} en place`,
        );
        return;
      }

      // C'est maintenant que la passe consomme son quota de 5 minutes, pas
      // avant les gardes : un renoncement brulait l'intervalle entier, d'ou
      // une famine des qu'un second onglet trainait.
      lastPassAtRef.current = Date.now();
      const refusedNames = getRefusedFolderNames();
      // Une note déjà portée par une proposition en attente est tranchée par
      // l'utilisateur, pas par la passe suivante : la re-soumettre produirait
      // une seconde carte, concurrente, pour les mêmes notes.
      const pendingNoteIds = new Set(
        getProposedFolders().flatMap((p) => p.notes.map((n) => n.id)),
      );

      for (const note of queue.slice(0, MAX_NOTES_PER_PASS)) {
        if (interrupted()) break;
        if (localOpenIds().includes(note.id)) {
          skippedOpen++;
          continue;
        }
        // Un rangement deja annule pour cette note : on n'appelle meme pas le
        // modele, il rendrait la meme reponse (temperature nulle).
        if (hasAnyRefusal(note.id)) continue;
        if (pendingNoteIds.has(note.id)) {
          heldForConfirmation++;
          continue;
        }
        if (!isSortable(note.title, note.body)) continue;
        examined++;

        // `classifyNoteFolder` rend `null` d'emblée sur une liste vide : pas
        // besoin de brancher, l'appel ne part pas.
        const decision = await classifyNoteFolder({
          host: snapshot.host,
          model: snapshot.model,
          title: note.title,
          body: note.body,
          tags: note.tags,
          folders: candidates,
          signal: abort.signal,
        });
        if (interrupted()) break;
        if (decision && isDestinationRefused(note.id, decision.folder)) continue;

        // Aucun dossier existant ne convient : la note part au groupement, qui
        // voit le LOT d'un coup. Une proposition par note nommerait chaque
        // dossier d'après le sujet de sa note et n'en regrouperait aucune.
        if (!decision) {
          unclassified.push(note);
          continue;
        }

        // Re-sonde AVANT chaque ecriture : la sonde d'entree de passe a des
        // minutes de retard, et un onglet peut avoir ouvert cette note depuis.
        const now = await peersBusy();
        if (now.busy) break;
        if (now.openIds.includes(note.id)) {
          skippedOpen++;
          continue;
        }

        let written: string;
        try {
          const res = await moveIfFreeRef.current({
            id: note.id,
            folder: decision.folder,
          });
          if (!res.moved) continue;
          written = res.filePath;
        } catch (err) {
          // Ne JAMAIS avaler : le worker ecrit la destination avant de
          // supprimer la source. Il refuse desormais une collision avant toute
          // ecriture, mais un refus signale un etat qu'on ne comprend pas.
          console.error("[InboxAutoSort] deplacement refuse", note.filePath, err);
          failures.push(note.title);
          break;
        }
        const slash = note.filePath.lastIndexOf("/");
        moves.push({
          noteId: note.id,
          title: note.title,
          fromFilePath: note.filePath,
          fromFolder: slash > 0 ? note.filePath.slice(0, slash) : "",
          toFilePath: written,
          folder: decision.folder,
          passId,
          at: Date.now(),
          undone: false,
          stale: false,
        });
      }

      if (moves.length > 0) {
        updateSortMoves((prev) => [...moves, ...prev]);
        invalidateAfterMoves();
        const plural = moves.length > 1 ? "s" : "";
        const destinations = [...new Set(moves.map((m) => m.folder))];
        const extra = destinations.length - 2;
        toast({
          title: `${moves.length} note${plural} rangée${plural}`,
          description:
            destinations.length <= 2
              ? `Vers ${destinations.join(" et ")}`
              : `Vers ${destinations.slice(0, 2).join(", ")} et ${extra} autre${extra > 1 ? "s" : ""} dossier${extra > 1 ? "s" : ""}`,
          variant: "success",
          duration: TOAST_DURATION_MS,
          actions: [
            { label: "Annuler", onClick: () => undoPass(passId) },
            { label: "Voir", onClick: () => setJournalOpen(true) },
          ],
        });
      }

      // Un seul appel pour tout le reliquat : c'est la vue d'ensemble qui fait
      // émerger un thème commun plutôt qu'un tiroir par note.
      const groups: ProposedFolder[] = [];
      if (unclassified.length > 0 && !interrupted()) {
        const proposalsFromModel = await proposeFolderGroups({
          host: snapshot.host,
          model: snapshot.model,
          notes: unclassified.map((n, i) => ({
            ref: i + 1,
            title: n.title,
            body: n.body,
            tags: n.tags,
          })),
          existing: candidates,
          refused: refusedNames,
          maxGroups: MAX_PROPOSALS_PER_PASS,
          signal: abort.signal,
        });
        for (const p of proposalsFromModel) {
          const notes: ProposedNote[] = [];
          for (const ref of p.refs) {
            const n = unclassified[ref - 1];
            if (!n) continue;
            const slashAt = n.filePath.lastIndexOf("/");
            notes.push({
              id: n.id,
              title: n.title,
              filePath: n.filePath,
              fromFolder: slashAt > 0 ? n.filePath.slice(0, slashAt) : "",
            });
          }
          if (notes.length === 0) continue;
          groups.push({
            id: `${passId}-${folderNameKey(p.folder)}`,
            folder: p.folder,
            notes,
            passId,
            at: Date.now(),
          });
        }
      }

      if (groups.length > 0) {
        // Un nom déjà en attente n'est pas une nouvelle : la carte s'enrichit
        // en silence. Sans ce partage, chaque passe re-toastait la même
        // proposition tant qu'elle n'était pas tranchée.
        const alreadyPending = new Set(
          getProposedFolders().map((p) => folderNameKey(p.folder)),
        );
        const fresh = groups.filter((g) => !alreadyPending.has(folderNameKey(g.folder)));

        updateProposedFolders((prev) => {
          const out = [...prev];
          for (const g of groups) {
            const i = out.findIndex(
              (p) => folderNameKey(p.folder) === folderNameKey(g.folder),
            );
            if (i < 0) {
              out.push(g);
              continue;
            }
            const known = new Set(out[i]!.notes.map((n) => n.id));
            out[i] = {
              ...out[i]!,
              notes: [...out[i]!.notes, ...g.notes.filter((n) => !known.has(n.id))],
            };
          }
          return out;
        });

        if (fresh.length > 0) {
          const total = fresh.reduce((s, g) => s + g.notes.length, 0);
          toast({
            title:
              fresh.length === 1
                ? `Dossier proposé : ${fresh[0]!.folder}`
                : `${fresh.length} dossiers proposés`,
            description: `Pour ${total} note${total > 1 ? "s" : ""} de la boîte de réception. Rien n'est créé sans ta confirmation.`,
            variant: "info",
            duration: TOAST_DURATION_MS,
            actions: [{ label: "Confirmer…", onClick: () => setJournalOpen(true) }],
          });
        }
      }

      const pendingProposals = getProposedFolders().length;
      if (moves.length > 0) {
        setInboxSortPhase("sorted");
      } else if (pendingProposals > 0) {
        setInboxSortPhase("awaiting-confirmation");
      } else if (examined === 0) {
        setInboxSortPhase(
          "nothing-sortable",
          skippedOpen > 0
            ? "Les notes ouvertes restent en place — ferme-les pour qu'elles soient rangées."
            : "Ces notes sont trop courtes pour être classées honnêtement.",
        );
      } else {
        setInboxSortPhase(
          "no-match",
          noCandidates
            ? "Ce coffre n'a aucun dossier et l'IA n'a pas su en proposer un — crées-en un toi-même et relance."
            : "Aucun dossier existant ne convenait, et aucun nouveau n'était évident.",
        );
      }
      noteInboxSortPass(
        [
          `${examined} note${examined > 1 ? "s" : ""} examinée${examined > 1 ? "s" : ""}`,
          `${moves.length} rangée${moves.length > 1 ? "s" : ""}`,
          groups.length > 0 ? `${groups.length} dossier${groups.length > 1 ? "s" : ""} proposé${groups.length > 1 ? "s" : ""}` : null,
          skippedOpen > 0 ? `${skippedOpen} ouverte${skippedOpen > 1 ? "s" : ""}, laissée${skippedOpen > 1 ? "s" : ""} en place` : null,
          heldForConfirmation > 0 ? `${heldForConfirmation} en attente de confirmation` : null,
        ]
          .filter((s): s is string => s !== null)
          .join(" · "),
      );
    } finally {
      if (failures.length > 0) {
        toast({
          title: "Rangement interrompu",
          description: `« ${failures[0]} » n'a pas pu être déplacée. Vérifiez la note avant de relancer.`,
          variant: "danger",
          duration: 0,
        });
      }
      passAbortRef.current = null;
      passInFlight = false;
    }
  }, [
    utils,
    fetchInboxNotes,
    localOpenIds,
    invalidateAfterMoves,
    toast,
    undoPass,
  ]);

  useEffect(() => {
    const tick = () => {
      if (passInFlight) return;
      if (journalOpenRef.current) return;
      // Décision produit : aucun traitement IA sur téléphone. Le journal et
      // « Tout remettre » restent utilisables au doigt — c'est de la lecture
      // et une action explicite, pas un traitement de fond.
      if (!isAiRuntimeAllowed()) {
        setInboxSortPhase("mobile");
        return;
      }
      if (!isInboxSortEnabled()) {
        setInboxSortPhase("disabled", "Réactive-le dans Réglages → IA locale.");
        return;
      }
      if (document.visibilityState !== "visible") {
        setInboxSortPhase(
          "hidden",
          "Aucune passe de fond hors premier plan — « Trier maintenant » passe outre.",
        );
        return;
      }
      if (!hasWorkerBackend() || !isWorkerReady()) {
        setInboxSortPhase("no-worker", "Le coffre n'est pas encore ouvert.");
        return;
      }

      const now = Date.now();
      const idleFor = now - lastInputRef.current;
      const startupDue =
        !startupDoneRef.current &&
        now - mountedAtRef.current >= STARTUP_DELAY_MS &&
        idleFor >= STARTUP_IDLE_MS;

      // Toutes les notes connues de l'inbox sont ouvertes : promettre une passe
      // dans 60 s serait un mensonge, elle les écarterait toutes. Réponse sans
      // worker ni Ollama, et le constat se défait dès que la note est fermée.
      const snap = inboxSnapshotRef.current;
      const openHere = new Set(localOpenIds());
      if (
        snap.ids.length > 0 &&
        now - snap.at < MIN_PASS_INTERVAL_MS &&
        snap.ids.every((id) => openHere.has(id))
      ) {
        setInboxSortPhase("all-open", allOpenHint(snap.ids.length));
        return;
      }

      // Un résultat de passe encore frais prime sur une promesse générique :
      // « la passe démarre après 60 s » est vrai en général et faux quand la
      // dernière passe a conclu que rien ne bougerait.
      const held = getInboxSortStatus();
      const keepOutcome =
        isConclusivePhase(held.phase) &&
        held.lastPassAt > 0 &&
        now - held.lastPassAt < MIN_PASS_INTERVAL_MS;

      if (!startupDue && idleFor < IDLE_MS) {
        if (!keepOutcome) {
          setInboxSortPhase(
            "waiting-idle",
            "La passe démarre après 60 s sans frappe — « Trier maintenant » ne l'attend pas.",
          );
        }
        return;
      }
      if (now - lastPassAtRef.current < MIN_PASS_INTERVAL_MS) {
        if (!keepOutcome) {
          setInboxSortPhase(
            "cooldown",
            "Une passe vient de tourner — « Trier maintenant » force la suivante.",
          );
        }
        return;
      }

      startupDoneRef.current = true;
      void runPass();
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [runPass, localOpenIds]);

  // Déclencheur manuel du popover d'état : l'attente passive était la panne
  // vécue, un bouton la rend décidable.
  useEffect(() => {
    const run = () => void runPass(true);
    window.addEventListener(RUN_INBOX_SORT_EVENT, run);
    return () => window.removeEventListener(RUN_INBOX_SORT_EVENT, run);
  }, [runPass]);

  // Le toast d'une proposition acceptée peut naître dans le panneau droit, hors
  // de portée du journal : il demande l'annulation par événement.
  useEffect(() => {
    const undo = (e: Event) => {
      const passId = (e as CustomEvent<{ passId?: string }>).detail?.passId;
      if (passId) undoPass(passId);
    };
    window.addEventListener(UNDO_PASS_EVENT, undo);
    return () => window.removeEventListener(UNDO_PASS_EVENT, undo);
  }, [undoPass]);

  // Même définition que le décompte des pastilles : sans ça la barre du haut
  // annonçait des notes que la modale ne proposait plus de remettre.
  const pending = useMemo(() => pendingSortMoves(journal), [journal]);
  const statusLine = inboxSortStatusLabel(status);

  return (
    <Modal
      isOpen={journalOpen}
      onOpenChange={setJournalOpen}
      title="Notes rangées par l'IA"
      size="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onPress={() => setJournalOpen(false)}>
            Fermer
          </Button>
          {pending.length > 0 && (
            <Button variant="outline" onPress={() => void undoMoves(pending)}>
              Tout remettre dans la boîte de réception
            </Button>
          )}
        </div>
      }
    >
      {proposals.length > 0 && (
        <section className="mb-4 flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Dossiers proposés — à confirmer
          </h3>
          {proposals.map((p) => (
            <FolderProposalCard key={p.id} proposal={p} actions={proposalActions} />
          ))}
        </section>
      )}

      {journal.length === 0 ? (
        <p className="py-4 text-sm text-[var(--text-muted)]">
          {proposals.length > 0
            ? "Aucun rangement automatique pour l'instant."
            : `Aucun rangement automatique depuis l'ouverture de l'application. ${statusLine}`}
        </p>
      ) : (
        <ul className="-my-1 max-h-[55vh] overflow-y-auto">
          {journal.map((m) => (
            <li
              key={`${m.noteId}-${m.at}`}
              className="flex flex-col gap-2 border-b border-[var(--border-subtle)] py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--text-primary)]">
                  {m.title}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <FolderSimple size={12} aria-hidden="true" />
                  <span className="truncate">
                    {INBOX_FOLDER} → {m.folder}
                  </span>
                </p>
              </div>
              {m.undone ? (
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  remise dans la boîte de réception
                </span>
              ) : m.stale ? (
                <span className="shrink-0 text-xs text-[var(--text-muted)]">
                  déplacée depuis
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                  {m.failed && (
                    <span className="text-xs text-[var(--danger)]">
                      échec, à réessayer
                    </span>
                  )}
                  <Tooltip content="Remettre dans la boîte de réception">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remettre « ${m.title} » dans la boîte de réception`}
                      onPress={() => void undoMoves([m])}
                    >
                      <ArrowUUpLeft size={16} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

