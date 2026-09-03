"use client";

import { Bell, Cloud } from "@phosphor-icons/react";
import { Fragment, memo, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { NotificationBadge } from "@supernote/notifications/renderer";
import { Button, Tooltip } from "@supernote/ui";
import { NAV_SETTINGS, type NavGroupId, type NavItem } from "@/lib/navigation/catalog";

export interface RailGroup {
  groupId: NavGroupId;
  items: NavItem[];
}

interface RailItemProps {
  item: Pick<NavItem, "href" | "icon">;
  active: boolean;
  label: string;
  badgeCount?: number;
  tour?: string;
}

const RailItem = memo(function RailItem({ item, active, label, badgeCount = 0, tour }: RailItemProps) {
  const router = useRouter();
  return (
    <Tooltip content={label} placement="right" delay={150}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => router.push(item.href)}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        data-active={active}
        data-tour={tour}
        className="sn-rail-item sn-pressable relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)]"
      >
        <item.icon size={19} weight={active ? "fill" : "regular"} />
        {badgeCount > 0 && (
          <span
            aria-label={`${badgeCount} non lu${badgeCount > 1 ? "s" : ""}`}
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-semibold leading-4"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </Button>
    </Tooltip>
  );
});

interface SidebarRailProps {
  brandLabel: string;
  isCloudVault: boolean;
  canPickVault: boolean;
  brandRef: RefObject<HTMLButtonElement | null>;
  switcherOpen: boolean;
  onToggleSwitcher: () => void;
  groups: RailGroup[];
  isActive: (href: string) => boolean;
  labelOf: (item: NavItem) => string;
  settingsLabel: string;
  mailUnread: number;
  unreadNotifications: number;
  onOpenNotifications: () => void;
}

/**
 * Sidebar réduite à un rail d'icônes (registre next). Les libellés vivent dans
 * les tooltips ; la recherche est dans la topbar ; le vault s'ouvre depuis la
 * marque en tête.
 */
export const SidebarRail = memo(function SidebarRail({
  brandLabel,
  isCloudVault,
  canPickVault,
  brandRef,
  switcherOpen,
  onToggleSwitcher,
  groups,
  isActive,
  labelOf,
  settingsLabel,
  mailUnread,
  unreadNotifications,
  onOpenNotifications,
}: SidebarRailProps) {
  const router = useRouter();
  return (
    <aside
      className="shell-chrome flex h-full flex-col items-center gap-1 py-2"
      style={{ width: "var(--rail-width)", backgroundColor: "var(--surface-chrome)" }}
    >
      <Tooltip content={brandLabel} placement="right" delay={150}>
        <Button
          ref={brandRef}
          variant="ghost"
          size="icon"
          onClick={canPickVault ? onToggleSwitcher : () => router.push("/")}
          aria-label={canPickVault ? "Changer de vault" : brandLabel}
          aria-haspopup={canPickVault ? "menu" : undefined}
          aria-expanded={canPickVault ? switcherOpen : undefined}
          className="sn-pressable mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[12px] font-bold"
          style={{ backgroundColor: "var(--brand-mark-bg)", color: "var(--brand-mark-fg)" }}
        >
          {isCloudVault ? <Cloud size={15} weight="fill" /> : "S"}
        </Button>
      </Tooltip>

      <nav
        data-tour="sidebar-nav"
        className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none]"
      >
        {groups.map(({ groupId, items }, index) => (
          <Fragment key={groupId}>
            {index > 0 && (
              <div aria-hidden="true" className="my-1 h-px w-5 shrink-0" style={{ backgroundColor: "var(--border)" }} />
            )}
            {items.map((item) => (
              <RailItem
                key={item.href}
                item={item}
                active={isActive(item.href)}
                label={labelOf(item)}
                badgeCount={item.href === "/mail" ? mailUnread : 0}
              />
            ))}
          </Fragment>
        ))}
      </nav>

      <Tooltip content="Notifications" placement="right" delay={150}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenNotifications}
          aria-label="Ouvrir le centre de notifications"
          className="sn-rail-item sn-pressable relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)]"
        >
          <Bell size={19} />
          <NotificationBadge count={unreadNotifications} className="absolute -right-0.5 -top-0.5" />
        </Button>
      </Tooltip>
      <RailItem
        item={NAV_SETTINGS}
        active={isActive(NAV_SETTINGS.href)}
        label={settingsLabel}
        tour="settings-link"
      />
    </aside>
  );
});
