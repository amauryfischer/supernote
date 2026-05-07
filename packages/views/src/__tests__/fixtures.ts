import type { Entity, EntityType, SelectField } from "@supernote/core/types";
import type { ViewDefinition, RelationEdge } from "../types/index.js";

export const mockSchema: EntityType = {
  id: "task",
  name: "Task",
  plural: "Tasks",
  defaultPath: "tasks",
  fileNamePattern: "{title}.md",
  fields: [
    {
      id: "title",
      name: "title",
      label: "Title",
      kind: "text",
      required: true,
      unique: false,
    },
    {
      id: "status",
      name: "status",
      label: "Status",
      kind: "select",
      required: false,
      unique: false,
      options: [
        { value: "todo", label: "To Do", color: "#94a3b8" },
        { value: "in_progress", label: "In Progress", color: "#3b82f6" },
        { value: "done", label: "Done", color: "#22c55e" },
      ],
    } as SelectField,
    {
      id: "priority",
      name: "priority",
      label: "Priority",
      kind: "number",
      required: false,
      unique: false,
    },
    {
      id: "due_date",
      name: "due_date",
      label: "Due Date",
      kind: "date",
      required: false,
      unique: false,
    },
    {
      id: "start_date",
      name: "start_date",
      label: "Start Date",
      kind: "date",
      required: false,
      unique: false,
    },
  ],
};

const now = new Date("2026-05-07T10:00:00Z");
const future = new Date("2026-05-14T10:00:00Z");

export const mockEntities: Entity[] = [
  {
    id: "e1",
    typeId: "task",
    filePath: "tasks/e1.md",
    body: "",
    createdAt: now,
    updatedAt: now,
    fields: {
      title: "Task Alpha",
      status: "todo",
      priority: 1,
      due_date: now,
      start_date: new Date("2026-05-01"),
    },
  },
  {
    id: "e2",
    typeId: "task",
    filePath: "tasks/e2.md",
    body: "",
    createdAt: now,
    updatedAt: now,
    fields: {
      title: "Task Beta",
      status: "in_progress",
      priority: 2,
      due_date: future,
      start_date: new Date("2026-05-05"),
    },
  },
  {
    id: "e3",
    typeId: "task",
    filePath: "tasks/e3.md",
    body: "",
    createdAt: now,
    updatedAt: now,
    fields: {
      title: "Task Gamma",
      status: "done",
      priority: 3,
      due_date: future,
      start_date: new Date("2026-05-03"),
    },
  },
  {
    id: "e4",
    typeId: "task",
    filePath: "tasks/e4.md",
    body: "",
    createdAt: now,
    updatedAt: now,
    fields: {
      title: "Task Delta",
      status: "todo",
      priority: 4,
      due_date: null,
      start_date: null,
    },
  },
];

export const mockEdges: RelationEdge[] = [
  { id: "r1", sourceId: "e1", targetId: "e2", relationTypeId: "depends_on", label: "depends on" },
  { id: "r2", sourceId: "e2", targetId: "e3", relationTypeId: "depends_on", label: "depends on" },
];

export const tableView: ViewDefinition = {
  id: "v1",
  name: "All Tasks",
  kind: "table",
  columns: [
    { fieldId: "title" },
    { fieldId: "status" },
    { fieldId: "priority" },
  ],
};

export const kanbanView: ViewDefinition = {
  id: "v2",
  name: "Kanban",
  kind: "kanban",
  groupBy: "status",
};

export const galleryView: ViewDefinition = {
  id: "v3",
  name: "Gallery",
  kind: "gallery",
  cardConfig: {
    colCount: 3,
  },
};

export const calendarView: ViewDefinition = {
  id: "v4",
  name: "Calendar",
  kind: "calendar",
  dateField: "due_date",
};

export const timelineView: ViewDefinition = {
  id: "v5",
  name: "Timeline",
  kind: "timeline",
  dateField: "start_date",
  endDateField: "due_date",
  groupBy: "status",
};

export const graphView: ViewDefinition = {
  id: "v6",
  name: "Graph",
  kind: "graph",
};
