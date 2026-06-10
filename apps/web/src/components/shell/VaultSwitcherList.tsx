"use client";

import { Check, CloudArrowUp, FolderOpen, GitBranch, Trash } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import type { RecentVault } from "@/lib/pwa/PwaVaultSetup";

export interface VaultSwitcherListProps {
  recents: ReadonlyArray<RecentVault>;
  activeId: string | null;
  onSwitch: (id: string) => void;
  onForget: (id: string) => void;
  /** FSA-only actions — omit on engines without the folder picker. */
  onPickFolder?: () => void;
  onStartGit?: () => void;
  /** Cloud action — omit on engines that can't host a cloud vault. */
  onStartCloud?: () => void;
  /**
   * Keep the per-row "forget" button visible at all times. Defaults to false
   * (reveal on hover) for the desktop popover; touch surfaces with no hover
   * must pass true or the button is unreachable.
   */
  alwaysShowForget?: boolean;
}

/** Strip the protocol so a server host reads compactly under the room name. */
function prettyServer(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * Presentational list of known vaults (folder + cloud) with switch / forget
 * rows and the "open another vault" actions. Shared by the desktop sidebar
 * popover and the mobile bottom-sheet so both surfaces switch identically —
 * the only difference is the chrome each wraps this in.
 */
export function VaultSwitcherList({
  recents,
  activeId,
  onSwitch,
  onForget,
  onPickFolder,
  onStartGit,
  onStartCloud,
  alwaysShowForget = false,
}: VaultSwitcherListProps) {
  return (
    <>
      {recents.length === 0 && (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Aucun coffre récent.
        </div>
      )}
      {recents.map((v) => {
        const isActive = v.id === activeId;
        const isCloud = v.kind === "cloud";
        // A folder vault that ALSO replicates through a server (dual mode):
        // local files + realtime sync. Surfaced like a cloud vault's sub-label.
        const syncedFolder = v.kind === "folder" && v.syncServer !== undefined;
        const Icon = isActive ? Check : isCloud ? CloudArrowUp : FolderOpen;
        return (
          <div
            key={v.id}
            className="group flex items-center gap-1 rounded-md hover:bg-[var(--surface-2)]"
          >
            <Button
              type="button"
              aria-checked={isActive}
              variant="ghost"
              onClick={() => onSwitch(v.id)}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-primary)",
                fontWeight: isActive ? 500 : 400,
              }}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center"
                style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }}
              >
                <Icon size={13} weight={isActive ? "bold" : "regular"} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{v.name}</span>
                {isCloud && v.serverUrl ? (
                  <span
                    className="truncate text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {prettyServer(v.serverUrl)}
                  </span>
                ) : syncedFolder ? (
                  <span
                    className="flex items-center gap-1 truncate text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <CloudArrowUp size={10} weight="fill" />
                    {v.syncServer ? prettyServer(v.syncServer) : "synchronisé"}
                  </span>
                ) : null}
              </span>
              {(isCloud || syncedFolder) && isActive ? (
                <CloudArrowUp
                  size={12}
                  weight="fill"
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                />
              ) : null}
            </Button>
            {!isActive && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onForget(v.id);
                }}
                aria-label={`Retirer ${v.name} de l'historique`}
                className={
                  alwaysShowForget
                    ? "mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded"
                    : "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                }
                style={{ color: "var(--text-muted)" }}
              >
                <Trash size={12} />
              </Button>
            )}
          </div>
        );
      })}

      {(onStartCloud || onPickFolder || onStartGit) && (
        <div className="my-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
      )}

      {onStartCloud && (
        <Button
          type="button"
          variant="ghost"
          onClick={onStartCloud}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
          style={{ color: "var(--text-primary)" }}
        >
          <CloudArrowUp size={13} style={{ color: "var(--text-muted)" }} />
          <span>Connecter un coffre cloud…</span>
        </Button>
      )}
      {onPickFolder && (
        <Button
          type="button"
          variant="ghost"
          onClick={onPickFolder}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
          style={{ color: "var(--text-primary)" }}
        >
          <FolderOpen size={13} style={{ color: "var(--text-muted)" }} />
          <span>Choisir un autre dossier…</span>
        </Button>
      )}
      {onStartGit && (
        <Button
          type="button"
          variant="ghost"
          onClick={onStartGit}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
          style={{ color: "var(--text-primary)" }}
        >
          <GitBranch size={13} style={{ color: "var(--text-muted)" }} />
          <span>Connecter un dépôt Git…</span>
        </Button>
      )}
    </>
  );
}
