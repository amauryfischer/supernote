import * as React from "react";
import { cn } from "../../cn.js";

export interface ContextMenuItemDef {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string;
  isDanger?: boolean;
  isDisabled?: boolean;
  separator?: boolean;
  onPress?: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItemDef[];
}

export interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

/**
 * ContextMenu — absolutely positioned menu triggered by right-click.
 * Use the `useContextMenu` hook to manage open state.
 */
export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Position effectivement rendue. Elle part du point demandé, puis est
  // ramenée dans le viewport une fois le menu mesuré : un menu ouvert près
  // d'un bord sortait de l'écran, ce qui est systématique sur la largeur
  // d'un téléphone (le menu fait ~200px de large minimum).
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!state) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    const next = {
      x: Math.min(Math.max(margin, state.x), maxX),
      y: Math.min(Math.max(margin, state.y), maxY),
    };
    setPos((prev) =>
      prev && prev.x === next.x && prev.y === next.y ? prev : next,
    );
  }, [state]);

  React.useEffect(() => {
    if (!state) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof MouseEvent &&
        ref.current &&
        !ref.current.contains(e.target as Node)
      ) {
        onClose();
      }
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      role="menu"
      // Inline styles instead of Tailwind arbitrary classes so the menu still
      // renders with a real solid background when the host app's Tailwind JIT
      // didn't see the `bg-[var(--surface-1)]` class (it lives inside the
      // pre-built @supernote/ui dist that isn't scanned by the consumer's
      // Tailwind config).
      style={{
        position: "fixed",
        // Avant mesure, le menu est rendu invisible à l'origine — pas au point
        // demandé : posé près d'un bord il s'y replierait à une largeur plus
        // étroite que sa largeur naturelle, et le clamp serait calculé faux.
        top: pos ? pos.y : 0,
        left: pos ? pos.x : 0,
        visibility: pos ? "visible" : "hidden",
        zIndex: 1000,
        minWidth: 200,
        maxWidth: "calc(100vw - 16px)",
        padding: 4,
        borderRadius: 8,
        border: "1px solid var(--border-subtle, #e5e7eb)",
        backgroundColor: "var(--surface-1, #ffffff)",
        boxShadow: "var(--shadow-lg, 0 10px 30px rgba(0,0,0,.18))",
      }}
    >
      {state.items.map((item) => {
        if (item.separator) {
          return (
            <div
              key={item.key}
              role="separator"
              style={{
                margin: "4px 0",
                height: 1,
                backgroundColor: "var(--border-subtle, #e5e7eb)",
              }}
            />
          );
        }
        return (
          <button
            key={item.key}
            role="menuitem"
            disabled={item.isDisabled}
            onClick={() => {
              item.onPress?.();
              onClose();
            }}
            onMouseEnter={(e) => {
              if (item.isDisabled) return;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = item.isDanger
                ? "var(--color-danger-50, #fee2e2)"
                : "var(--surface-2, #f3f4f6)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
            }}
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              gap: 10,
              padding: "6px 12px",
              borderRadius: 6,
              textAlign: "left",
              fontSize: 14,
              transition: "background-color 120ms",
              backgroundColor: "transparent",
              color: item.isDanger ? "var(--color-danger, #ef4444)" : "var(--text-primary, #111)",
              opacity: item.isDisabled ? 0.5 : 1,
              cursor: item.isDisabled ? "not-allowed" : "pointer",
              border: "none",
            }}
            className={cn(
              item.isDisabled && "cursor-not-allowed opacity-50"
            )}
          >
            {item.icon && (
              <span
                className="shrink-0"
                style={{
                  color: item.isDanger
                    ? "var(--color-danger, #ef4444)"
                    : "var(--text-muted)",
                }}
              >
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * useContextMenu — manages ContextMenu open state from a right-click handler.
 *
 * `open` is the mouse path. `openAt` is the same menu addressed by raw
 * viewport coordinates, so touch surfaces can reach it from a long-press —
 * iOS never emits `contextmenu`, and without this every touch surface would
 * have to grow a second, divergent menu of its own.
 */
export function useContextMenu() {
  const [state, setState] = React.useState<ContextMenuState | null>(null);

  const openAt = React.useCallback(
    (x: number, y: number, items: ContextMenuItemDef[]) => {
      setState({ x, y, items });
    },
    []
  );

  const open = React.useCallback(
    (e: React.MouseEvent, items: ContextMenuItemDef[]) => {
      e.preventDefault();
      openAt(e.clientX, e.clientY, items);
    },
    [openAt]
  );

  const close = React.useCallback(() => setState(null), []);

  return { state, open, openAt, close };
}
