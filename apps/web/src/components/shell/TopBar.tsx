"use client";

import { CaretRight, Desktop, Moon, Plus, SidebarSimple, Sun } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { recordVisit } from "@/lib/navigation/recents";
import { useUiMode } from "@/hooks/useUiMode";
import { SearchTrigger } from "./SearchTrigger";
import { useShellChrome } from "./shell-chrome-context";
import {
  Button,
  useAppTheme,
  setThemeWithTransition,
  originFromElement,
  type ThemeValue,
} from "@supernote/ui";
import { GitSyncIndicator } from "@/lib/git/GitSyncIndicator";
import { OnlineSyncIndicator } from "@/lib/online-sync/OnlineSyncIndicator";
import { AiStatusIndicator } from "./AiStatusIndicator";
import { InboxSortJournalButton } from "@/lib/ai/InboxSortJournalEntry";

// ── Route label map for static segments ──────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  notes: "Notes",
  mail: "Mail",
  archive: "Archive",
  todos: "Todos",
  habits: "Habitudes",
  tags: "Tags",
  ai: "Assistant IA",
  pomodoro: "Pomodoro",
  journal: "Journal",
  contacts: "Contacts",
  finance: "Finance",
  schemas: "Schémas",
  vues: "Vues",
  routines: "Routines",
  variables: "Variables",
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

interface EntityInfo {
  name: string;
  typeId: string;
}

function useEntityInfo(id: string | null): EntityInfo | null {
  const { data } = trpc.entities.get.useQuery(
    { id: id ?? "" },
    { enabled: id !== null, retry: false, staleTime: 300_000 },
  );
  if (!id || !data) return null;
  const title = data.fields["title"] ?? data.fields["name"] ?? data.fields["subject"];
  const name = typeof title === "string" && title.trim() ? title : data.typeName;
  return { name, typeId: data.typeId };
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
  const info = useEntityInfo(isId ? segment.label : null);
  const resolvedName = info?.name ?? null;
  const label = resolvedName ?? segment.label;
  const typeId = info?.typeId ?? null;

  // Record a frecency visit for the *current* page (the last segment) once its
  // title is stable. For an ID segment we wait until the name resolves so we
  // never store a raw ULID; static segments record immediately. Reads only the
  // already-fetched breadcrumb data — no extra network request. Deps are all
  // primitives so a query refetch (which returns a fresh `info` object) doesn't
  // re-fire the visit.
  useEffect(() => {
    if (!isLast) return;
    if (isId && !resolvedName) return;
    recordVisit({
      href: segment.href ?? "/",
      title: label,
      ...(isId ? { entityId: segment.label, typeId: typeId ?? undefined } : {}),
    });
  }, [isLast, isId, resolvedName, typeId, label, segment.href, segment.label]);

  return (
    <span
      className="max-w-[200px] truncate text-[13px]"
      style={{
        color: isLast ? "var(--text-primary)" : "var(--text-muted)",
        fontWeight: isLast ? 600 : 400,
        letterSpacing: isLast ? "var(--tracking-title)" : undefined,
      }}
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
            <CaretRight size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
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

  const next = useCallback(
    // HeroUI passe un MouseEvent<FocusableElement> (react-aria), pas
    // <HTMLElement> — on élargit à Element (suffisant pour originFromElement).
    (e?: ReactMouseEvent<Element>) => {
      const current: ThemeValue = theme ?? "light";
      const idx = THEME_CYCLE.indexOf(current);
      const nextTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light";
      // Révélation circulaire depuis le centre du bouton (View Transitions API).
      // Sans event exploitable → cross-fade natif ; sans support / en
      // reduced-motion → bascule directe (géré par le helper).
      const origin = e?.currentTarget ? originFromElement(e.currentTarget) : undefined;
      setThemeWithTransition(setTheme, nextTheme, origin);
    },
    [theme, setTheme],
  );

  const Icon = theme === "dark" ? Moon : theme === "system" ? Desktop : Sun;
  const label = theme === "dark" ? "Thème sombre" : theme === "system" ? "Thème système" : "Thème clair";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={label}
      className="sn-pressable sn-motion-colors flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)]"
      style={{ color: "var(--text-muted)" }}
    >
      {/* key on theme remounts the icon each cycle → fresh sn-pop-in (rises &
          settles via spring), signalling the real theme change. */}
      <span key={theme ?? "light"} className="sn-pop-in flex items-center justify-center">
        <Icon size={15} />
      </span>
    </Button>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export const TopBar = memo(function TopBar() {
  const { toggleRightPanel, rightPanelVisible, requestNewNote } = useShellChrome();
  const router = useRouter();
  const pathname = usePathname();
  const isNext = useUiMode().mode === "next";

  const handleNewNote = useCallback(() => {
    if (pathname === "/") {
      requestNewNote();
    } else {
      router.push("/?new=true");
    }
  }, [pathname, requestNewNote, router]);

  return (
    <header
      className={`shell-chrome border-b px-3 ${
        isNext
          ? "grid grid-cols-[1fr_auto_1fr] items-center gap-3"
          : "flex items-center gap-2"
      }`}
      style={{
        height: "var(--header-height)",
        borderColor: "var(--border-subtle)",
        // Registre next : la topbar appartient à la feuille de contenu (même
        // surface, un seul filet en bas). Héritage : surface de chrome.
        backgroundColor: isNext ? "var(--surface-content)" : "var(--surface-1)",
      }}
    >
      {!isNext && <SearchTrigger className="w-56 shrink-0 lg:w-64" />}

      <div className={`flex min-w-0 items-center justify-start overflow-hidden ${isNext ? "" : "flex-1"}`}>
        <Breadcrumb />
      </div>

      {/* Registre next : la palette ⌘K en barre centrée, seule affordance de
          recherche du shell (le rail n'a pas de champ). */}
      {isNext && <SearchTrigger className="w-[min(380px,34vw)]" />}

      <div className="flex shrink-0 items-center justify-end gap-1">
        <GitSyncIndicator />
        <OnlineSyncIndicator />
        <AiStatusIndicator />
        <InboxSortJournalButton />
        <ThemeToggleButton />
        <Button
          variant="primary"
          size="sm"
          onClick={handleNewNote}
          data-tour="new-btn"
          className="sn-btn-primary sn-pressable flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium"
        >
          <Plus size={13} />
          Nouveau
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleRightPanel}
          aria-label={rightPanelVisible ? "Masquer le panneau" : "Afficher le panneau"}
          className="sn-pressable sn-motion-colors relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]"
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
