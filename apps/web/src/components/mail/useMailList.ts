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
  listThreadSummariesPage,
  listLabels,
  type GmailLabel,
  type GmailLabelColor,
  type ThreadListItem,
} from "@/lib/gmail";
import { mirrorAvailable, mirrorListThreads, mirrorListLabels } from "@/lib/mail-mirror";
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
  loadMore: (q: string) => Promise<void>;
  /** Reconstruit l'overlay depuis un jeu d'items (filtre d'onglet appliqué). */
  rebuild: (items: ThreadListItem[]) => OverlayRow[];
}

export function useMailList({
  clientId,
  accountId,
  selfAddresses,
  computeVisible,
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
  // Anti-course : une réponse réseau plus lente qu'un souhait plus récent est
  // ignorée (jeton croissant par chargement).
  const loadReqRef = useRef(0);

  const rebuild = useCallback(
    (items: ThreadListItem[]) => buildMailOverlay(computeVisible(items), labelNames, selfAddresses),
    [computeVisible, labelNames, selfAddresses],
  );

  const applyListData = useCallback(
    (items: ThreadListItem[], labels: GmailLabel[], nextToken: string | undefined) => {
      const names = new Map(labels.map((l) => [l.id, l.name]));
      setLabelNames(names);
      setLabelColors(new Map(labels.flatMap((l) => (l.color ? [[l.id, l.color] as const] : []))));
      setCumItems(items);
      setNextPageToken(nextToken);
      setRows(buildMailOverlay(computeVisible(items), names, selfAddresses));
    },
    [selfAddresses, computeVisible],
  );

  const loadList = useCallback(
    async (q: string) => {
      const reqId = ++loadReqRef.current;
      setListError(null);
      onResetSelection();

      const canMirror = q === DEFAULT_MAIL_QUERY && mirrorAvailable() && !!accountId;

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
    [clientId, accountId, applyListData, onResetSelection],
  );

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
          setRows(buildMailOverlay(computeVisible(merged), labelNames, selfAddresses));
          return merged;
        });
        setNextPageToken(page.nextPageToken);
      } catch (err) {
        setListError(err instanceof Error ? err.message : String(err));
      } finally {
        setMoreLoading(false);
      }
    },
    [clientId, nextPageToken, moreLoading, labelNames, selfAddresses, computeVisible],
  );

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
    loadMore,
    rebuild,
  };
}
