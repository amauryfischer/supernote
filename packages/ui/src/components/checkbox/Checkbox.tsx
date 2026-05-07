import * as React from "react";
import {
  CheckboxRoot,
  CheckboxControl,
  CheckboxIndicator,
  CheckboxContent,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface CheckboxProps
  extends React.ComponentPropsWithRef<typeof CheckboxRoot> {
  /** Label shown beside the checkbox. */
  children?: React.ReactNode;
  /** Additional class. */
  className?: string;
}

/**
 * Checkbox — boolean selection control.
 * Uses HeroUI v3 compound component.
 */
export function Checkbox({ className, children, ...props }: CheckboxProps) {
  return (
    <CheckboxRoot
      className={cn("flex cursor-pointer items-center gap-2", className)}
      {...props}
    >
      <CheckboxControl className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-1)] transition-colors data-[selected]:border-[var(--color-primary)] data-[selected]:bg-[var(--color-primary)]">
        <CheckboxIndicator className="text-white">
          <svg
            width="10"
            height="8"
            viewBox="0 0 10 8"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 4l2.5 2.5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </CheckboxIndicator>
      </CheckboxControl>
      {children && (
        <CheckboxContent className="text-sm text-[var(--text-primary)]">
          {children}
        </CheckboxContent>
      )}
    </CheckboxRoot>
  );
}

Checkbox.displayName = "Checkbox";

