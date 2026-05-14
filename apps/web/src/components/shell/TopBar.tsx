"use client";

import { CaretRight, Command, Desktop, Moon, Plus, SidebarSimple, Sun } from "@phosphor-icons/react";
import { memo, useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useShellChrome } from "./shell-chrome-context";
import { Button, useAppTheme, type ThemeValue } from "@supernote/ui";
import { GitSyncIndicator } from "@/lib/git/GitSyncIndicator";

// ── Route label map for static segments ──────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  notes: "Notes",
  journal: "Journal",
  contacts: "Contacts",
  finance: "Finance",
  schemas: "Schémas",
  vues: "Vues",
  routines: "Routines",
  graph: "Graph",
  templates: "Templates",
  recherche: "Recherche",
  parametres: "Paramètres",
  comptes: "Comptes",
  transactions: "Transactions",
  budgets: "Budgets",
};

// ── Breadcrumb segment types ──────────────────────────────────────────────────

interface BreadcrumbSegment {
  label: string;
  href?: string;
}

// ── Entity name resolver (fetches when an ID segment is present) ──────────────

function useEntityName(id: string | null): string | null {
  const { data } = trpc.entities.get.useQuery(
    { id: id ?? "" },
    { enabled: id !== null, retry: false, staleTime: 300_000 },
  );
  if (!id || !data) return null;
  const title = data.fields["title"] ?? data.fields["name"] ?? data.fields["subject"];
  return typeof title === "string" && title.trim() ? title : data.typeName;
}

// ── Build breadcrumb segments from pathname ───────────────────────────────────

function usePathSegments(): BreadcrumbSegment[] {
  const pathname = usePathname();
  return useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return [{ label: "Accueil" }];

    const segments: BreadcrumbSegment[] = [];
    let accumulated = "";

    for (const part of parts) {
      accumulated += `/${part}`;
      const label = ROUTE_LABELS[part];
      segments.push({ label: label ?? part, href: accumulated });
    }

    return segments;
  }, [pathname]);
}

// ── Single segment — resolves entity name for ID-like labels ─────────────────

const BreadcrumbSegmentItem = memo(function BreadcrumbSegmentItem({
  segment,
  isLast,
}: {
  segment: BreadcrumbSegment;
  isLast: boolean;
}) {
  const isId = !(segment.label in ROUTE_LABELS) && segment.label.length > 8 && !/\s/.test(segment.label);
  const resolvedName = useEntityName(isId ? segment.label : null);
  const label = resolvedName ?? segment.label;

  return (
    <span
      className="max-w-[160px] truncate text-xs"
      style={{ color: isLast ? "var(--text-primary)" : "var(--text-muted)" }}
    >
      {label}
    </span>
  );
});

// ── Breadcrumb bar ────────────────────────────────────────────────────────────

const Breadcrumb = memo(function Breadcrumb() {
  const segments = usePathSegments();
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Fil d'Ariane" className="flex items-center gap-1">
      {segments.map((seg, i) => (
        <span key={seg.href ?? seg.label} className="flex items-center gap-1">
          {i > 0 && (
            <CaretRight size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          )}
          <BreadcrumbSegmentItem segment={seg} isLast={i === segments.length - 1} />
        </span>
      ))}
    </nav>
  );
});

// ── Theme cycle order ─────────────────────────────────────────────────────────

const THEME_CYCLE: ThemeValue[] = ["light", "dark", "system"];

function ThemeToggleButton() {
  const { theme, setTheme } = useAppTheme();

  const next = useCallback(() => {
    const current: ThemeValue = theme ?? "light";
    const idx = THEME_CYCLE.indexOf(current);
    const nextTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light";
    setTheme(nextTheme);
  }, [theme, setTheme]);

  const Icon = theme === "dark" ? Moon : theme === "system" ? Desktop : Sun;
  const label = theme === "dark" ? "Thème sombre" : theme === "system" ? "Thème système" : "Thème clair";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-full"
      style={{ color: "var(--text-muted)" }}
    >
      <Icon size={15} />
    </Button>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export const TopBar = memo(function TopBar() {
  const { toggleRightPanel, rightPanelVisible, requestNewNote } = useShellChrome();
  const router = useRouter();
  const pathname = usePathname();

  const handleNewNote = useCallback(() => {
    if (pathname === "/") {
      requestNewNote();
    } else {
      router.push("/?new=true");
    }
  }, [pathname, requestNewNote, router]);

  return (
    <header
      className="shell-chrome flex items-center gap-3 border-b px-4"
      style={{
        height: "var(--header-height)",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Search trigger */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("supernote:open-command-palette"));
        }}
        data-tour="command-palette-btn"
        className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Command size={11} />
        <span>Recherche rapide…</span>
        <kbd
          className="ml-2 rounded px-1.5 py-0.5 font-mono text-[10px]"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--text-muted)",
          }}
        >
          K
        </kbd>
      </Button>

      {/* Breadcrumb — fills remaining space */}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <Breadcrumb />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <GitSyncIndicator />
        <ThemeToggleButton />
        <Button
          variant="primary"
          size="sm"
          onClick={handleNewNote}
          data-tour="new-btn"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
        >
          <Plus size={13} />
          Nouveau
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRightPanel}
          aria-label={rightPanelVisible ? "Masquer le panneau" : "Afficher le panneau"}
          className="relative flex h-8 w-8 items-center justify-center rounded-md"
          style={{
            color: rightPanelVisible ? "var(--text-secondary)" : "var(--text-muted)",
          }}
        >
          <SidebarSimple size={15} />
        </Button>
      </div>
    </header>
  );
});
