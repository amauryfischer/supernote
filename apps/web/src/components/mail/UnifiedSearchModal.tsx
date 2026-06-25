"use client";

/**
 * UnifiedSearchModal — command palette « tout-en-un » : recherche EN PARALLÈLE
 * dans les emails Gmail, les notes/entités du coffre (FTS) et les Bases
 * (EntityTypes), fusionnée et classée par `@/lib/unified-search` (pur, testé).
 *
 * Ouverture : Cmd/Ctrl+K (cf. `useUnifiedSearch`, qui pose le listener global et
 * expose `{ open, setOpen, toggle }`). Navigation : ↑/↓ déplacent la sélection,
 * Entrée ouvre/navigue, Échap ferme.
 *
 * UI : HeroUI v3 — Modal + Input + ListBox (react-aria). Le focus reste sur
 * l'Input (pour la frappe) ; les flèches pilotent une `selectedKeys` contrôlée
 * dans la ListBox, Entrée déclenche l'action de l'item surligné.
 *
 * Sources d'I/O importées en lecture seule :
 *   - emails : `listThreadSummaries` (@/lib/gmail) — gaté sur Gmail connecté ;
 *   - notes  : `trpc.search.query` (FTS coffre) ;
 *   - bases  : `trpc.schemas.list` (filtré par nom côté client).
 *
 * Self-contained : aucune intégration câblée ici. Voir le bloc « Wiring » dans
 * le rapport de livraison pour le montage global + le raccourci.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Input } from "@supernote/ui";
import { ListBox, ListBoxItem, Spinner } from "@heroui/react";
import {
  MagnifyingGlass,
  EnvelopeSimple,
  FileText,
  Database,
  ArrowSquareOut,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import { listThreadSummaries, type ThreadListItem } from "@/lib/gmail";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import type { SearchResult } from "@supernote/ipc";
import {
  mergeRankResults,
  emailToResult,
  searchResultToResult,
  baseToResult,
  filterBases,
  type UnifiedResult,
  type UnifiedSource,
} from "@/lib/unified-search";

const RESULT_LIMIT = 30;

const SOURCE_ICON: Record<UnifiedSource, PhosphorIcon> = {
  email: EnvelopeSimple,
  note: FileText,
  base: Database,
};

const SOURCE_LABEL: Record<UnifiedSource, string> = {
  email: "Email",
  note: "Note",
  base: "Base",
};

/** Clé stable d'un résultat dans la ListBox (= `source:id`). */
function resultKey(r: UnifiedResult): string {
  return `${r.source}:${r.id}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Hook : état d'ouverture + raccourci global Cmd/Ctrl+K
// ───────────────────────────────────────────────────────────────────────────────

export interface UnifiedSearchController {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/**
 * Pose le listener global Cmd/Ctrl+K (toggle) + Échap (déjà géré par la Modal,
 * mais on garde le K propre). Ignore le raccourci si une combinaison plus large
 * (Shift/Alt) est pressée. Renvoie le contrôleur à passer à la Modal.
 */
export function useUnifiedSearch(): UnifiedSearchController {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen, toggle };
}

// ───────────────────────────────────────────────────────────────────────────────
// Modal
// ───────────────────────────────────────────────────────────────────────────────

export interface UnifiedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UnifiedSearchModal({ isOpen, onClose }: UnifiedSearchModalProps) {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const gmailConnected = useGmailConnected();
  const clientId = settings.googleDrive.clientId.trim();

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 220);
  const trimmed = debouncedQuery.trim();

  // Index de l'item surligné dans la liste fusionnée (nav clavier).
  const [activeIndex, setActiveIndex] = useState(0);

  // Réinitialise à l'ouverture.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  // ── Worker readiness (même gate que /recherche et CommandPalette) ────────────
  const [workerReady, setWorkerReady] = useState(() =>
    typeof window === "undefined" ? false : isWorkerReady(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isWorkerReady()) setWorkerReady(true);
    const onReady = () => setWorkerReady(true);
    window.addEventListener("supernote:vault-ready", onReady);
    return () => window.removeEventListener("supernote:vault-ready", onReady);
  }, []);

  const canSearchVault = isOpen && hasWorkerBackend() && workerReady && trimmed.length > 0;

  // ── Source coffre : FTS notes/entités ────────────────────────────────────────
  const vaultSearch = trpc.search.query.useQuery(
    { query: trimmed, limit: RESULT_LIMIT, offset: 0 },
    { enabled: canSearchVault, retry: false, staleTime: 30_000 },
  );

  // ── Source bases : liste des EntityTypes (filtrée par nom côté client) ────────
  const schemasList = trpc.schemas.list.useQuery(
    { search: undefined },
    { enabled: isOpen && hasWorkerBackend() && workerReady, retry: false, staleTime: 60_000 },
  );

  // ── Source emails : recherche Gmail en parallèle (gérée hors React-Query) ─────
  const [emails, setEmails] = useState<ThreadListItem[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emailsError, setEmailsError] = useState<string | null>(null);
  // Anti-course : on ignore les réponses d'une requête plus ancienne.
  const emailReqIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen || !gmailConnected || trimmed.length === 0) {
      setEmails([]);
      setEmailsError(null);
      setEmailsLoading(false);
      return;
    }
    const reqId = ++emailReqIdRef.current;
    setEmailsLoading(true);
    setEmailsError(null);
    listThreadSummaries(clientId, trimmed, RESULT_LIMIT)
      .then((items) => {
        if (reqId !== emailReqIdRef.current) return;
        setEmails(items);
        setEmailsLoading(false);
      })
      .catch((err: unknown) => {
        if (reqId !== emailReqIdRef.current) return;
        setEmails([]);
        setEmailsError(err instanceof Error ? err.message : String(err));
        setEmailsLoading(false);
      });
  }, [isOpen, gmailConnected, clientId, trimmed]);

  // ── Fusion + classement (pur) ────────────────────────────────────────────────
  const results = useMemo<UnifiedResult[]>(() => {
    if (trimmed.length === 0) return [];
    const emailResults = emails.map(emailToResult);
    const noteResults = ((vaultSearch.data?.items ?? []) as SearchResult[]).map(searchResultToResult);
    const baseResults = filterBases(
      (schemasList.data ?? []).map((t) => {
        const core = ipcEntityTypeToCore(t);
        return { id: core.id, name: core.name, plural: core.plural, icon: core.icon };
      }),
      trimmed,
    ).map(baseToResult);
    return mergeRankResults([emailResults, noteResults, baseResults], trimmed, RESULT_LIMIT);
  }, [trimmed, emails, vaultSearch.data, schemasList.data]);

  // Garde l'index sélectionné dans les bornes quand la liste change.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const anyLoading =
    emailsLoading ||
    (canSearchVault && (vaultSearch.isLoading || vaultSearch.isFetching) && !vaultSearch.data);

  // ── Navigation ────────────────────────────────────────────────────────────────
  const activate = useCallback(
    (r: UnifiedResult | undefined) => {
      if (!r) return;
      onClose();
      if (!r.href) return;
      if (r.source === "email") {
        // Email = lien web Gmail (externe), nouvel onglet.
        window.open(r.href, "_blank", "noopener,noreferrer");
      } else {
        navigate(r.href);
      }
    },
    [navigate, onClose],
  );

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (results.length === 0) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        activate(results[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, activeIndex, activate, onClose],
  );

  const activeKey = results[activeIndex] ? resultKey(results[activeIndex]!) : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Recherche unifiée"
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Emails, notes, bases…"
            className="flex-1"
            autoFocus
            aria-label="Recherche unifiée"
          />
          {anyLoading && <Spinner size="sm" />}
        </div>

        {emailsError && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Recherche emails indisponible : {emailsError}
          </p>
        )}

        <div className="max-h-[50vh] min-h-[3rem] overflow-y-auto">
          {trimmed.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Tapez pour chercher dans vos emails, notes et bases.
            </p>
          ) : results.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              {anyLoading ? "Recherche…" : `Aucun résultat pour « ${trimmed} »`}
            </p>
          ) : (
            <ListBox
              aria-label="Résultats de recherche"
              selectionMode="single"
              selectedKeys={activeKey ? [activeKey] : []}
              disallowEmptySelection
              onAction={(key) => {
                const r = results.find((x) => resultKey(x) === String(key));
                activate(r);
              }}
              className="flex flex-col gap-0.5"
            >
              {results.map((r) => {
                const Icon = SOURCE_ICON[r.source];
                return (
                  <ListBoxItem
                    key={resultKey(r)}
                    id={resultKey(r)}
                    textValue={r.title}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none data-[selected=true]:bg-[var(--accent-subtle)] data-[focused=true]:bg-[var(--surface-2)]"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                      style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      <Icon size={15} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium leading-tight" style={{ color: "var(--text-primary)" }}>
                        {r.title}
                      </span>
                      {r.subtitle && (
                        <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.subtitle}
                        </span>
                      )}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
                    >
                      {SOURCE_LABEL[r.source]}
                      {r.source === "email" && <ArrowSquareOut size={10} />}
                    </span>
                  </ListBoxItem>
                );
              })}
            </ListBox>
          )}
        </div>

        <div
          className="flex items-center gap-3 px-1 pt-1 text-[11px]"
          style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}
        >
          <span>
            <kbd className="font-mono">↑↓</kbd> naviguer
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> ouvrir
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> fermer
          </span>
        </div>
      </div>
    </Modal>
  );
}
