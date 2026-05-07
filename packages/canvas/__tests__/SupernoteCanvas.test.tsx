// ============================================================
// SupernoteCanvas smoke tests
// ============================================================

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SupernoteCanvas } from "../src/components/SupernoteCanvas.js";
import type { CanvasDocument } from "../src/types/canvas.js";

// React Flow and Excalidraw require DOM APIs — mock them for unit tests
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => <div />,
  Controls: () => <div />,
  MiniMap: () => <div />,
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
}));

vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => <div data-testid="excalidraw" />,
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

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
    const { container } = render(
      <SupernoteCanvas />
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders with initial data", () => {
    const { container } = render(
      <SupernoteCanvas initialData={SAMPLE_DOC} />
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders mode toggle buttons", () => {
    render(<SupernoteCanvas />);
    expect(screen.getByText("Nodes")).toBeTruthy();
    expect(screen.getByText("Draw")).toBeTruthy();
  });

  it("does not render mode toggle in readOnly mode", () => {
    render(<SupernoteCanvas readOnly />);
    expect(screen.queryByText("Nodes")).toBeNull();
    expect(screen.queryByText("Draw")).toBeNull();
  });

  it("calls onChange when document changes", () => {
    const onChange = vi.fn();
    render(<SupernoteCanvas initialData={SAMPLE_DOC} onChange={onChange} />);
    // onChange is called on mount with the initial document
    expect(onChange).toHaveBeenCalledWith(SAMPLE_DOC);
  });

  it("applies className prop to container", () => {
    const { container } = render(
      <SupernoteCanvas className="my-canvas" />
    );
    expect((container.firstChild as HTMLElement).className).toContain("my-canvas");
  });

  it("renders React Flow layer in nodes mode (default)", () => {
    render(<SupernoteCanvas initialData={SAMPLE_DOC} />);
    expect(screen.getByTestId("react-flow")).toBeTruthy();
  });
});
