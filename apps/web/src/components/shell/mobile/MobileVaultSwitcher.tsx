"use client";

import { CaretLeft } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { VaultSwitcherList } from "../VaultSwitcherList";

/**
 * Mobile vault switcher — an in-place sub-view of the "Plus" drawer, NOT a
 * nested modal.
 *
 * The first cut wrapped this in its own HeroUI `Drawer`, opened from inside the
 * MoreDrawer's `Drawer` body. That stacked two react-aria modal overlays at
 * once; on phones the second overlay's scroll-lock + focus-scope `contain`
 * fought the first and the whole "Plus" surface blanked out. The desktop
 * sidebar opens the same {@link VaultSwitcherList} in an anchored popover (a
 * separate, single overlay); here we push it as a sub-view the user backs out
 * of, so the MoreDrawer stays the one and only modal.
 */
export function MobileVaultSwitcher({
  onBack,
  onCloseDrawer,
}: {
  /** Return to the MoreDrawer menu (the "← Retour" affordance). */
  onBack: () => void;
  /** Dismiss the whole "Plus" drawer — used after a switch / open flow so the
   *  chosen vault (or the folder/git picker it spawns) isn't left obstructed. */
  onCloseDrawer: () => void;
}) {
  const vault = useVault();
  if (!vault) return null;

  return (
    <div className="flex flex-col gap-0.5 pb-[env(safe-area-inset-bottom,0px)]">
      <div className="mb-2 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Retour"
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            backgroundColor: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          <CaretLeft size={18} weight="bold" />
        </Button>
        <span
          className="text-lg font-semibold tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          Changer de coffre
        </span>
      </div>

      <VaultSwitcherList
        recents={vault.recentVaults}
        activeId={vault.activeVaultId}
        alwaysShowForget
        onSwitch={(id) => {
          onCloseDrawer();
          void vault.switchToVault(id);
        }}
        onForget={(id) => {
          void vault.forgetVault(id);
        }}
        onPickFolder={
          vault.isPwa
            ? () => {
                onCloseDrawer();
                void vault.pickFolder();
              }
            : undefined
        }
        onStartGit={
          vault.isPwa
            ? () => {
                onCloseDrawer();
                vault.startGitFlow();
              }
            : undefined
        }
        onStartCloud={
          vault.canCloud
            ? () => {
                onCloseDrawer();
                vault.startCloudFlow();
              }
            : undefined
        }
      />
    </div>
  );
}
