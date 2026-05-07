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
      style={{ top: state.y, left: state.x, zIndex: "var(--z-dropdown)" } as React.CSSProperties}
      className="fixed min-w-[180px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-1 [box-shadow:var(--shadow-lg)]"
    >
      {state.items.map((item) => {
        if (item.separator) {
          return (
            <div
              key={item.key}
              className="my-1 h-px bg-[var(--border-subtle)]"
              role="separator"
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
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-1.5 text-left text-sm transition-colors",
              item.isDanger
                ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-50)]"
                : "text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
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
