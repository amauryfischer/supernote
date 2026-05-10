"use client";

import { memo, useState } from "react";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileFab } from "./MobileFab";
import { MobileTopBar } from "./MobileTopBar";
import { MoreDrawer } from "./MoreDrawer";
import dynamic from "next/dynamic";

// Lazy-load the notification center so it's not in the critical mobile bundle.
const NotificationCenter = dynamic(
  () =>
    import("@supernote/notifications/renderer").then((m) => ({
      default: m.NotificationCenter,
    })),
  { ssr: false },
);

/**
 * Mobile shell — phone-sized chrome (≤ 767 px viewport).
 *
 * Layout:
 *   ┌──────────────────────┐  ← MobileTopBar (48 px + safe-area-top)
 *   ├──────────────────────┤
 *   │                      │
 *   │   {children}         │  ← scrollable main, padded for FAB + bottom nav
 *   │                      │
 *   │              [FAB]   │  ← floating, contextual
 *   ├──────────────────────┤
 *   │ 🏠 📝 ✓ 📅 ⋯       │  ← MobileBottomNav (56 px + safe-area-bottom)
 *   └──────────────────────┘
 *
 * The shell does NOT touch page content. Pages publish their title / FAB /
 * actions through the `useMobileTitle`, `useMobileFab`, `useMobileHeaderActions`
 * hooks (defined in `shell-chrome-context.tsx`).
 */
export const MobileShell = memo(function MobileShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      <MobileTopBar />

      <main
        className="relative flex-1 overflow-y-auto"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        {children}
      </main>

      <MobileFab />

      <MobileBottomNav onOpenMore={() => setMoreOpen(true)} />

      <MoreDrawer
        isOpen={moreOpen}
        onClose={() => setMoreOpen(false)}
        onOpenNotifications={() => setNotifOpen(true)}
      />

      {notifOpen && (
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
    </div>
  );
});
