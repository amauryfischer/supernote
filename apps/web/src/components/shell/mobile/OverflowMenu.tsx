"use client";

import { Button, Drawer } from "@supernote/ui";
import type { MobileHeaderAction } from "../shell-chrome-context";

/**
 * Action menu — bottom sheet that lists overflow header actions when more
 * than one is published by the page. Each row is 48 px tall for comfortable
 * tap targets.
 */
export function OverflowMenu({
  isOpen,
  onClose,
  actions,
}: {
  isOpen: boolean;
  onClose: () => void;
  actions: MobileHeaderAction[];
}) {
  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      placement="bottom"
      className="!h-auto !max-h-[70vh] !rounded-t-[var(--radius-xl)] !rounded-b-none"
    >
      <div className="flex flex-col">
        <div className="flex justify-center pt-2 pb-3">
          <div
            className="h-1 w-10 rounded-full"
            style={{ backgroundColor: "var(--border)" }}
          />
        </div>
        <div
          className="flex flex-col pb-[max(env(safe-area-inset-bottom,0px),12px)]"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <Button
                key={a.id}
                type="button"
                variant="ghost"
                onClick={() => {
                  a.onPress();
                  onClose();
                }}
                className="flex h-12 w-full items-center gap-3 px-4 text-[15px]"
                style={{ color: a.active ? "var(--accent)" : "var(--text-primary)" }}
              >
                <Icon size={20} />
                <span>{a.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}
