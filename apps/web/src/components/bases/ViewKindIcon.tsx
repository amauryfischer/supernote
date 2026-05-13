"use client";

import {
  Table,
  Kanban,
  GridFour,
  CalendarBlank,
  List,
} from "@phosphor-icons/react";
import type { ViewKind } from "@supernote/ipc";

interface ViewKindIconProps {
  kind: ViewKind;
  size?: number;
}

export function ViewKindIcon({ kind, size = 14 }: ViewKindIconProps) {
  switch (kind) {
    case "table":
      return <Table size={size} />;
    case "board":
      return <Kanban size={size} />;
    case "gallery":
      return <GridFour size={size} />;
    case "calendar":
      return <CalendarBlank size={size} />;
    case "list":
      return <List size={size} />;
    default:
      return <Table size={size} />;
  }
}

export const VIEW_KIND_LABEL: Record<ViewKind, string> = {
  table: "Tableau",
  board: "Tableau Kanban",
  gallery: "Galerie",
  calendar: "Calendrier",
  list: "Liste",
};
