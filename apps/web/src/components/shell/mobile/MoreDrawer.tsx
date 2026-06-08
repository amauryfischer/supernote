"use client";

import {
  Archive,
  Bell,
  CaretRight,
  Calendar,
  FolderOpen,
  Function,
  Gear,
  GridNine,
  Lightning,
  Tag,
  Users,
  Wallet,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { Button, Drawer } from "@supernote/ui";
import { memo } from "react";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useVault } from "@/lib/pwa/PwaVaultSetup";

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
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenNotifications: () => void;
}) {
  const { unreadCount } = useNotifications();
  const vault = useVault();
  const canPickVault = Boolean(vault?.isPwa);
  const brandLabel =
    vault && vault.isPwa
      ? vault.vaultName ?? (vault.state === "degraded" ? "Aucun vault" : "Supernote")
      : "Supernote";

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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {/* Vault card — quick access to the active vault, folder picker,
              and notifications. Mirrors the iOS "Apple ID card" pattern at
              the top of Settings. */}
          <div
            className="mb-6 flex items-center gap-3 rounded-2xl p-3"
            style={{ backgroundColor: "var(--surface-2)" }}
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold"
              style={{
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              }}
            >
              S
            </div>
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
                Supernote · vault local
              </div>
            </div>
            {canPickVault && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void vault?.pickFolder()}
                aria-label="Changer de vault"
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ color: "var(--text-secondary)" }}
              >
                <FolderOpen size={20} />
              </Button>
            )}
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
        </div>
      </div>
    </Drawer>
  );
});
