"use client";

import { useRouter } from "next/navigation";
import { LinkSimple } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
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
    .slice(0, 160);
}

interface BacklinksProps {
  entityId: string;
  /** Appelé avant d'ouvrir une source, pour refermer l'hôte (side-peek). */
  onNavigate?: () => void;
  className?: string;
}

/**
 * Liens entrants d'une note ou d'une entité (`[[wikilink]]`, embed, `@mention`),
 * avec la ligne qui porte le lien. Une note source s'ouvre, une entité de base
 * s'ouvre en side-peek. Rien n'est rendu pendant le chargement ni sans worker
 * (mode dégradé) : le bloc vit en pied de chaque note, un spinner ou une erreur
 * y feraient du bruit.
 */
export function Backlinks({ entityId, onNavigate, className }: BacklinksProps) {
  const router = useRouter();
  // staleTime 0 : un lien posé depuis une autre note doit apparaître dès qu'on
  // rouvre celle-ci, et la requête est indexée.
  const { data } = trpc.entities.getBacklinks.useQuery(
    { id: entityId },
    { retry: false, staleTime: 0 },
  );
  if (!data) return null;

  const open = (sourceId: string, sourceTypeId: string) => {
    onNavigate?.();
    if (sourceTypeId === "note") {
      router.push(`/notes/${sourceId}`);
      return;
    }
    window.dispatchEvent(
      new CustomEvent("supernote:open-peek", {
        detail: { baseId: sourceTypeId, entityId: sourceId },
      }),
    );
  };

  return (
    <section aria-label="Liens entrants" className={className}>
      <div className="flex items-center gap-1.5 pb-1">
        <LinkSimple size={12} weight="bold" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
        <span className="sn-eyebrow sn-eyebrow--compact">Liens entrants</span>
        {data.length > 0 && (
          <span className="text-[10.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {data.length}
          </span>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Aucun lien entrant — tape @ dans une autre note pour en créer un.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {data.map((link) => (
            <li key={link.sourceId}>
              <Button
                variant="ghost"
                size="sm"
                onPress={() => open(link.sourceId, link.sourceTypeId)}
                className="flex h-auto min-h-8 w-full flex-col items-start gap-0.5 whitespace-normal px-2 py-1.5 text-left"
              >
                <span
                  className="w-full truncate text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {link.sourceTitle || "Sans titre"}
                </span>
                {link.context && (
                  <span
                    className="line-clamp-2 w-full text-xs font-normal leading-snug"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {stripNoise(link.context)}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
