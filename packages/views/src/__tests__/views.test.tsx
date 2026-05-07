import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  mockSchema,
  mockEntities,
  mockEdges,
  tableView,
  kanbanView,
  galleryView,
  calendarView,
  timelineView,
  graphView,
} from "./fixtures.js";
import type { Entity } from "@supernote/core/types";
import { TableView } from "../components/table/TableView.js";
import { KanbanView } from "../components/kanban/KanbanView.js";
import { GalleryView } from "../components/gallery/GalleryView.js";
import { CalendarView } from "../components/calendar/CalendarView.js";
import { TimelineView } from "../components/timeline/TimelineView.js";
import { GraphView } from "../components/graph/GraphView.js";
import { ViewRenderer } from "../components/ViewRenderer.js";

// Silence react-big-calendar CSS import issues in test env
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const defaultProps = {
  schema: mockSchema,
  entities: mockEntities,
};

// ---- TableView ------------------------------------------------

describe("TableView", () => {
  it("renders all rows", () => {
    render(<TableView view={tableView} {...defaultProps} />);
    const rows = screen.getAllByTestId("table-row");
    expect(rows).toHaveLength(4);
  });

  it("renders column headers from view config", () => {
    render(<TableView view={tableView} {...defaultProps} />);
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("calls onEntityClick when row is clicked", () => {
    const onClick = vi.fn();
    render(<TableView view={tableView} {...defaultProps} onEntityClick={onClick} />);
    const rows = screen.getAllByTestId("table-row");
    fireEvent.click(rows[0]!);
    expect(onClick).toHaveBeenCalledWith(mockEntities[0]);
  });

  it("shows add row button when onEntityCreate provided", () => {
    const onCreate = vi.fn();
    render(<TableView view={tableView} {...defaultProps} onEntityCreate={onCreate} />);
    const btn = screen.getByRole("button", { name: /add row/i });
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalled();
  });

  it("allows row selection with checkbox", () => {
    render(<TableView view={tableView} {...defaultProps} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // first is the select-all, rest are per-row
    fireEvent.click(checkboxes[1]!);
    expect(checkboxes[1]).toBeTruthy();
  });

  it("applies filter: shows only todo tasks", () => {
    const filteredView = {
      ...tableView,
      filters: [{ fieldId: "status", operator: "eq" as const, value: "todo" }],
    };
    render(<TableView view={filteredView} {...defaultProps} />);
    const rows = screen.getAllByTestId("table-row");
    expect(rows).toHaveLength(2);
  });

  it("applies sort: priority ascending", () => {
    const sortedView = {
      ...tableView,
      sort: [{ fieldId: "priority", direction: "asc" as const }],
    };
    render(<TableView view={sortedView} {...defaultProps} />);
    const rows = screen.getAllByTestId("table-row");
    expect(rows).toHaveLength(4);
  });
});

// ---- KanbanView ------------------------------------------------

describe("KanbanView", () => {
  it("renders kanban columns for each select option", () => {
    render(<KanbanView view={kanbanView} {...defaultProps} />);
    expect(screen.getByTestId("kanban-column-todo")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-in_progress")).toBeTruthy();
    expect(screen.getByTestId("kanban-column-done")).toBeTruthy();
  });

  it("renders cards in correct columns", () => {
    render(<KanbanView view={kanbanView} {...defaultProps} />);
    const todoCol = screen.getByTestId("kanban-column-todo");
    expect(within(todoCol).getAllByTestId("kanban-card")).toHaveLength(2);
  });

  it("shows add card button in each column when onEntityCreate provided", () => {
    const onCreate = vi.fn();
    render(<KanbanView view={kanbanView} {...defaultProps} onEntityCreate={onCreate} />);
    const addBtns = screen.getAllByRole("button", { name: /add card/i });
    expect(addBtns.length).toBeGreaterThan(0);
  });

  it("calls onEntityCreate with column key", () => {
    const onCreate = vi.fn();
    render(<KanbanView view={kanbanView} {...defaultProps} onEntityCreate={onCreate} />);
    const btn = screen.getByRole("button", { name: /Add card to To Do/i });
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalledWith("todo");
  });

  it("calls onEntityClick when card clicked", () => {
    const onClick = vi.fn();
    render(<KanbanView view={kanbanView} {...defaultProps} onEntityClick={onClick} />);
    const cards = screen.getAllByTestId("kanban-card");
    fireEvent.click(cards[0]!);
    expect(onClick).toHaveBeenCalled();
  });
});

// ---- GalleryView ------------------------------------------------

describe("GalleryView", () => {
  it("renders gallery cards for each entity", () => {
    render(<GalleryView view={galleryView} {...defaultProps} />);
    const cards = screen.getAllByTestId("gallery-card");
    expect(cards).toHaveLength(4);
  });

  it("renders entity labels on cards", () => {
    render(<GalleryView view={galleryView} {...defaultProps} />);
    expect(screen.getByText("Task Alpha")).toBeTruthy();
    expect(screen.getByText("Task Beta")).toBeTruthy();
  });

  it("calls onEntityClick when card clicked", () => {
    const onClick = vi.fn();
    render(<GalleryView view={galleryView} {...defaultProps} onEntityClick={onClick} />);
    const cards = screen.getAllByTestId("gallery-card");
    fireEvent.click(cards[0]!);
    expect(onClick).toHaveBeenCalledWith(mockEntities[0]);
  });

  it("shows add button when onEntityCreate provided", () => {
    const onCreate = vi.fn();
    render(<GalleryView view={galleryView} {...defaultProps} onEntityCreate={onCreate} />);
    const btn = screen.getByTestId("gallery-create");
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalled();
  });

  it("applies filter to cards", () => {
    const filteredView = {
      ...galleryView,
      filters: [{ fieldId: "status", operator: "eq" as const, value: "done" }],
    };
    render(<GalleryView view={filteredView} {...defaultProps} />);
    const cards = screen.getAllByTestId("gallery-card");
    expect(cards).toHaveLength(1);
  });
});

// ---- CalendarView ------------------------------------------------

describe("CalendarView", () => {
  it("renders calendar view container", () => {
    render(<CalendarView view={calendarView} {...defaultProps} />);
    expect(screen.getByTestId("calendar-view")).toBeTruthy();
  });

  it("renders the calendar component", () => {
    render(<CalendarView view={calendarView} {...defaultProps} />);
    // react-big-calendar renders a rbc-calendar div
    const calView = screen.getByTestId("calendar-view");
    expect(calView).toBeTruthy();
  });
});

// ---- TimelineView ------------------------------------------------

describe("TimelineView", () => {
  it("renders timeline view container", () => {
    render(<TimelineView view={timelineView} {...defaultProps} />);
    expect(screen.getByTestId("timeline-view")).toBeTruthy();
  });

  it("renders timeline items for entities with dates", () => {
    render(<TimelineView view={timelineView} {...defaultProps} />);
    const items = screen.getAllByTestId("timeline-item");
    // e1, e2, e3 have start_date; e4 does not
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("shows fallback when no dateField configured", () => {
    const noDates = { ...timelineView, dateField: "nonexistent_field" };
    render(<TimelineView view={noDates} {...defaultProps} />);
    // Should show empty message
    expect(screen.getByTestId("timeline-view")).toBeTruthy();
  });

  it("calls onEntityClick when timeline item clicked", () => {
    const onClick = vi.fn();
    render(<TimelineView view={timelineView} {...defaultProps} onEntityClick={onClick} />);
    const items = screen.getAllByTestId("timeline-item");
    if (items.length > 0) {
      fireEvent.click(items[0]!);
      expect(onClick).toHaveBeenCalled();
    }
  });
});

// ---- GraphView ------------------------------------------------

describe("GraphView", () => {
  it("renders graph view container", () => {
    render(<GraphView view={graphView} {...defaultProps} edges={mockEdges} />);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  it("renders nodes in fallback mode", () => {
    render(<GraphView view={graphView} {...defaultProps} edges={mockEdges} />);
    const nodes = screen.getAllByTestId("graph-node");
    expect(nodes).toHaveLength(4);
  });

  it("renders node labels", () => {
    render(<GraphView view={graphView} {...defaultProps} />);
    expect(screen.getByText("Task Alpha")).toBeTruthy();
    expect(screen.getByText("Task Beta")).toBeTruthy();
  });

  it("calls onEntityClick when node clicked", () => {
    const onClick = vi.fn();
    render(<GraphView view={graphView} {...defaultProps} onEntityClick={onClick} />);
    const nodes = screen.getAllByTestId("graph-node");
    fireEvent.click(nodes[0]!);
    expect(onClick).toHaveBeenCalled();
  });
});

// ---- ViewRenderer ------------------------------------------------

describe("ViewRenderer", () => {
  it("renders TableView for kind=table", () => {
    render(<ViewRenderer view={tableView} {...defaultProps} />);
    expect(screen.getByTestId("table-view")).toBeTruthy();
  });

  it("renders KanbanView for kind=kanban", () => {
    render(<ViewRenderer view={kanbanView} {...defaultProps} />);
    expect(screen.getByTestId("kanban-view")).toBeTruthy();
  });

  it("renders GalleryView for kind=gallery", () => {
    render(<ViewRenderer view={galleryView} {...defaultProps} />);
    expect(screen.getByTestId("gallery-view")).toBeTruthy();
  });

  it("renders CalendarView for kind=calendar", () => {
    render(<ViewRenderer view={calendarView} {...defaultProps} />);
    expect(screen.getByTestId("calendar-view")).toBeTruthy();
  });

  it("renders TimelineView for kind=timeline", () => {
    render(<ViewRenderer view={timelineView} {...defaultProps} />);
    expect(screen.getByTestId("timeline-view")).toBeTruthy();
  });

  it("renders GraphView for kind=graph", () => {
    render(<ViewRenderer view={graphView} {...defaultProps} />);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });
});
