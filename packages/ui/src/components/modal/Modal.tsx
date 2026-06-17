import * as React from "react";
import {
  Modal as HeroModal,
  ModalRoot,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
  ModalCloseTrigger,
  ModalTrigger,
} from "@heroui/react";
import { cn } from "../../cn.js";

export interface ModalProps {
  /** Controls open state externally. */
  isOpen?: boolean;
  /** Called when the modal requests close. */
  onOpenChange?: (open: boolean) => void;
  /** Modal title rendered in the header. */
  title?: React.ReactNode;
  /** Footer content (typically action buttons). */
  footer?: React.ReactNode;
  /** Modal body. */
  children?: React.ReactNode;
  /** Width preset. */
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Additional class for the dialog wrapper. */
  className?: string;
  /** Prevent closing when clicking the backdrop. */
  isDismissable?: boolean;
}

const sizeClass: Record<NonNullable<ModalProps["size"]>, string> = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-2xl",
  xl:   "max-w-4xl",
  full: "max-w-full m-4",
};

/**
 * Modal — dialog overlay with header / body / footer slots.
 * Uses HeroUI v3 compound component pattern.
 */
export function Modal({
  isOpen = false,
  onOpenChange,
  title,
  footer,
  children,
  size = "md",
  className,
  isDismissable = true,
}: ModalProps) {
  return (
    <ModalRoot isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalBackdrop
        isDismissable={isDismissable}
        className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--surface-0)]/60 backdrop-blur-sm"
      />
      {/* `h-full w-full` is load-bearing: HeroUI's `.modal__container` slot ships
          `width: fit-content`, which over-constrains `inset-0` (left:0 + right:0 +
          explicit width → right is ignored), collapsing the centering layer to the
          dialog's width pinned top-left. Forcing full size restores a viewport-sized
          flex box so `items-center justify-center` actually centers on screen. */}
      <ModalContainer className="fixed inset-0 z-[var(--z-modal)] flex h-full w-full items-center justify-center p-4">
        <ModalDialog
          className={cn(
            "w-full rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] [box-shadow:var(--shadow-xl)]",
            sizeClass[size],
            className
          )}
        >
          {title && (
            <ModalHeader className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
              <ModalHeading className="text-base font-semibold text-[var(--text-primary)]">
                {title}
              </ModalHeading>
              <ModalCloseTrigger className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" />
            </ModalHeader>
          )}
          <ModalBody className="px-6 py-4 text-[var(--text-primary)]">
            {children}
          </ModalBody>
          {footer && (
            <ModalFooter className="border-t border-[var(--border-subtle)] px-6 py-4">
              {footer}
            </ModalFooter>
          )}
        </ModalDialog>
      </ModalContainer>
    </ModalRoot>
  );
}

/** Re-export primitives for advanced composition. */
export {
  ModalRoot,
  ModalTrigger,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
  ModalCloseTrigger,
};

