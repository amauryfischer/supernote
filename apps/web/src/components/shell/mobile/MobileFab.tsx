"use client";

import { Plus } from "@phosphor-icons/react";
import { memo } from "react";
import { useShellChrome } from "../shell-chrome-context";
import { Button } from "@supernote/ui";

/**
 * Floating action button — round 56 px button anchored to the central slot
 * of the bottom navigation. The top of the circle pokes out above the nav
 * (`-top-5`) so it visually "floats" like Material Design's docked FAB,
 * matching the pattern used elsewhere in our products (cf. `eu4` BottomBar).
 *
 * When no page-level FAB config is published, we still render an inert
 * placeholder so the central gap in the nav is filled — pressing it sends
 * the user to the home/create surface as a sensible fallback. Pages that
 * publish a config (`useMobileFab`) take over both the icon and the action.
 */
export const MobileFab = memo(function MobileFab() {
  const { mobileFab } = useShellChrome();

  // No config from the page → render a generic "+" button that at least
  // gives the user a way to start something (lands on the home writing
  // surface in fresh-note mode). Avoids leaving the nav with a hole.
  const Icon = mobileFab?.icon ?? Plus;
  const label = mobileFab?.label ?? "Nouveau";
  const onPress = mobileFab?.onPress ?? (() => {
    // Fallback: go home and request a fresh writing surface. Same effect as
    // the desktop topbar's "Nouveau" button when not on the home route.
    if (typeof window !== "undefined") {
      window.location.assign("/?new=true");
    }
  });

  return (
    <Button
      type="button"
      variant="primary"
      onClick={onPress}
      aria-label={label}
      className="absolute left-1/2 z-30 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full transition-transform active:scale-95"
      style={{
        // Anchor to the bottom of the shell (not the top): the nav occupies
        // the lowest 56 px (+ safe-area). We want the FAB top edge to sit
        // 20 px ABOVE the nav top, so the FAB bottom edge lands at
        // (20 + safe-area) px above the screen bottom.
        //   FAB_top_from_screen_bottom = 56 + safe + 20 = 76 + safe
        //   FAB_bottom_from_screen_bottom = 76 + safe − 56 = 20 + safe
        bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
        // Layered shadow that sells the "floating" effect: a soft, wide
        // ambient shadow far below + a tight contact shadow + a subtle
        // accent-colored glow that ties the FAB's lift to its hue without
        // looking neony. Tuned to read on both light and dark surfaces.
        boxShadow:
          "0 14px 28px -8px rgba(0,0,0,0.35), 0 6px 10px -4px rgba(0,0,0,0.18), 0 0 24px -6px var(--accent-subtle)",
      }}
    >
      <Icon size={24} weight="bold" />
    </Button>
  );
});
