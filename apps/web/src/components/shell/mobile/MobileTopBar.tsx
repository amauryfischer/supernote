"use client";

import {
  ArrowLeft,
  DotsThreeVertical,
  MagnifyingGlass,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShellChrome, type MobileHeaderAction } from "../shell-chrome-context";
import { OverflowMenu } from "./OverflowMenu";
import { GitSyncIndicator } from "@/lib/git/GitSyncIndicator";
import { OnlineSyncIndicator } from "@/lib/online-sync/OnlineSyncIndicator";
import { recordVisit } from "@/lib/navigation/recents";
import { Button } from "@supernote/ui";

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
  "/habits": "Habitudes",
  "/journal": "Journal",
  "/contacts": "Contacts",
  "/finance": "Finance",
  "/finance/comptes": "Comptes",
  "/finance/actifs": "Actifs",
  "/finance/objectifs": "Objectifs",
  "/finance/prets": "Prêts",
  "/finance/snapshots": "Snapshots",
  "/schemas": "Schémas",
  "/routines": "Routines",
  "/variables": "Variables",
  "/tags": "Tags",
  "/templates": "Templates",
  "/recherche": "Recherche",
  "/parametres": "Paramètres",
};

/** Top-level routes (anything else gets a back button). */
const TOP_LEVEL = new Set([
  "/",
  "/notes",
  "/todos",
  "/habits",
  "/journal",
  "/recherche",
  "/contacts",
  "/finance",
  "/tags",
  "/variables",
  "/routines",
  "/templates",
  "/parametres",
  "/archive",
  "/schemas",
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onPress}
      aria-label={label}
      // ⚠️ `.sn-pressable` déclare `transition` en raccourci et écraserait
      // `.sn-motion-colors` (déclaré plus haut dans globals.css) : les deux
      // listes de tokens se posent donc ensemble en inline. Les deux dégradent
      // seules sous `prefers-reduced-motion`.
      className="sn-pressable relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)]"
      style={{
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "var(--sn-transition-colors), var(--sn-transition-transform)",
      }}
    >
      <Icon size={20} />
    </Button>
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

  // Record a frecency visit for the current page. The mobile header already
  // has a resolved title (page-published or route-derived), so this is free —
  // no extra network request. Entity id/type aren't available here, so mobile
  // recents are title-only (the palette preview column is hidden < sm anyway);
  // recordVisit preserves any entityId a desktop visit resolved for the href.
  useEffect(() => {
    if (!title || title === "Supernote") return;
    recordVisit({ href: pathname, title });
  }, [pathname, title]);

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
          backgroundColor: "var(--surface-chrome)",
        }}
      >
        {showBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Retour"
            className="sn-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
            style={{ color: "var(--text-primary)" }}
          >
            <ArrowLeft size={22} />
          </Button>
        ) : (
          // w-3 : sans bouton retour, 4+8+4 (px-1 + spacer + px-1) = 16px de
          // gouttière effective, le standard mobile — w-2 laissait 12px
          <div className="w-3" />
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
          {/* Sync status dots (git + online realtime). Each renders only
              when its config exists, so other vaults pay nothing here. */}
          <GitSyncIndicator />
          <OnlineSyncIndicator />
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
