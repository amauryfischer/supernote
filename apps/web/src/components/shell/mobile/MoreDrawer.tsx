"use client";

import {
  Archive,
  Bell,
  CaretRight,
  Calendar,
  Cloud,
  Desktop,
  Function,
  Gear,
  GridNine,
  Lightning,
  Moon,
  Plugs,
  Sun,
  Tag,
  Users,
  Wallet,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { Button, Drawer, useAppTheme, type ThemeValue } from "@supernote/ui";
import { memo, useCallback, useEffect, useState } from "react";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { MobileVaultSwitcher } from "./MobileVaultSwitcher";

const THEME_CYCLE: ThemeValue[] = ["light", "dark", "system"];

/**
 * Theme cycle button — light → dark → system. Mirrors the desktop topbar's
 * `ThemeToggleButton`, which the mobile shell otherwise lacked (theme could
 * only be changed deep in /parametres). Lives in the vault card so it sits
 * next to the other global affordances (folder picker, notifications).
 */
function ThemeCycleButton() {
  const { theme, setTheme } = useAppTheme();
  const next = useCallback(() => {
    const current: ThemeValue = theme ?? "light";
    const idx = THEME_CYCLE.indexOf(current);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light");
  }, [theme, setTheme]);

  const Icon = theme === "dark" ? Moon : theme === "system" ? Desktop : Sun;
  const label =
    theme === "dark" ? "Thème sombre" : theme === "system" ? "Thème système" : "Thème clair";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={next}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-lg"
      style={{ color: "var(--text-secondary)" }}
    >
      <Icon size={20} />
    </Button>
  );
}

/** Square brand tile — shows a cloud glyph for cloud vaults, else the "S". */
function VaultBadge({ isCloud }: { isCloud: boolean }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold"
      style={{
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      }}
    >
      {isCloud ? <Cloud size={22} weight="fill" /> : "S"}
    </div>
  );
}

interface MoreItem {
  href: string;
  label: string;
  icon: PhosphorIcon;
  /** Optional accent for the icon tile — defaults to the brand violet. */
  tint?: string;
}

interface MoreSection {
  title: string;
  items: MoreItem[];
}

// Per-item accent colors picked from the design system's hue range. Each
// section reads as a small palette so the eye can scan by color rather than
// by label, the way iOS Settings and Notion's mobile drawer feel.
const SECTIONS: MoreSection[] = [
  {
    title: "Connaissance",
    items: [
      { label: "Habitudes", href: "/habits", icon: GridNine, tint: "oklch(0.62 0.20 295)" },
      { label: "Journal", href: "/journal", icon: Calendar, tint: "oklch(0.65 0.20 30)" },
      { label: "Contacts", href: "/contacts", icon: Users, tint: "oklch(0.62 0.20 220)" },
      { label: "Finance", href: "/finance", icon: Wallet, tint: "oklch(0.62 0.20 150)" },
      { label: "Archive", href: "/archive", icon: Archive, tint: "oklch(0.55 0.05 260)" },
    ],
  },
  {
    title: "Outils",
    items: [
      { label: "Tags", href: "/tags", icon: Tag, tint: "oklch(0.65 0.18 80)" },
      { label: "Variables", href: "/variables", icon: Function, tint: "oklch(0.62 0.18 180)" },
      { label: "Routines", href: "/routines", icon: Lightning, tint: "oklch(0.70 0.18 90)" },
    ],
  },
  {
    title: "Système",
    items: [
      { label: "Paramètres", href: "/parametres", icon: Gear, tint: "oklch(0.55 0.05 260)" },
    ],
  },
];

/**
 * Secondary navigation drawer — opens from the bottom on mobile and covers
 * the full viewport. Layout follows the iOS-Settings / Notion-mobile
 * convention: large title, vault card on top, then groups of items rendered
 * inside rounded "cells" so each section reads as a unit.
 */
export const MoreDrawer = memo(function MoreDrawer({
  isOpen,
  onClose,
  onOpenNotifications,
  onOpenConnectVault,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenNotifications: () => void;
  onOpenConnectVault: () => void;
}) {
  const { unreadCount } = useNotifications();
  const vault = useVault();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Reset to the menu whenever the drawer closes, so reopening "Plus" never
  // lands back on the switcher sub-view (the X / backdrop / Bell paths close
  // the drawer without touching switcherOpen).
  useEffect(() => {
    if (!isOpen) setSwitcherOpen(false);
  }, [isOpen]);
  // A device can host folder vaults (FSA) and/or cloud vaults (OPFS — phones).
  // The card opens the switcher whenever either is possible. For a cloud vault
  // the worker reports a generic name, so we override with the room key (the
  // active cloud entry's name) and swap the badge for a cloud glyph.
  const activeEntry =
    vault?.recentVaults.find((v) => v.id === vault.activeVaultId) ?? null;
  const isCloudVault = activeEntry?.kind === "cloud";
  const canUseVault = Boolean(vault && (vault.isPwa || vault.canCloud));
  const brandLabel = canUseVault
    ? isCloudVault
      ? activeEntry!.name
      : vault!.vaultName ?? (vault!.state === "degraded" ? "Aucun vault" : "Supernote")
    : "Supernote";
  const vaultSubtitle = isCloudVault ? "Cloud · temps réel" : "Supernote · vault local";

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      placement="bottom"
      size="full"
      className="fullscreen-drawer !h-[100dvh] !rounded-none"
    >
      <div
        className="flex h-full flex-col"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          backgroundColor: "var(--surface-0)",
        }}
      >
        {/* Header — large title left, close button right (Apple sheet
            convention). Title doubles as a section heading; the X is the
            canonical close affordance. */}
        <header
          className="flex shrink-0 items-center justify-between px-5 pt-3 pb-2"
        >
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Plus
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--text-secondary)",
            }}
          >
            <X size={18} weight="bold" />
          </Button>
        </header>

        {/* Scrollable body. Tapping the vault card pushes the switcher as an
            in-place sub-view (NOT a nested drawer — two stacked modal overlays
            blanked the surface on phones), iOS-Settings style. */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {switcherOpen ? (
            <MobileVaultSwitcher
              onBack={() => setSwitcherOpen(false)}
              onCloseDrawer={() => {
                setSwitcherOpen(false);
                onClose();
              }}
            />
          ) : (
            <>
          {/* Vault card — quick access to the active vault, folder picker,
              and notifications. Mirrors the iOS "Apple ID card" pattern at
              the top of Settings. */}
          <div
            className="mb-6 flex items-center gap-2 rounded-2xl p-3"
            style={{ backgroundColor: "var(--surface-2)" }}
          >
            {canUseVault ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSwitcherOpen(true)}
                aria-label="Changer de coffre"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-0 text-left"
              >
                <VaultBadge isCloud={isCloudVault} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[15px] font-semibold tracking-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {brandLabel}
                  </span>
                  <span
                    className="block truncate text-[12px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {vaultSubtitle}
                  </span>
                </span>
                <CaretRight size={16} style={{ color: "var(--text-muted)" }} />
              </Button>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <VaultBadge isCloud={isCloudVault} />
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[15px] font-semibold tracking-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {brandLabel}
                  </div>
                  <div
                    className="truncate text-[12px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {vaultSubtitle}
                  </div>
                </div>
              </div>
            )}
            <ThemeCycleButton />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                onClose();
                onOpenNotifications();
              }}
              aria-label="Ouvrir le centre de notifications"
              className="relative flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ color: "var(--text-secondary)" }}
            >
              <Bell size={20} />
              <NotificationBadge
                count={unreadCount}
                className="absolute right-1 top-1"
              />
            </Button>
          </div>

          {/* Sections — each rendered as a single rounded card containing
              its rows, with a small uppercase label above. Rows separated
              by a 1 px hairline so the card reads as a list, not a stack of
              independent buttons. */}
          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-6">
              <p
                className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {section.title}
              </p>
              <div
                className="overflow-hidden rounded-2xl"
                style={{ backgroundColor: "var(--surface-1)" }}
              >
                {section.items.map((item, idx) => {
                  const Icon = item.icon;
                  const isLast = idx === section.items.length - 1;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-[var(--surface-2)]"
                      style={{
                        color: "var(--text-primary)",
                        borderBottom: isLast
                          ? undefined
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: item.tint
                            ? `color-mix(in oklch, ${item.tint} 18%, transparent)`
                            : "var(--accent-subtle)",
                          color: item.tint ?? "var(--accent)",
                        }}
                      >
                        <Icon size={18} weight="duotone" />
                      </span>
                      <span className="flex-1 text-[15px] font-medium">
                        {item.label}
                      </span>
                      <CaretRight
                        size={14}
                        style={{ color: "var(--text-muted)" }}
                      />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Coffres — entrée pour connecter un salon cloud (ouvre la même
              modale que le bouton « Connecter un vault » du FileTree desktop). */}
          <div className="mb-6">
            <p
              className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Coffres
            </p>
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenConnectVault();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[var(--surface-2)]"
                style={{ color: "var(--text-primary)" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    backgroundColor:
                      "color-mix(in oklch, oklch(0.62 0.20 220) 18%, transparent)",
                    color: "oklch(0.62 0.20 220)",
                  }}
                >
                  <Plugs size={18} weight="duotone" />
                </span>
                <span className="flex-1 text-[15px] font-medium">
                  Connecter un vault
                </span>
                <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
});
