"use client";

/**
 * NotePortal — renderer du bloc `embed` : transclusion vivante d'une autre note.
 *
 * Le bloc embed (package editor) délègue son rendu via EmbedProvider ; ce
 * composant résout le target wikilink → entité, charge le body markdown et
 * rend un SupernoteEditor imbriqué. L'édition est bidirectionnelle : les
 * changements dans le portail sont sauvegardés (debounce) sur la note cible
 * via entities.update — sans toucher le titre.
 *
 * Garde-fous récursion : profondeur max (portail dans portail) + détection
 * de cycle par chaîne de targets. Au-delà → carte statique non éditable.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Spinner } from "@heroui/react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { SupernoteEditor } from "@supernote/editor";
import type { EntityRef } from "@supernote/editor";
import { trpc } from "@/lib/trpc/client";
import { renderInlineDatabase } from "./InlineDatabaseRenderer";
import { renderNoteFormula } from "./NoteFormulaBridge";
import { renderDoodle } from "./DoodleRenderer";
import { entityDisplayName } from "./adapters";

const MAX_PORTAL_DEPTH = 2;
const SAVE_DEBOUNCE_MS = 1000;
const PORTAL_ACCENT = "#6366F1";

/** Chaîne d'ancêtres pour la détection de cycle + profondeur courante. */
const PortalDepthContext = createContext<{ depth: number; chain: readonly string[] }>({
  depth: 0,
  chain: [],
});

function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

export function renderNotePortal(props: { target: string; alias?: string }): React.ReactNode {
  return <NotePortal target={props.target} alias={props.alias} />;
}

// ── Cartes d'état (placeholder / erreur / limite) ────────────────────────────

function PortalCard({
  children,
  muted,
}: { children: React.ReactNode; muted?: boolean }): React.JSX.Element {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        borderLeft: `3px solid ${muted ? "var(--border-subtle)" : PORTAL_ACCENT}`,
        color: "var(--text-muted)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

// ── Portail ──────────────────────────────────────────────────────────────────

function NotePortal({ target, alias }: { target: string; alias?: string }): React.JSX.Element {
  const { depth, chain } = useContext(PortalDepthContext);
  const router = useRouter();
  const utils = trpc.useUtils();
  const key = normalizeTarget(target);
  const isCycle = chain.includes(key);
  const tooDeep = depth >= MAX_PORTAL_DEPTH;

  const enabled = !!key && !isCycle;
  // Résolution wikilink → entité (même chemin que le hover-preview).
  const search = trpc.entities.search.useQuery(
    { query: target, limit: 1 },
    { enabled, staleTime: 30_000 },
  );
  const hitId = search.data?.items?.[0]?.id;
  const noteQuery = trpc.entities.get.useQuery(
    { id: hitId ?? "" },
    { enabled: enabled && !!hitId },
  );
  const note = noteQuery.data ?? null;

  // Body initial capturé une seule fois : les invalidations ultérieures
  // (déclenchées par nos propres saves) ne doivent pas remonter l'éditeur.
  const [initialBody, setInitialBody] = useState<string | null>(null);
  useEffect(() => {
    if (initialBody === null && note !== null) {
      setInitialBody(typeof note.body === "string" ? note.body : "");
    }
  }, [note, initialBody]);

  // Sauvegarde debouncée — body seul, le titre de la cible n'est pas touché.
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      if (hitId) void utils.entities.get.invalidate({ id: hitId });
    },
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleChange = useCallback(
    (markdown: string) => {
      if (!hitId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveState("saving");
      debounceRef.current = setTimeout(async () => {
        debounceRef.current = null;
        try {
          await updateMutation.mutateAsync({ id: hitId, body: markdown });
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 2000);
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [hitId, updateMutation],
  );

  // Resolvers minimaux pour les wikilinks/mentions de l'éditeur imbriqué.
  const resolvers = useMemo(
    () => ({
      searchEntities: async (query: string, typeId?: string): Promise<EntityRef[]> => {
        try {
          const res = await utils.entities.search.fetch({ query, typeId, limit: 8 });
          return res.items.map((e) => ({
            id: e.id,
            name: entityDisplayName(e),
            type: e.typeId,
          }));
        } catch {
          return [];
        }
      },
      previewEntity: async (name: string) => {
        try {
          const res = await utils.entities.search.fetch({ query: name, limit: 1 });
          const hit = res.items[0];
          if (!hit) return null;
          const full = await utils.entities.get.fetch({ id: hit.id });
          const body = typeof (full as { body?: unknown }).body === "string"
            ? (full as { body: string }).body
            : "";
          const excerpt = body.replace(/[#>*`~_[\]|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
          return { title: entityDisplayName(full), excerpt };
        } catch {
          return null;
        }
      },
    }),
    [utils],
  );

  const [hovered, setHovered] = useState(false);

  // ── États dégradés ─────────────────────────────────────────────────────────
  if (!key) return <PortalCard muted>Portail sans cible — choisis une note.</PortalCard>;
  if (isCycle) return <PortalCard muted>↻ Boucle de portails détectée ([[{target}]]).</PortalCard>;
  if (search.isLoading || (hitId && initialBody === null && noteQuery.isLoading)) {
    return (
      <PortalCard muted>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Spinner size="sm" aria-label="Chargement du portail" /> [[{target}]]
        </span>
      </PortalCard>
    );
  }
  if (!hitId || !note) return <PortalCard muted>Note introuvable : [[{target}]]</PortalCard>;

  const title = alias || entityDisplayName(note);
  const openNote = (): void => router.push(`/notes/${note.id}`);

  // Profondeur max : carte compacte cliquable, pas d'éditeur imbriqué.
  if (tooDeep) {
    return (
      <PortalCard>
        <span
          onClick={openNote}
          style={{ cursor: "pointer", color: "var(--text-primary)", fontWeight: 600 }}
        >
          ⤢ {title}
        </span>
        <span style={{ marginLeft: 8 }}>profondeur max atteinte</span>
      </PortalCard>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 10,
        border: "1px solid var(--border-subtle)",
        borderLeft: `3px solid ${PORTAL_ACCENT}`,
        background: "var(--surface-1)",
        boxShadow: hovered ? "0 6px 20px rgba(99,102,241,0.12)" : "0 1px 3px rgba(0,0,0,0.05)",
        transition: "box-shadow 160ms ease",
        overflow: "hidden",
      }}
    >
      {/* Header portail */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "color-mix(in srgb, var(--surface-2) 60%, transparent)",
          fontSize: 12,
        }}
      >
        <span aria-hidden="true" style={{ color: PORTAL_ACCENT }}>⤢</span>
        <span
          onClick={openNote}
          title="Ouvrir la note"
          style={{ fontWeight: 600, color: "var(--text-primary)", cursor: "pointer" }}
        >
          {title}
        </span>
        <span style={{ color: "var(--text-muted)" }}>portail</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {saveState === "saving" && <span style={{ color: "var(--text-muted)" }}>…</span>}
          {saveState === "saved" && <span style={{ color: "var(--text-muted)" }}>✓</span>}
          {saveState === "error" && <span style={{ color: "var(--destructive)" }}>échec sauvegarde</span>}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Ouvrir la note"
            onPress={openNote}
          >
            <ArrowSquareOut size={14} />
          </Button>
        </span>
      </div>

      {/* Éditeur imbriqué — la profondeur augmente pour les portails enfants. */}
      <div style={{ padding: "2px 4px" }}>
        <PortalDepthContext.Provider
          value={{ depth: depth + 1, chain: [...chain, key] }}
        >
          <SupernoteEditor
            key={note.id}
            initialMarkdown={initialBody ?? ""}
            onChange={handleChange}
            resolvers={resolvers}
            renderDatabaseView={renderInlineDatabase}
            renderFormula={renderNoteFormula}
            renderEmbed={renderNotePortal}
            renderDoodle={renderDoodle}
            topToolbar={false}
          />
        </PortalDepthContext.Provider>
      </div>
    </div>
  );
}
