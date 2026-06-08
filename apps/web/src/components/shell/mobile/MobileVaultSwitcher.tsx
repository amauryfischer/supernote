"use client";

import { Drawer } from "@supernote/ui";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { VaultSwitcherList } from "../VaultSwitcherList";

/**
 * Mobile bottom-sheet vault switcher. The desktop sidebar opens the same list
 * in an anchored popover; on a phone — the primary cloud surface, since cloud
 * vaults need no folder picker — we surface it as a sheet from the "Plus"
 * drawer's vault card so cloud rooms can be switched without a desktop.
 */
export function MobileVaultSwitcher({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const vault = useVault();
  if (!vault) return null;

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      placement="bottom"
      title="Changer de coffre"
      className="!h-auto !max-h-[80dvh] !rounded-t-2xl"
    >
      <div className="flex flex-col gap-0.5 pb-[env(safe-area-inset-bottom,0px)]">
        <VaultSwitcherList
          recents={vault.recentVaults}
          activeId={vault.activeVaultId}
          alwaysShowForget
          onSwitch={(id) => {
            onClose();
            void vault.switchToVault(id);
          }}
          onForget={(id) => {
            void vault.forgetVault(id);
          }}
          onPickFolder={
            vault.isPwa
              ? () => {
                  onClose();
                  void vault.pickFolder();
                }
              : undefined
          }
          onStartGit={
            vault.isPwa
              ? () => {
                  onClose();
                  vault.startGitFlow();
                }
              : undefined
          }
          onStartCloud={
            vault.canCloud
              ? () => {
                  onClose();
                  vault.startCloudFlow();
                }
              : undefined
          }
        />
      </div>
    </Drawer>
  );
}
