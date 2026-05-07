import React from "react";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../types/index.js";
import { TableView } from "./table/index.js";
import { KanbanView } from "./kanban/index.js";
import { GalleryView } from "./gallery/index.js";
import { CalendarView } from "./calendar/index.js";
import { TimelineView } from "./timeline/index.js";
import { GraphView } from "./graph/index.js";

export function ViewRenderer<T extends Entity = Entity>(
  props: ViewProps<T>
): React.JSX.Element {
  const { view } = props;
  switch (view.kind) {
    case "table":
      return <TableView {...props} />;
    case "kanban":
      return <KanbanView {...props} />;
    case "gallery":
      return <GalleryView {...props} />;
    case "calendar":
      return <CalendarView {...props} />;
    case "timeline":
      return <TimelineView {...props} />;
    case "graph":
      return <GraphView {...props} />;
    default: {
      const _exhaustive: never = view.kind;
      return (
        <div>Unknown view kind: {String(_exhaustive)}</div>
      );
    }
  }
}
