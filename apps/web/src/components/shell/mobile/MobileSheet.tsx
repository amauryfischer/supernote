"use client";

import { Button, Drawer } from "@supernote/ui";
import type { ReactNode } from "react";

/**
 * Bottom sheet — slides in from the bottom, takes ~60% of the viewport,
 * scrolls internally. Used as the mobile equivalent of the desktop right
 * panel (note metadata, contact details, etc.).
 *
 * Built on top of HeroUI's Drawer with `placement="bottom"`. The handle and
 * rounded top corners are added via classNames so the drag affordance is
 * visible on iOS.
 */
export function MobileSheet({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** sm = 40vh, md = 65vh, lg = 90vh */
  size?: "sm" | "md" | "lg";
}) {
  const heightClass =
    size === "sm" ? "!h-[40vh]" : size === "lg" ? "!h-[90vh]" : "!h-[65vh]";

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      placement="bottom"
      size="full"
      className={`${heightClass} !rounded-t-[var(--radius-xl)] !rounded-b-none`}
    >
      <div className="flex h-full flex-col">
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: "var(--border)" }}
          />
        </div>
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ color: "var(--text-muted)" }}
            aria-label="Fermer"
          >
            ✕
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </Drawer>
  );
}
