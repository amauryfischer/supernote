import * as React from "react";
import { SeparatorRoot } from "@heroui/react";
import { cn } from "../../cn.js";

export interface SeparatorProps {
  /** Orientation of the divider. */
  orientation?: "horizontal" | "vertical";
  /** Optional label centered on the divider. */
  label?: React.ReactNode;
  /** Additional class. */
  className?: string;
}

/**
 * Separator — horizontal or vertical divider line with optional label.
 */
export function Separator({
  orientation = "horizontal",
  label,
  className,
}: SeparatorProps) {
  if (label) {
    return (
      <div
        className={cn(
          "flex items-center gap-3",
          orientation === "vertical" && "flex-col",
          className
        )}
        role="separator"
      >
        <SeparatorRoot
          orientation={orientation}
          className={cn(
            "flex-1 bg-[var(--border-subtle)]",
            orientation === "horizontal" ? "h-px" : "w-px"
          )}
        />
        <span className="shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
        <SeparatorRoot
          orientation={orientation}
          className={cn(
            "flex-1 bg-[var(--border-subtle)]",
            orientation === "horizontal" ? "h-px" : "w-px"
          )}
        />
      </div>
    );
  }

  return (
    <SeparatorRoot
      orientation={orientation}
      className={cn(
        "bg-[var(--border-subtle)]",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
    />
  );
}

