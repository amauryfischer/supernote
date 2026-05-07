import * as React from "react";
import {
  SwitchRoot,
  SwitchControl,
  SwitchThumb,
  SwitchContent,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface SwitchProps
  extends React.ComponentPropsWithRef<typeof SwitchRoot> {
  /** Label shown beside the switch. */
  children?: React.ReactNode;
  /** Additional class. */
  className?: string;
}

/**
 * Switch — boolean toggle control.
 * Uses HeroUI v3 compound component.
 */
export function Switch({ className, children, ...props }: SwitchProps) {
  return (
    <SwitchRoot
      className={cn("flex cursor-pointer items-center gap-2", className)}
      {...props}
    >
      <SwitchControl className="inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-[var(--surface-3)] transition-colors data-[selected]:bg-[var(--color-primary)]">
        <SwitchThumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform data-[selected]:translate-x-4" />
      </SwitchControl>
      {children && (
        <SwitchContent className="text-sm text-[var(--text-primary)]">
          {children}
        </SwitchContent>
      )}
    </SwitchRoot>
  );
}

Switch.displayName = "Switch";

