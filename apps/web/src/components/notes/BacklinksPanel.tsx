"use client";

import Link from "next/link";
import { Spinner } from "@heroui/react";
import { trpc } from "@/lib/trpc/client";

function stripNoise(text: string): string {
  return text
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    // Le rawText renvoyé par le worker est la ligne qui CONTIENT le lien —
    // garder le texte du wikilink (alias sinon cible) au lieu de le vider,
    // sans quoi l'aperçu perdrait justement la mention qui le justifie.
    .replace(
      /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_match, target: string, alias: string | undefined) => alias ?? target,
    )
    .replace(/#{1,6}\s+/g, "")
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 100);
}

/**
 * Nombre de liens entrants pour une note. S'appuie sur l'agrégat
 * `backlinkCounts` (une seule requête globale mise en cache) plutôt que de
 * charger la liste complète : idéal pour un badge toujours visible dans la
 * barre d'outils. Retourne 0 quand le worker est indisponible (mode démo).
 */
export function useBacklinkCount(noteId: string): number {
  const { data } = trpc.entities.backlinkCounts.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  return data?.counts[noteId] ?? 0;
}

interface BacklinksListProps {
  noteId: string;
  /**
   * Appelé quand l'utilisateur ouvre une source — sert à refermer le popover
   * (desktop) ou le sheet (mobile) qui héberge la liste.
   */
  onNavigate?: () => void;
}

/**
 * Liste des notes qui mentionnent (`[[wikilink]]` / embed) la note courante.
 * Contenu pur, sans chrome : à héberger dans un popover desktop ou un
 * `MobileSheet`. La requête `getBacklinks` n'est déclenchée que lorsque ce
 * composant est monté (donc à l'ouverture du panneau).
 */
export function BacklinksList({ noteId, onNavigate }: BacklinksListProps) {
  const { data, isLoading, isError } = trpc.entities.getBacklinks.useQuery(
    { id: noteId },
    { retry: false, staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Spinner size="sm" />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </span>
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Impossible de charger les liens entrants.
      </p>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Aucune note ne mentionne celle-ci pour le moment.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {data.map((link) => (
        <li key={link.sourceId} className="group flex flex-col gap-0.5">
          <Link
            href={`/notes/${link.sourceId}`}
            onClick={onNavigate}
            className="text-xs font-medium hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {link.sourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ??
              link.sourceId}
          </Link>
          {link.context && (
            <p
              className="text-[11px] leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              {stripNoise(link.context)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
