"use client";

import type { RelationType } from "./fixtures";
import { relationColor } from "./utils";

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

export function RelationChip({ type }: RelationChipProps) {
  const { bg, text } = relationColor(type);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
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
