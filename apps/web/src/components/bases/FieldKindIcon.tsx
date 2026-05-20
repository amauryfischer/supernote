"use client";

/**
 * FieldKindIcon — petite icône qui résume le type d'un champ. Affichée dans
 * l'en-tête de colonne et le menu de type comme dans Coda.
 *
 * Choix d'icônes Phosphor : on évite les pleines pour rester discret. Toutes
 * en `size={11}` par défaut (taille header), `weight="regular"`.
 */

import {
  TextAa,
  TextT,
  Hash,
  CurrencyDollar,
  Percent,
  Star,
  ChartBar,
  Calendar,
  Clock,
  Hourglass,
  CheckSquare,
  Link as LinkIcon,
  Envelope,
  Phone,
  ListChecks,
  Tag,
  Paperclip,
  Image as ImageIcon,
  Palette,
  TextAlignLeft,
  ArrowsLeftRight,
  FunctionIcon,
  Stack,
  MagnifyingGlass,
  Plus,
  PencilSimple,
  IdentificationCard,
  Flag,
  Sparkle,
} from "@phosphor-icons/react";
import type { Field, FieldKind } from "@supernote/core";

export interface FieldKindIconProps {
  kind: FieldKind;
  size?: number;
}

export function FieldKindIcon({ kind, size = 11 }: FieldKindIconProps) {
  const Icon = ICONS[kind] ?? TextAa;
  return <Icon size={size} weight="regular" />;
}

const ICONS: Record<FieldKind, React.ComponentType<{ size?: number; weight?: "regular" | "bold" }>> = {
  text: TextT,
  longtext: TextAlignLeft,
  number: Hash,
  currency: CurrencyDollar,
  percent: Percent,
  rating: Star,
  progress: ChartBar,
  date: Calendar,
  datetime: Clock,
  duration: Hourglass,
  bool: CheckSquare,
  url: LinkIcon,
  email: Envelope,
  phone: Phone,
  select: ListChecks,
  multiselect: Tag,
  file: Paperclip,
  image: ImageIcon,
  color: Palette,
  markdown: TextAlignLeft,
  relation: ArrowsLeftRight,
  formula: FunctionIcon,
  rollup: Stack,
  lookup: MagnifyingGlass,
  createdAt: Plus,
  updatedAt: PencilSimple,
  createdBy: IdentificationCard,
  autoNumber: Hash,
  status: Flag,
  ai: Sparkle,
};

export const FIELD_KIND_LABEL: Record<FieldKind, string> = {
  text: "Texte",
  longtext: "Texte long",
  number: "Nombre",
  currency: "Devise",
  percent: "Pourcentage",
  rating: "Notation",
  progress: "Progression",
  date: "Date",
  datetime: "Date + heure",
  duration: "Durée",
  bool: "Booléen",
  url: "URL",
  email: "Email",
  phone: "Téléphone",
  select: "Sélection",
  multiselect: "Multi-sélection",
  file: "Fichier",
  image: "Image",
  color: "Couleur",
  markdown: "Markdown",
  relation: "Relation",
  formula: "Formule",
  rollup: "Rollup",
  lookup: "Lookup",
  createdAt: "Créé le",
  updatedAt: "Modifié le",
  createdBy: "Créé par",
  autoNumber: "Numéro auto",
  status: "Statut",
  ai: "IA",
};

/** Helper utilisé par la cellule pour résoudre le type concret (utile pour
 *  les vues qui rendent un picker dans une popover). */
export function fieldKindOf(field: Field): FieldKind {
  return field.kind;
}
