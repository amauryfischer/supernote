"use client";

import type { RelationType } from "./fixtures";

interface RelationChipProps {
  type: RelationType;
}

const LABELS: Record<RelationType, string> = {
  ami: "Ami",
  famille: "Famille",
  collègue: "Collègue",
  client: "Client",
  mentor: "Mentor",
  connaissance: "Connaissance",
  partenaire: "Partenaire",
};

/**
 * Chip de type de relation — neutre et tokenisé (donc theme-aware). Le libellé
 * porte la catégorie. L'ancien traitement peignait 7 pastels `oklch(0.88 …)`
 * figés (couleur = seul signal, chip clair resté clair en dark/ambiance) :
 * décoration pleine sur un attribut inactif, contraire au registre product
 * « l'outil s'efface » et au ban « couleur pleine sur états inactifs ».
 */
export function RelationChip({ type }: RelationChipProps) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-2)",
        color: "var(--text-secondary)",
      }}
    >
      {LABELS[type]}
    </span>
  );
}

export const ALL_RELATION_TYPES: RelationType[] = [
  "ami",
  "famille",
  "collègue",
  "client",
  "mentor",
  "connaissance",
  "partenaire",
];
