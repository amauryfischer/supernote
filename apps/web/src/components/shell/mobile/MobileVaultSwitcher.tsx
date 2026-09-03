"use client";

import { CaretLeft, Vault } from "@phosphor-icons/react";
import { Button, EmptyState } from "@supernote/ui";
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

  const header = (
    <div className="mb-2 flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Retour"
        className="sn-pressable flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)]"
        style={{
          backgroundColor: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        <CaretLeft size={18} weight="bold" />
      </Button>
      <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
        Changer de coffre
      </h2>
    </div>
  );

  // Le contexte coffre peut disparaître pendant que la sous-vue est ouverte :
  // sans ce garde-fou le panneau se vidait, bouton « Retour » compris, et le
  // tiroir devenait un cul-de-sac.
  if (!vault) {
    return (
      <div className="flex flex-col pb-[env(safe-area-inset-bottom,0px)]">
        {header}
        <EmptyState
          icon={<Vault size={24} />}
          title="Coffre indisponible"
          description="Aucun coffre n'est accessible sur cet appareil pour le moment."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 pb-[env(safe-area-inset-bottom,0px)]">
      {header}

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
