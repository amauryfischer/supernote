"use client";

import { Chip, Spinner } from "@heroui/react";
import {
  BookOpen,
  Calendar,
  FileText,
  Folder,
  Users,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

import { entityDisplayName } from "@/components/notes/adapters";
import { trpc } from "@/lib/trpc/client";
import type { SearchResult } from "@supernote/ipc";

// Icône par type d'entité — miroir de TYPE_ICON_MAP dans CommandPalette.
const TYPE_ICON_MAP: Record<string, PhosphorIcon> = {
  note: FileText,
  personne: Users,
  contact: Users,
  organisation: Folder,
  ressource: BookOpen,
  journal: Calendar,
};

// Longueur max de l'extrait affiché.
const EXCERPT_MAX = 400;

/** Transforme le markdown brut en texte lisible pour l'aperçu. */
function cleanExcerpt(body: string, max = EXCERPT_MAX): string {
  const stripped = body
    .replace(/\r/g, "")
    // retire la ponctuation markdown la plus courante (titres, listes, emphase…)
    .replace(/[#>*`~_[\]|-]/g, "")
    // compacte les sauts de ligne et espaces multiples
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max).trimEnd()}…` : stripped;
}

interface CommandPreviewProps {
  // Id de l'entité active (survol clavier ou souris) ; null si l'item actif
  // n'est pas une entité (ex. une commande seed).
  entityId: string | null;
  // Résultat de recherche correspondant — fournit titre/type instantanés le
  // temps que `entities.get` renvoie le body complet.
  activeResult: SearchResult | null;
}

/**
 * Panneau d'aperçu façon Raycast affiché à droite de la palette. Purement
 * décoratif (`aria-hidden`) : la navigation clavier reste pilotée par cmdk.
 */
export function CommandPreview({ entityId, activeResult }: CommandPreviewProps) {
  // staleTime long : on revisite souvent les mêmes notes en naviguant.
  const entityQuery = trpc.entities.get.useQuery(
    { id: entityId ?? "" },
    { enabled: !!entityId, staleTime: 30_000 },
  );

  // Aucune entité active (item = commande, ou liste vide) → invite douce.
  if (!entityId) {
    return (
      <div
        aria-hidden
        className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
      >
        <FileText size={22} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Survolez une note pour l'aperçu
        </span>
      </div>
    );
  }

  const data = entityQuery.data;
  const title = data ? entityDisplayName(data) : activeResult?.title || "Sans titre";
  const typeName = data?.typeName ?? activeResult?.typeName ?? activeResult?.typeId ?? "";
  const typeKey = (data?.typeId ?? activeResult?.typeId ?? "").toLowerCase();
  const Icon = TYPE_ICON_MAP[typeKey] ?? FileText;
  const excerpt = data ? cleanExcerpt(data.body) : "";
  const loadingBody = entityQuery.isLoading && !data;

  return (
    <div aria-hidden className="flex h-full flex-col gap-3 px-4 py-4">
      {/* En-tête : icône + titre + chip du type */}
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded"
          style={{
            backgroundColor: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          <Icon size={15} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className="text-sm font-semibold leading-snug"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </span>
          {typeName && (
            <span>
              <Chip size="sm" variant="soft">
                {typeName}
              </Chip>
            </span>
          )}
        </div>
      </div>

      {/* Corps : extrait nettoyé, ou spinner pendant le chargement */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {loadingBody ? (
          <div className="flex h-full items-center justify-center py-6">
            <Spinner size="sm" />
          </div>
        ) : excerpt ? (
          <p
            className="whitespace-pre-wrap text-xs leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            {excerpt}
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
            Note vide
          </p>
        )}
      </div>
    </div>
  );
}
