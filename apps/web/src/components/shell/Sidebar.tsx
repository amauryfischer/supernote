"use client";

import { Bell, CaretDown, Cloud } from "@phosphor-icons/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useTranslations } from "next-intl";
import { useVault, type RecentVault } from "@/lib/pwa/PwaVaultSetup";
import { VaultSwitcherList } from "./VaultSwitcherList";
import { usePluginEnabled } from "@/hooks/usePluginEnabled";
import { Button } from "@supernote/ui";
import { useUiMode } from "@/hooks/useUiMode";
import { SidebarRail, type RailGroup } from "./SidebarRail";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { useInboxUnreadCount } from "@/hooks/useInboxUnreadCount";
import {
  NAV_GROUP_ORDER,
  NAV_GROUP_LABEL_KEY,
  NAV_HEADERLESS_GROUPS,
  NAV_SETTINGS,
  navItemsInGroup,
  type NavItem,
  type NavGate,
} from "@/lib/navigation/catalog";

// NotificationCenter is heavy and only mounts when the panel is open. Loading
// it lazily keeps the initial sidebar bundle small (Turbopack can tree-shake
// the chunk out of the critical path entirely).
const NotificationCenter = dynamic(
  () =>
    import("@supernote/notifications/renderer").then((m) => ({
      default: m.NotificationCenter,
    })),
  { ssr: false },
);

const NavLink = memo(function NavLink({
  item,
  active,
  label,
  badgeCount = 0,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  /**
   * Compteur discret affiché à droite de l'entrée (ex: fils non lus pour Mail).
   * 0 → pas de badge (rétro-compatible, n'altère pas le style des autres items).
   * Au-delà de 99 → « 99+ » pour ne pas casser la largeur de la nav.
   */
  badgeCount?: number;
}) {
  // Hover state is applied via direct style mutation on inactive items —
  // a Tailwind `hover:bg-…` would lose to the inline `color` set below
  // (inline always beats pseudo-classes), and the active style needs to
  // remain stable on hover. Same approach as FolderNode in the FileTree.
  //
  // Motion: easing is routed through the shared color+transform tokens via an
  // inline `transition` (composite `--sn-transition-colors` for the hover/active
  // bg+text fade, `--sn-transition-transform` to back the `.sn-pressable` scale).
  // Inline transition is required because the hover/active values are themselves
  // inline (they have to beat pseudo-classes); a class-based `transition` would
  // be clobbered by `.sn-pressable`'s own `transition`, so we declare both lists
  // here in one place. `.sn-pressable` still supplies the `:active` scale rule
  // (and its reduced-motion override). Both token paths degrade to instant.
  return (
    <Link
      href={item.href}
      prefetch={true}
      className="sn-pressable flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] focus-visible:outline-none"
      style={
        active
          ? {
              backgroundColor: "var(--nav-active-bg)",
              color: "var(--nav-active-fg)",
              fontWeight: 600,
              boxShadow: "var(--nav-active-ring)",
              transition: "var(--sn-transition-colors), var(--sn-transition-transform)",
            }
          : {
              color: "var(--text-secondary)",
              transition: "var(--sn-transition-colors), var(--sn-transition-transform)",
            }
      }
      onMouseEnter={(e) => {
        if (active) return;
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.backgroundColor = "var(--surface-2)";
        el.style.color = "var(--text-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.backgroundColor = "";
        el.style.color = "var(--text-secondary)";
      }}
    >
      <item.icon size={16} weight={active ? "fill" : "regular"} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badgeCount > 0 && (
        <span
          aria-label={`${badgeCount} non lu${badgeCount > 1 ? "s" : ""}`}
          className="ml-auto shrink-0 rounded-full px-1.5 text-[10px] font-semibold leading-[1.4]"
          style={{
            backgroundColor: active ? "var(--btn-primary-bg)" : "var(--accent-subtle)",
            color: active ? "var(--btn-primary-fg)" : "var(--accent)",
          }}
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
});

export const Sidebar = memo(function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations();
  const [notifOpen, setNotifOpen] = useState(false);
  const { unreadCount } = useNotifications();
  const vault = useVault();
  const isNext = useUiMode().mode === "next";

  // Built-in features behave like plugins: each has a localStorage flag
  // controlling whether its nav entry is visible. Hooks must run in a fixed
  // order, so we read every gate upfront and expose an item→visible predicate.
  // Le catalogue `catalog.ts` tague chaque item avec un `gate` (routines /
  // mail) ; on applique ici la MÊME logique que le drawer mobile.
  const routinesEnabled = usePluginEnabled("routines", true);
  const gmailConnected = useGmailConnected();
  // Fils non lus en boîte de réception → badge discret sur l'entrée « Mail ».
  // Le hook renvoie 0 (donc pas de badge) tant que Gmail n'est pas connecté.
  const mailUnread = useInboxUnreadCount();
  const gateEnabled: Record<NavGate, boolean> = {
    routines: routinesEnabled,
    mail: gmailConnected,
  };
  const isItemVisible = useCallback(
    (item: NavItem) => (item.gate ? gateEnabled[item.gate] : true),
    [routinesEnabled, gmailConnected],
  );
  // Show the active vault name in the brand header. In Electron the PWA hook
  // is bypassed (vault === null) and we fall back to the static product name.
  // In PWA mode an empty `vaultName` means we haven't received VAULT_READY
  // yet (still loading or running in degraded localStorage mode).
  //
  // A device can host folder vaults (FSA) and/or cloud vaults (OPFS); the brand
  // opens the switcher whenever either is possible. For a cloud vault the worker
  // reports a generic "Coffre cloud" name — we override it with the room key
  // (the active cloud entry's name) and swap the badge for a cloud glyph.
  const activeEntry =
    vault?.recentVaults.find((v) => v.id === vault.activeVaultId) ?? null;
  const isCloudVault = activeEntry?.kind === "cloud";
  const canPickVault = Boolean(vault && (vault.isPwa || vault.canCloud));
  const brandLabel = canPickVault
    ? isCloudVault
      ? activeEntry!.name
      : vault!.vaultName ?? (vault!.state === "degraded" ? "Aucun vault" : "Supernote")
    : "Supernote";
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const brandRef = useRef<HTMLButtonElement>(null);

  const isActive = useCallback(
    (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href)),
    [pathname],
  );

  // Raccourci notifications : Cmd/Ctrl+Alt+B (« bell »). Cmd+Alt+N est réservé
  // à « nouvelle note » (pages /notes, via ShortcutProvider) — les deux se
  // masquaient selon la route.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "b") {
        e.preventDefault();
        setNotifOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const switcher =
    canPickVault && vault ? (
      <VaultSwitcherPopover
        open={switcherOpen}
        anchorRef={brandRef}
        recents={vault.recentVaults}
        activeId={vault.activeVaultId}
        onSwitch={(id) => {
          setSwitcherOpen(false);
          void vault.switchToVault(id);
        }}
        onForget={(id) => {
          void vault.forgetVault(id);
        }}
        onPickFolder={
          vault.isPwa
            ? () => {
                setSwitcherOpen(false);
                void vault.pickFolder();
              }
            : undefined
        }
        onStartGit={
          vault.isPwa
            ? () => {
                setSwitcherOpen(false);
                vault.startGitFlow();
              }
            : undefined
        }
        onStartCloud={
          vault.canCloud
            ? () => {
                setSwitcherOpen(false);
                vault.startCloudFlow();
              }
            : undefined
        }
        onClose={() => setSwitcherOpen(false)}
      />
    ) : null;

  const groups: RailGroup[] = NAV_GROUP_ORDER.map((groupId) => ({
    groupId,
    items: navItemsInGroup(groupId).filter(isItemVisible),
  })).filter(({ items }) => items.length > 0);

  if (isNext) {
    return (
      <>
        {notifOpen && (
          <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
        )}
        <SidebarRail
          brandLabel={brandLabel}
          isCloudVault={isCloudVault}
          canPickVault={canPickVault}
          brandRef={brandRef}
          switcherOpen={switcherOpen}
          onToggleSwitcher={() => setSwitcherOpen((v) => !v)}
          groups={groups}
          isActive={isActive}
          labelOf={(item) => t(item.labelKey)}
          settingsLabel={t(NAV_SETTINGS.labelKey)}
          mailUnread={mailUnread}
          unreadNotifications={unreadCount}
          onOpenNotifications={() => setNotifOpen(true)}
        />
        {switcher}
      </>
    );
  }

  return (
    <>
      {notifOpen && (
        <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
      )}
      <aside
        className="shell-chrome flex h-full flex-col border-r"
        style={{
          width: "var(--sidebar-width)",
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-chrome)",
        }}
      >
        {/* App brand — in PWA mode this opens the vault switcher popover so
            the user can swap between known vaults (or pick a new one) from
            the top-left without hunting through settings. In Electron the
            label is non-interactive and renders as a plain Link to home. */}
        <div
          className="flex items-center justify-between gap-1 px-3"
          style={{ height: "var(--header-height)" }}
        >
          {canPickVault ? (
            <Button
              ref={brandRef}
              type="button"
              variant="ghost"
              onClick={() => setSwitcherOpen((v) => !v)}
              aria-label="Changer de vault"
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-1 -mx-1"
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[11px] font-bold"
                style={{
                  backgroundColor: "var(--brand-mark-bg)",
                  color: "var(--brand-mark-fg)",
                }}
              >
                {isCloudVault ? <Cloud size={14} weight="fill" /> : "S"}
              </div>
              <span
                className="truncate text-sm font-semibold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {brandLabel}
              </span>
              <CaretDown size={11} weight="bold" style={{ color: "var(--text-muted)" }} />
            </Button>
          ) : (
            <Link
              href="/"
              prefetch={true}
              title={brandLabel}
              className="flex min-w-0 flex-1 items-center gap-2.5 transition-opacity hover:opacity-80 focus-visible:outline-none"
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[11px] font-bold"
                style={{
                  backgroundColor: "var(--brand-mark-bg)",
                  color: "var(--brand-mark-fg)",
                }}
              >
                {isCloudVault ? <Cloud size={14} weight="fill" /> : "S"}
              </div>
              <span
                className="truncate text-sm font-semibold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {brandLabel}
              </span>
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNotifOpen(true)}
            aria-label="Ouvrir le centre de notifications"
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
            style={{ color: "var(--text-muted)" }}
          >
            <Bell size={15} />
            <NotificationBadge
              count={unreadCount}
              className="absolute -right-1 -top-1"
            />
          </Button>
        </div>
        {switcher}

      <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Navigation groups. Items belonging to a disabled plugin are
          filtered out — the underlying route still works for direct
          navigation, only the sidebar entry is hidden. Empty groups are
          collapsed entirely so we don't render dangling section headers. */}
      <nav data-tour="sidebar-nav" className="flex flex-1 flex-col overflow-y-auto px-2 py-1.5">
        {groups.map(({ groupId, items }) => {
            // Le groupe « navigation » (Accueil, Assistant IA) est épinglé en
            // tête sans en-tête — un libellé « Navigation » au-dessus d'une nav
            // est un eyebrow redondant. Cf. NAV_HEADERLESS_GROUPS. Densité
            // Linear : plus de séparateur entre groupes, l'espacement du libellé
            // (mt-3) suffit à séparer.
            const headerless = NAV_HEADERLESS_GROUPS.has(groupId);
            return (
              <div key={groupId}>
                {!headerless && (
                  <p className="sn-eyebrow sn-eyebrow--compact mb-1 mt-3 px-2.5">
                    {t(NAV_GROUP_LABEL_KEY[groupId])}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                      label={t(item.labelKey)}
                      badgeCount={item.href === "/mail" ? mailUnread : 0}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </nav>

      {/* Bottom settings */}
      <div
        className="border-t px-2 py-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Link
          href={NAV_SETTINGS.href}
          prefetch={true}
          data-tour="settings-link"
          className="sn-pressable flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] hover:bg-[var(--surface-2)] focus-visible:outline-none"
          style={{
            color: isActive(NAV_SETTINGS.href) ? "var(--nav-active-fg)" : "var(--text-muted)",
            backgroundColor: isActive(NAV_SETTINGS.href) ? "var(--nav-active-bg)" : undefined,
            fontWeight: isActive(NAV_SETTINGS.href) ? 600 : undefined,
            transition: "var(--sn-transition-colors), var(--sn-transition-transform)",
          }}
        >
          <NAV_SETTINGS.icon size={16} weight={isActive(NAV_SETTINGS.href) ? "fill" : "regular"} />
          {t(NAV_SETTINGS.labelKey)}
        </Link>
      </div>
      </aside>
    </>
  );
});

/* ── Vault switcher ───────────────────────────────────────────────────── */

interface VaultSwitcherPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  recents: ReadonlyArray<RecentVault>;
  activeId: string | null;
  onSwitch: (id: string) => void;
  onForget: (id: string) => void;
  onPickFolder?: () => void;
  onStartGit?: () => void;
  onStartCloud?: () => void;
  onClose: () => void;
}

/**
 * Anchored popover listing known vaults so the user can switch between
 * folders without leaving the sidebar. Same lightweight pattern as
 * `ColorPickerPopover` — no portal, `position: fixed` next to the trigger,
 * click-outside + Escape close.
 */
function VaultSwitcherPopover({
  open,
  anchorRef,
  recents,
  activeId,
  onSwitch,
  onForget,
  onPickFolder,
  onStartGit,
  onStartCloud,
  onClose,
}: VaultSwitcherPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    // Recompute on open so the rect reflects the current sidebar width
    // and chrome state (which may have shifted since last open).
    setRect(anchorRef.current?.getBoundingClientRect() ?? null);
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !rect) return null;

  const POP_W = 256;
  const margin = 4;
  let left = rect.left;
  const top = rect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - POP_W - 8);
  }

  return (
    <div
      ref={popRef}
      role="menu"
      aria-label="Vaults récents"
      className="fixed z-50 flex flex-col rounded-[var(--radius-lg)] p-1 shadow-lg"
      style={{
        left,
        top,
        width: POP_W,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border)",
      }}
    >
      <VaultSwitcherList
        recents={recents}
        activeId={activeId}
        onSwitch={onSwitch}
        onForget={onForget}
        onPickFolder={onPickFolder}
        onStartGit={onStartGit}
        onStartCloud={onStartCloud}
      />
    </div>
  );
}
