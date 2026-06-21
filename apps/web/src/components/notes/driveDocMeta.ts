/**
 * Méta UI des types de fichiers Google créables — la partie « icône » qui
 * complète {@link GOOGLE_DOC_KINDS} (label/ext/mime). Séparé pour être partagé
 * par les surfaces de création (FAB mobile, menu contextuel, éditeur vide) sans
 * dupliquer le mapping ni mélanger icônes et logique Drive.
 */

import { FileDoc, Presentation, Table } from "@phosphor-icons/react";
import type { GoogleDocKind } from "@/lib/google-drive";

export type IconComponent = typeof FileDoc;

/** Ordre d'affichage stable : Doc, Sheet, Slides. */
export const DRIVE_DOC_ORDER: GoogleDocKind[] = [
  "document",
  "spreadsheet",
  "presentation",
];

export const DRIVE_DOC_ICONS: Record<GoogleDocKind, IconComponent> = {
  document: FileDoc,
  spreadsheet: Table,
  presentation: Presentation,
};
