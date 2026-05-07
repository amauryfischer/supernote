import * as React from "react";
import { KbdRoot, KbdContent } from "@heroui/react";
import { cn } from "../../cn.js";

export type { KbdKey } from "@heroui/react";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Additional class. */
  className?: string;
  /** Text content (letter or short label). */
  children?: React.ReactNode;
}

/**
 * Kbd — keyboard shortcut or key hint display.
 *
 * @example
 * <Kbd>K</Kbd>
 * <Kbd>⌘ K</Kbd>
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, ...props }, ref) => (
    <KbdRoot
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-secondary)] [box-shadow:inset_0_-1px_0_var(--border)]",
        className
      )}
      {...props}
    >
      <KbdContent>{children}</KbdContent>
    </KbdRoot>
  )
);
Kbd.displayName = "Kbd";

