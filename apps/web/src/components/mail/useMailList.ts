"use client";

/**
 * useMailList — état + chargement de la LISTE d'emails (pane gauche).
 *
 * Regroupe ce qui était dispersé dans `app/mail/page.tsx` : items cumulés,
 * overlay de regroupement, labels, pagination, états de chargement, et les deux
 * chemins de lecture :
 *
 *  - MIRROR (inbox + coffre ouvert) : affichage instantané depuis le mirror
 *    local, puis reconciliation Gmail en tâche de fond et relecture ;
 *  - LIVE (recherche libre / mode limité) : `threads.list` Gmail paginé.
 *
 * La page garde la sélection (fil/groupe ouvert) : `onResetSelection` est appelé
 * au début d'un chargement pour que la page la purge elle-même.
 */

import { useCallback, useRef, useState } from "react";
import {
  getInboxCounts,
  listThreadSummariesPage,
  listLabels,
  type GmailLabel,
  type GmailLabelColor,
  type ThreadListItem,
} from "@/lib/gmail";
import {
  mirrorAvailable,
  mirrorListThreads,
  mirrorListLabels,
  mirrorSearchThreads,
} from "@/lib/mail-mirror";
import { parseMailQuery } from "@/lib/mail-search";
import { syncMailbox } from "@/lib/mail-sync";
import { buildMailOverlay, type OverlayRow } from "@/lib/mail-overlay";

/** Requête Gmail par défaut (la boîte de réception = le flux « à gérer »). */
export const DEFAULT_MAIL_QUERY = "in:inbox";

/** Nombre de fils chargés par page (chargement initial + pagination). */
export const MAIL_PAGE_SIZE = 50;

export interface UseMailListOptions {
  clientId: string;
  /** Compte Gmail connecté = clé de scoping du mirror. */
  accountId: string;
  /** Adresses « à moi » (exclues du regroupement par expéditeur). */
  selfAddresses: string[];
  /** Filtre d'onglet appliqué avant le regroupement (inbox / groupe / todo). */
  computeVisible: (items: ThreadListItem[]) => ThreadListItem[];
  /** Labels de l'onglet actif qui ne forment pas de groupe (cf. `buildMailOverlay`). */
  flatLabelIds: () => ReadonlySet<string>;
  /** Appelé au début d'un chargement : la page purge sa sélection. */
  onResetSelection: () => void;
}

export interface MailListApi {
  rows: OverlayRow[];
  setRows: React.Dispatch<React.SetStateAction<OverlayRow[]>>;
  cumItems: ThreadListItem[];
  setCumItems: React.Dispatch<React.SetStateAction<ThreadListItem[]>>;
  labelNames: Map<string, string>;
  labelColors: Map<string, GmailLabelColor>;
  listLoading: boolean;
  listError: string | null;
  setListError: (e: string | null) => void;
  nextPageToken: string | undefined;
  moreLoading: boolean;
  loadList: (q: string) => Promise<void>;
  /**
   * Resynchronise la boîte en tâche de fond (mirror uniquement) sans toucher à
   * la sélection ni afficher de squelette. No-op hors mirror.
   */
  refresh: () => Promise<void>;
  /** Relit le mirror local sans appeler Gmail. No-op hors mirror. */
  rereadMirror: () => Promise<void>;
  /** Fils en boîte côté Gmail quand le mirror n'en a copié qu'une partie (constat du dernier sync) ; sinon null. */
  truncatedTotal: number | null;
  loadMore: (q: string) => Promise<void>;
  /** Reconstruit l'overlay depuis un jeu d'items (filtre d'onglet appliqué). */
  rebuild: (items: ThreadListItem[]) => OverlayRow[];
  /**
   * Recherche INSTANTANÉE dans le mirror local (frappe au kilomètre). Renvoie
   * le nombre de fils trouvés, ou `null` si le mirror n'est pas disponible
   * (l'appelant retombe alors sur la recherche Gmail à la validation).
   */
  searchLocal: (rawQuery: string) => Promise<number | null>;
  /**
   * Enregistre un label fraîchement créé (classement automatique) dans la table
   * locale, pour que les lignes l'affichent sans attendre le prochain sync.
   */
  addLabel: (label: GmailLabel) => void;
  removeLabel: (id: string) => void;
}

export function useMailList({
  clientId,
  accountId,
  selfAddresses,
  computeVisible,
  flatLabelIds,
  onResetSelection,
}: UseMailListOptions): MailListApi {
  const [rows, setRows] = useState<OverlayRow[]>([]);
  const [cumItems, setCumItems] = useState<ThreadListItem[]>([]);
  const [labelNames, setLabelNames] = useState<Map<string, string>>(new Map());
  const [labelColors, setLabelColors] = useState<Map<string, GmailLabelColor>>(new Map());
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [truncatedTotal, setTruncatedTotal] = useState<number | null>(null);
  // Anti-course : une réponse réseau plus lente qu'un souhait plus récent est
  // ignorée (jeton croissant par chargement).
  const loadReqRef = useRef(0);

  const rebuild = useCallback(
    (items: ThreadListItem[]) =>
      buildMailOverlay(computeVisible(items), labelNames, selfAddresses, flatLabelIds()),
    [computeVisible, flatLabelIds, labelNames, selfAddresses],
  );

  const applyListData = useCallback(
    (items: ThreadListItem[], labels: GmailLabel[], nextToken: string | undefined) => {
      const names = new Map(labels.map((l) => [l.id, l.name]));
      setLabelNames(names);
      setLabelColors(new Map(labels.flatMap((l) => (l.color ? [[l.id, l.color] as const] : []))));
      setCumItems(items);
      setNextPageToken(nextToken);
      setRows(buildMailOverlay(computeVisible(items), names, selfAddresses, flatLabelIds()));
    },
    [selfAddresses, computeVisible, flatLabelIds],
  );

  // Sync Gmail → mirror puis relecture ; `reqId` écarte une réponse dépassée.
  const syncAndReread = useCallback(
    async (reqId: number) => {
      await syncMailbox(clientId, accountId);
      if (reqId !== loadReqRef.current) return;
      const [items, labels] = await Promise.all([
        mirrorListThreads(accountId, { labelId: "INBOX", limit: 500 }),
        mirrorListLabels(accountId),
      ]);
      if (reqId !== loadReqRef.current) return;
      applyListData(items, labels, undefined);
      setListError(null);
      void getInboxCounts(clientId)
        .then((c) => {
          if (reqId === loadReqRef.current) {
            setTruncatedTotal(c.threadsTotal > items.length ? c.threadsTotal : null);
          }
        })
        .catch(() => {
          /* indicateur de troncature best-effort */
        });
    },
    [clientId, accountId, applyListData],
  );

  const loadList = useCallback(
    async (q: string) => {
      const reqId = ++loadReqRef.current;
      setListError(null);
      onResetSelection();

      const canMirror = q === DEFAULT_MAIL_QUERY && mirrorAvailable() && !!accountId;
      if (!canMirror) setTruncatedTotal(null);

      if (canMirror) {
        // 1) Affichage immédiat depuis le mirror (inbox zero ⇒ liste courte).
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
          setListLoading(true); // mirror illisible → le sync reconstruit
        }
        // 2) Reconciliation en arrière-plan puis relecture du mirror.
        void syncAndReread(reqId)
          .catch((err) => {
            if (reqId !== loadReqRef.current) return;
            setRows((rs) => {
              // Mirror vide ET sync échoué → on remonte l'erreur ; sinon on
              // garde l'affichage mirror (offline-friendly).
              if (rs.length === 0) setListError(err instanceof Error ? err.message : String(err));
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
          listLabels(clientId).catch(() => [] as GmailLabel[]),
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
    [clientId, accountId, applyListData, onResetSelection, syncAndReread],
  );

  const refresh = useCallback(async () => {
    if (!mirrorAvailable() || !accountId) return;
    await syncAndReread(++loadReqRef.current).catch(() => {
      /* hors ligne ou jeton absent : on garde l'affichage courant */
    });
  }, [accountId, syncAndReread]);

  const rereadMirror = useCallback(async () => {
    if (!mirrorAvailable() || !accountId) return;
    const reqId = ++loadReqRef.current;
    const [items, labels] = await Promise.all([
      mirrorListThreads(accountId, { labelId: "INBOX", limit: 500 }),
      mirrorListLabels(accountId),
    ]);
    if (reqId !== loadReqRef.current) return;
    applyListData(items, labels, undefined);
    setListError(null);
  }, [accountId, applyListData]);

  // Page suivante : APPEND aux items cumulés puis RECONSTRUCTION de l'overlay sur
  // l'ensemble (sinon le regroupement serait calculé page par page, donc faux).
  // Déduplication par id (Gmail peut renvoyer un fil déjà vu en bord de page).
  const loadMore = useCallback(
    async (q: string) => {
      if (!nextPageToken || moreLoading) return;
      setMoreLoading(true);
      setListError(null);
      try {
        const page = await listThreadSummariesPage(clientId, q, {
          pageToken: nextPageToken,
          maxResults: MAIL_PAGE_SIZE,
        });
        setCumItems((prev) => {
          const seen = new Set(prev.map((it) => it.id));
          const merged = [...prev, ...page.items.filter((it) => !seen.has(it.id))];
          setRows(buildMailOverlay(computeVisible(merged), labelNames, selfAddresses, flatLabelIds()));
          return merged;
        });
        setNextPageToken(page.nextPageToken);
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        setMoreLoading(false);
      }
    },
    [clientId, nextPageToken, moreLoading, labelNames, selfAddresses, computeVisible, flatLabelIds],
  );

  // Recherche locale : filtres analysés côté client, `label:` résolu en ids via
  // la table des labels déjà chargée. Les résultats REMPLACENT les lignes sans
  // toucher à `cumItems` — quitter la recherche restaure la boîte sans refetch.
  const searchLocal = useCallback(
    async (rawQuery: string): Promise<number | null> => {
      if (!mirrorAvailable() || !accountId) return null;
      // Une relecture de fond encore en vol écraserait les résultats de recherche.
      ++loadReqRef.current;
      const parsed = parseMailQuery(rawQuery);
      const nameToId = new Map<string, string>();
      for (const [id, name] of labelNames) nameToId.set(name.toLowerCase(), id);
      const labelIds = parsed.label.map((n) => nameToId.get(n) ?? n);
      try {
        const items = await mirrorSearchThreads(accountId, {
          terms: parsed.terms,
          from: parsed.from,
          to: parsed.to,
          subject: parsed.subject,
          labelIds,
          ...(parsed.isUnread ? { isUnread: true } : {}),
          ...(parsed.isRead ? { isRead: true } : {}),
          ...(parsed.isStarred ? { isStarred: true } : {}),
          ...(parsed.hasAttachment ? { hasAttachment: true } : {}),
          ...(parsed.after !== undefined ? { after: parsed.after } : {}),
          ...(parsed.before !== undefined ? { before: parsed.before } : {}),
          limit: 200,
        });
        // Pas de `computeVisible` ici : une recherche doit trouver AUSSI ce qui
        // est routé dans un groupe ou converti en tâche — sinon on cherche dans
        // une boîte amputée sans le dire.
        setRows(buildMailOverlay(items, labelNames, selfAddresses));
        setNextPageToken(undefined);
        setListError(null);
        setListLoading(false);
        return items.length;
      } catch {
        return null;
      }
    },
    [accountId, labelNames, selfAddresses],
  );

  const addLabel = useCallback((label: GmailLabel) => {
    setLabelNames((prev) => {
      if (prev.get(label.id) === label.name) return prev;
      const next = new Map(prev);
      next.set(label.id, label.name);
      return next;
    });
    if (label.color) {
      setLabelColors((prev) => {
        const next = new Map(prev);
        next.set(label.id, label.color!);
        return next;
      });
    }
  }, []);

  const removeLabel = useCallback((id: string) => {
    const without = <T,>(prev: Map<string, T>) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    };
    setLabelNames(without);
    setLabelColors(without);
  }, []);

  return {
    rows,
    setRows,
    cumItems,
    setCumItems,
    labelNames,
    labelColors,
    listLoading,
    listError,
    setListError,
    nextPageToken,
    moreLoading,
    loadList,
    refresh,
    rereadMirror,
    truncatedTotal,
    loadMore,
    rebuild,
    searchLocal,
    addLabel,
    removeLabel,
  };
}
