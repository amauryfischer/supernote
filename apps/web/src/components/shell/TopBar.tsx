"use client";

import { CaretRight, Command, Plus, SidebarSimple } from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useShellChrome } from "./shell-chrome-context";

// ── Route label map for static segments ──────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  notes: "Notes",
  journal: "Journal",
  contacts: "Contacts",
  projets: "Projets",
  finance: "Finance",
  schemas: "Schémas",
  vues: "Vues",
  routines: "Routines",
  canvas: "Canvas",
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
}

// ── Single segment — resolves entity name for ID-like labels ─────────────────

function BreadcrumbSegmentItem({ segment, isLast }: { segment: BreadcrumbSegment; isLast: boolean }) {
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
}

// ── Breadcrumb bar ────────────────────────────────────────────────────────────

function Breadcrumb() {
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
}

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const { toggleRightPanel, rightPanelVisible, requestNewNote } = useShellChrome();
  const router = useRouter();
  const pathname = usePathname();

  const handleNewNote = () => {
    if (pathname === "/") {
      requestNewNote();
    } else {
      router.push("/?new=true");
    }
  };

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
      <button
        onClick={() => {
          window.dispatchEvent(new CustomEvent("supernote:open-command-palette"));
        }}
        data-tour="command-palette-btn"
        className="flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
        style={{
          color: "var(--text-muted)",
          border: "1px solid var(--border-subtle)",
        }}
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
      </button>

      {/* Breadcrumb — fills remaining space */}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <Breadcrumb />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={handleNewNote}
          data-tour="new-btn"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          <Plus size={13} />
          Nouveau
        </button>
        <button
          onClick={toggleRightPanel}
          aria-label={rightPanelVisible ? "Masquer le panneau" : "Afficher le panneau"}
          className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
          style={{
            color: rightPanelVisible ? "var(--text-secondary)" : "var(--text-muted)",
          }}
        >
          <SidebarSimple size={15} />
        </button>
      </div>
    </header>
  );
}
