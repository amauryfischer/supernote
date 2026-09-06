"use client";

/**
 * Carte « État » du drawer mobile : les trois pastilles de la barre du haut
 * desktop (git, coffre en ligne, IA locale) rendues en lignes pleine largeur,
 * la barre de 56 px n'ayant pas la place de les porter au doigt.
 *
 * Les libellés viennent des mêmes fonctions que les indicateurs desktop
 * (`gitSyncLabel`, `onlineSyncLabel`, `aiStatusLabel`) : le mobile ne doit
 * jamais dire autre chose que le desktop sur le même état.
 */

import Link from "next/link";
import { CloudArrowUp, GitBranch, Sparkle } from "@phosphor-icons/react";
import { useGitSync } from "@/lib/git/GitSyncProvider";
import { gitSyncLabel } from "@/lib/git/GitSyncIndicator";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { onlineSyncLabel } from "@/lib/online-sync/OnlineSyncIndicator";
import {
  AI_STATUS_COLOR,
  aiStatusHint,
  aiStatusLabel,
  useAiStatus,
} from "@/components/shell/AiStatusIndicator";

const OK_GREEN = "oklch(0.65 0.16 150)";

function statusColor(status: string): string {
  switch (status) {
    case "ok":
    case "idle":
    case "connected":
      return OK_GREEN;
    case "syncing":
    case "connecting":
      return "var(--accent)";
    case "error":
      return "var(--danger)";
    default:
      return "var(--text-muted)";
  }
}

function StatusRow({
  icon: Icon,
  label,
  detail,
  color,
  hollow,
  onPress,
  href,
}: {
  icon: typeof GitBranch;
  label: string;
  detail?: string | null;
  color: string;
  hollow: boolean;
  onPress?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--surface-2)" }}
      >
        <Icon size={15} style={{ color: "var(--text-secondary)" }} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[15px] font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {label}
        </span>
        {detail && (
          <span
            className="block truncate font-mono text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            {detail}
          </span>
        )}
      </span>
      <span
        className="shrink-0"
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: hollow ? "transparent" : color,
          border: hollow ? "1px solid var(--text-muted)" : undefined,
        }}
      />
    </>
  );

  const className =
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[var(--surface-2)]";

  if (href) {
    return (
      <Link href={href} onClick={onPress} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onPress} className={className}>
      {body}
    </button>
  );
}

export function MobileStatusCard({ onClose }: { onClose: () => void }) {
  const git = useGitSync();
  const online = useOnlineSync();
  const { snapshot, recheck } = useAiStatus();

  return (
    <div className="mb-6">
      <p className="sn-eyebrow sn-eyebrow--compact mb-1.5 px-3">État</p>
      <div
        className="divide-y overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: "var(--surface-content)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {git && (
          <StatusRow
            icon={GitBranch}
            label={gitSyncLabel(git)}
            color={statusColor(git.status)}
            hollow={git.status === "disabled"}
            href="/parametres"
            onPress={onClose}
          />
        )}
        {online && (
          <StatusRow
            icon={CloudArrowUp}
            label={onlineSyncLabel(online)}
            color={statusColor(online.status)}
            hollow={online.status === "disabled"}
            href="/parametres"
            onPress={onClose}
          />
        )}
        <StatusRow
          icon={Sparkle}
          label={aiStatusLabel(snapshot)}
          detail={aiStatusHint(snapshot)}
          color={AI_STATUS_COLOR[snapshot.status]}
          hollow={false}
          onPress={recheck}
        />
      </div>
    </div>
  );
}
