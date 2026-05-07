"use client";

import { Clock, GitBranch, Sparkle, X } from "@phosphor-icons/react";
import { memo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useShellChrome } from "./shell-chrome-context";

// ── Fixtures used when tRPC is unavailable (browser without IPC) ─────────────

interface FallbackItem {
  id: string;
  label: string;
  href: string;
  time: string;
}

const FALLBACK_ITEMS: FallbackItem[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `il y a ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `il y a ${diffDays} j`;
}

function entityLabel(entity: { typeName: string; fields: Record<string, unknown> }): string {
  const title = entity.fields["title"] ?? entity.fields["name"] ?? entity.fields["subject"];
  if (typeof title === "string" && title.trim()) return title;
  return entity.typeName;
}

function entityHref(entity: { id: string; typeName: string }): string {
  const type = entity.typeName.toLowerCase();
  if (type === "contact") return `/contacts/${entity.id}`;
  if (type === "note") return `/notes/${entity.id}`;
  return `/notes/${entity.id}`;
}

// ── Git status footer ─────────────────────────────────────────────────────────

function GitStatusFooter() {
  const { data, isError } = trpc.git.status.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const text =
    !data || isError
      ? "vault · aucun changement"
      : data.changes.length === 0
        ? `vault · aucun changement · ${data.branch}`
        : `${data.changes.length} fichier${data.changes.length > 1 ? "s" : ""} modifié${data.changes.length > 1 ? "s" : ""} · ${data.branch}`;

  return (
    <div className="flex items-center gap-1.5 px-1">
      <GitBranch size={11} className="text-[var(--text-muted)]" />
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {text}
      </span>
    </div>
  );
}

// ── Recent items list ─────────────────────────────────────────────────────────

function RecentList() {
  const router = useRouter();
  const { data, isError, isLoading } = trpc.entities.list.useQuery(
    { limit: 5, sortBy: "updatedAt", sortOrder: "desc" },
    { retry: false, staleTime: 120_000, gcTime: 10 * 60_000 },
  );

  if (isLoading) {
    return (
      <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Chargement…
      </p>
    );
  }

  if (isError || !data) {
    if (FALLBACK_ITEMS.length === 0) {
      return (
        <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Aucun fichier récent
        </p>
      );
    }
    return (
      <>
        {FALLBACK_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => router.push(item.href)}
            className="flex flex-col rounded-md px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
          >
            <span className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
              {item.label}
            </span>
            <span className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {item.time}
            </span>
          </button>
        ))}
      </>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Aucun fichier récent
      </p>
    );
  }

  return (
    <>
      {data.items.map((entity) => (
        <button
          key={entity.id}
          onClick={() => router.push(entityHref(entity))}
          className="flex flex-col rounded-md px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        >
          <span className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
            {entityLabel(entity)}
          </span>
          <span className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {relativeTime(entity.updatedAt)}
          </span>
        </button>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const RightPanel = memo(function RightPanel() {
  const { setRightPanelVisible } = useShellChrome();

  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        width: "var(--panel-width)",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-4"
        style={{ height: "var(--header-height)" }}
      >
        <span
          className="text-xs font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Contexte
        </span>
        <button
          onClick={() => setRightPanelVisible(false)}
          aria-label="Fermer le panneau"
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={13} />
        </button>
      </div>

      <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Recent */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5 px-1 pb-2">
          <Clock size={12} className="text-[var(--text-muted)]" />
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Récent
          </span>
        </div>
        <RecentList />
      </div>

      <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />

      {/* AI / Suggestions */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5 px-1 pb-2">
          <Sparkle size={12} className="text-[var(--accent)]" />
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Suggestions IA
          </span>
        </div>
        <p
          className="rounded-md px-3 py-2.5 text-xs leading-relaxed"
          style={{ color: "var(--text-muted)", backgroundColor: "var(--surface-2)" }}
        >
          Ouvre un fichier ou lance une recherche pour voir des suggestions
          contextuelles.
        </p>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Git status footer */}
      <div className="border-t p-3" style={{ borderColor: "var(--border-subtle)" }}>
        <GitStatusFooter />
      </div>
    </aside>
  );
});
