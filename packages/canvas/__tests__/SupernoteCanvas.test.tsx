// ============================================================
// SupernoteCanvas smoke tests
// ============================================================

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SupernoteCanvas } from "../src/components/SupernoteCanvas.js";
import type { CanvasDocument } from "../src/types/canvas.js";

// Excalidraw requires DOM APIs and ships its own stylesheet — mock both for
// unit tests so the canvas renders without pulling the heavy editor.
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => <div data-testid="excalidraw" />,
  convertToExcalidrawElements: (xs: unknown) => xs,
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

const SAMPLE_DOC: CanvasDocument = {
  nodes: [
    {
      id: "n1",
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      text: "Hello Supernote",
    },
    {
      id: "n2",
      type: "crm",
      x: 250,
      y: 0,
      width: 240,
      height: 120,
      entityId: "entity-123",
      display: "card",
    },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
};

describe("SupernoteCanvas", () => {
  it("renders without crashing with no props", () => {
    const { container } = render(<SupernoteCanvas />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with initial data", () => {
    const { container } = render(<SupernoteCanvas initialData={SAMPLE_DOC} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the Excalidraw layer (no mode toggle)", () => {
    render(<SupernoteCanvas initialData={SAMPLE_DOC} />);
    // The legacy Nodes/Draw toggle has been removed entirely.
    expect(screen.queryByText("Nodes")).toBeNull();
    expect(screen.queryByText("Draw")).toBeNull();
    expect(screen.getByTestId("excalidraw")).toBeTruthy();
  });

  it("calls onChange with a migrated, pure-Excalidraw document", () => {
    const onChange = vi.fn();
    render(<SupernoteCanvas initialData={SAMPLE_DOC} onChange={onChange} />);
    // After legacy migration, `nodes`/`edges` are wiped and the typed nodes
    // are converted into Excalidraw elements appended to `excalidrawElements`.
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
      | CanvasDocument
      | undefined;
    expect(lastCall).toBeTruthy();
    expect(lastCall?.nodes).toEqual([]);
    expect(lastCall?.edges).toEqual([]);
    // At least one element migrated from the original CRM + text nodes.
    expect((lastCall?.excalidrawElements ?? []).length).toBeGreaterThan(0);
  });

  it("preserves an empty doc with no migration", () => {
    const onChange = vi.fn();
    render(<SupernoteCanvas onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({
      nodes: [],
      edges: [],
      excalidrawElements: [],
    });
  });

  it("applies className prop to container", () => {
    const { container } = render(<SupernoteCanvas className="my-canvas" />);
    expect((container.firstChild as HTMLElement).className).toContain(
      "my-canvas"
    );
  });

  it("renders the Excalidraw layer by default for new canvases", () => {
    render(<SupernoteCanvas />);
    expect(screen.getByTestId("excalidraw")).toBeTruthy();
  });

  it("preserves existing excalidrawElements when migrating legacy nodes", () => {
    const onChange = vi.fn();
    const docWithBoth: CanvasDocument = {
      ...SAMPLE_DOC,
      excalidrawElements: [
        { id: "draw-1", type: "rectangle", x: 100, y: 100 },
      ],
    };
    render(<SupernoteCanvas initialData={docWithBoth} onChange={onChange} />);
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as
      | CanvasDocument
      | undefined;
    expect(lastCall?.excalidrawElements?.[0]?.id).toBe("draw-1");
  });
});
