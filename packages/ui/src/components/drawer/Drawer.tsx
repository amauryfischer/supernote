import * as React from "react";
import {
  DrawerRoot,
  DrawerBackdrop,
  DrawerContent,
  DrawerDialog,
  DrawerHeader,
  DrawerHeading,
  DrawerBody,
  DrawerFooter,
  DrawerCloseTrigger,
  DrawerTrigger,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface DrawerProps {
  /** Controls open state. */
  isOpen?: boolean;
  /** Called when the drawer open state changes. */
  onOpenChange?: (open: boolean) => void;
  /** Side from which the drawer slides in. */
  placement?: "left" | "right" | "top" | "bottom";
  /** Panel title. */
  title?: React.ReactNode;
  /** Footer content. */
  footer?: React.ReactNode;
  /** Panel body. */
  children?: React.ReactNode;
  /** Width for left/right drawers. */
  size?: "sm" | "md" | "lg" | "full";
  /** Additional class for the dialog wrapper. */
  className?: string;
  /** Prevent closing when clicking the backdrop. */
  isDismissable?: boolean;
}

const sizeMap: Record<
  NonNullable<DrawerProps["size"]>,
  "sm" | "md" | "lg" | "full"
> = {
  sm:   "sm",
  md:   "md",
  lg:   "lg",
  full: "full",
};

/**
 * Drawer — slide-in panel anchored to a viewport edge.
 * Uses HeroUI v3 compound component pattern.
 */
export function Drawer({
  isOpen = false,
  onOpenChange,
  placement = "right",
  title,
  footer,
  children,
  size = "md",
  className,
  isDismissable = true,
}: DrawerProps) {
  return (
    <DrawerRoot isOpen={isOpen} onOpenChange={onOpenChange}>
      <DrawerBackdrop
        isDismissable={isDismissable}
        className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--surface-0)]/60 backdrop-blur-sm"
      />
      <DrawerContent
        placement={placement}
        className={cn(
          "fixed z-[var(--z-modal)] border-[var(--border-subtle)] bg-[var(--surface-1)] [box-shadow:var(--shadow-2xl)]",
          className
        )}
      >
        <DrawerDialog>
          {title && (
            <DrawerHeader className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
              <DrawerHeading className="text-base font-semibold text-[var(--text-primary)]">
                {title}
              </DrawerHeading>
              <DrawerCloseTrigger className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
            </DrawerHeader>
          )}
          <DrawerBody className="px-6 py-4 text-[var(--text-primary)]">
            {children}
          </DrawerBody>
          {footer && (
            <DrawerFooter className="border-t border-[var(--border-subtle)] px-6 py-4">
              {footer}
            </DrawerFooter>
          )}
        </DrawerDialog>
      </DrawerContent>
    </DrawerRoot>
  );
}

/** Re-export primitives for advanced composition. */
export {
  DrawerRoot,
  DrawerTrigger,
  DrawerBackdrop,
  DrawerContent,
  DrawerDialog,
  DrawerHeader,
  DrawerHeading,
  DrawerBody,
  DrawerFooter,
  DrawerCloseTrigger,
};

