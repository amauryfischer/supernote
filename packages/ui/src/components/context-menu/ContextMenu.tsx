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
        top: state.y,
        left: state.x,
        zIndex: 1000,
        minWidth: 200,
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
              <span className="shrink-0 text-[var(--text-muted)]">{item.icon}</span>
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
 */
export function useContextMenu() {
  const [state, setState] = React.useState<ContextMenuState | null>(null);

  const open = React.useCallback(
    (e: React.MouseEvent, items: ContextMenuItemDef[]) => {
      e.preventDefault();
      setState({ x: e.clientX, y: e.clientY, items });
    },
    []
  );

  const close = React.useCallback(() => setState(null), []);

  return { state, open, close };
}
