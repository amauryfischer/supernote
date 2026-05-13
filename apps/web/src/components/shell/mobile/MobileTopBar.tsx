"use client";

import {
  ArrowLeft,
  DotsThreeVertical,
  MagnifyingGlass,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { memo, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShellChrome, type MobileHeaderAction } from "../shell-chrome-context";
import { OverflowMenu } from "./OverflowMenu";
import { GitSyncIndicator } from "@/lib/git/GitSyncIndicator";

/**
 * Mobile top bar — 48 px header containing (in order):
 *   - back button when we're below the top-level route
 *   - vault brand / title block
 *   - search shortcut
 *   - up to 2 contextual action icons + overflow menu (3-dots)
 *
 * Title comes from the page (via `useMobileTitle`) when published, otherwise
 * falls back to a route-derived label. Same trick for the contextual actions.
 */

const ROUTE_LABELS: Record<string, string> = {
  "/": "Accueil",
  "/notes": "Notes",
  "/archive": "Archive",
  "/todos": "Todos",
  "/journal": "Journal",
  "/contacts": "Contacts",
  "/finance": "Finance",
  "/finance/comptes": "Comptes",
  "/finance/actifs": "Actifs",
  "/finance/objectifs": "Objectifs",
  "/finance/prets": "Prêts",
  "/finance/snapshots": "Snapshots",
  "/schemas": "Schémas",
  "/vues": "Vues",
  "/routines": "Routines",
  "/canvas": "Canvas",
  "/graph": "Graph",
  "/tags": "Tags",
  "/templates": "Templates",
  "/recherche": "Recherche",
  "/parametres": "Paramètres",
  "/capture": "Capture",
};

/** Top-level routes (anything else gets a back button). */
const TOP_LEVEL = new Set([
  "/",
  "/notes",
  "/todos",
  "/journal",
  "/recherche",
  "/contacts",
  "/finance",
  "/tags",
  "/vues",
  "/canvas",
  "/graph",
  "/routines",
  "/templates",
  "/parametres",
  "/archive",
  "/schemas",
  "/capture",
]);

function deriveTitle(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  // Try parent prefix for /:id routes.
  const parent = pathname.replace(/\/[^/]+$/, "");
  if (parent && ROUTE_LABELS[parent]) return ROUTE_LABELS[parent];
  return "Supernote";
}

interface IconButtonProps {
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
}

const IconButton = memo(function IconButton({
  icon: Icon,
  label,
  onPress,
  active,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors active:bg-[var(--surface-2)]"
      style={{ color: active ? "var(--accent)" : "var(--text-secondary)" }}
    >
      <Icon size={20} />
    </button>
  );
});

export const MobileTopBar = memo(function MobileTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    mobileTitle,
    mobileSubtitle,
    mobileHeaderActions,
  } = useShellChrome();
  const [overflowOpen, setOverflowOpen] = useState(false);

  const showBack = !TOP_LEVEL.has(pathname);
  const title = mobileTitle ?? deriveTitle(pathname);

  const onBack = useCallback(() => {
    // Prefer router back when we have history to pop, else fall back to the
    // parent route. `window.history.length` is unreliable but it's the best
    // signal available cross-browser.
    if (window.history.length > 1) {
      router.back();
    } else {
      const parent = pathname.replace(/\/[^/]+$/, "") || "/";
      router.push(parent);
    }
  }, [pathname, router]);

  const onOpenSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("supernote:open-command-palette"));
  }, []);

  // Split actions: first one stays inline, the rest go into an overflow
  // menu (kebab). Keeps the top bar from overflowing on a 360 px viewport.
  const { inlineActions, overflowActions } = useMemo(() => {
    const inline: MobileHeaderAction[] = [];
    const overflow: MobileHeaderAction[] = [];
    for (const a of mobileHeaderActions) {
      if (inline.length < 1) inline.push(a);
      else overflow.push(a);
    }
    return { inlineActions: inline, overflowActions: overflow };
  }, [mobileHeaderActions]);

  return (
    <>
      <header
        className="flex shrink-0 items-center gap-1 border-b px-1"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          height: "calc(48px + env(safe-area-inset-top, 0px))",
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:bg-[var(--surface-2)]"
            style={{ color: "var(--text-primary)" }}
          >
            <ArrowLeft size={22} />
          </button>
        ) : (
          <div className="w-2" />
        )}

        <div className="flex min-w-0 flex-1 flex-col justify-center px-1">
          <div
            className="truncate text-[15px] font-semibold leading-tight"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </div>
          {mobileSubtitle && (
            <div
              className="truncate text-[11px] leading-tight"
              style={{ color: "var(--text-muted)" }}
            >
              {mobileSubtitle}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          {/* Git sync status dot. Renders only when a git config exists,
              so non-git vaults pay nothing here. */}
          <GitSyncIndicator />
          {!showBack && (
            <IconButton
              icon={MagnifyingGlass}
              label="Recherche"
              onPress={onOpenSearch}
            />
          )}
          {inlineActions.map((a) => (
            <IconButton
              key={a.id}
              icon={a.icon}
              label={a.label}
              onPress={a.onPress}
              active={a.active}
            />
          ))}
          {overflowActions.length > 0 && (
            <IconButton
              icon={DotsThreeVertical}
              label="Plus d'actions"
              onPress={() => setOverflowOpen(true)}
              active={overflowOpen}
            />
          )}
        </div>
      </header>

      {overflowActions.length > 0 && (
        <OverflowMenu
          isOpen={overflowOpen}
          onClose={() => setOverflowOpen(false)}
          actions={overflowActions}
        />
      )}
    </>
  );
});
