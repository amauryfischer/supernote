"use client";

import {
  Bell,
  CaretRight,
  Cloud,
  Desktop,
  Keyboard,
  MagnifyingGlass,
  Moon,
  Plugs,
  Sun,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  Drawer,
  useAppTheme,
  setThemeWithTransition,
  originFromElement,
  type ThemeValue,
} from "@supernote/ui";
import { memo, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { NotificationBadge, useNotifications } from "@supernote/notifications/renderer";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { usePluginEnabled } from "@/hooks/usePluginEnabled";
import { MobileVaultSwitcher } from "./MobileVaultSwitcher";
import { ShortcutsCheatSheet } from "@/components/notes/ShortcutsCheatSheet";
import {
  NAV_GROUP_ORDER,
  NAV_GROUP_LABEL_KEY,
  NAV_HEADERLESS_GROUPS,
  NAV_SETTINGS,
  MOBILE_PRIMARY_HREFS,
  navItemsInGroup,
  isNavActive,
  type NavItem,
  type NavGate,
} from "@/lib/navigation/catalog";

const THEME_CYCLE: ThemeValue[] = ["light", "dark", "system"];

/**
 * Theme cycle button — light → dark → system. Mirrors the desktop topbar's
 * `ThemeToggleButton`, which the mobile shell otherwise lacked (theme could
 * only be changed deep in /parametres). Lives in the vault card so it sits
 * next to the other global affordances (folder picker, notifications).
 */
function ThemeCycleButton() {
  const { theme, setTheme } = useAppTheme();
  const next = useCallback(
    // HeroUI passe un MouseEvent<FocusableElement> (react-aria), pas
    // <HTMLElement> — on élargit à Element (suffisant pour originFromElement).
    (e?: ReactMouseEvent<Element>) => {
      const current: ThemeValue = theme ?? "light";
      const idx = THEME_CYCLE.indexOf(current);
      const nextTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length] ?? "light";
      // Révélation circulaire depuis le bouton — même geste que le TopBar
      // desktop. Sans event exploitable → cross-fade natif ; sans support VT
      // ou en reduced-motion → bascule directe (géré par le helper).
      const origin = e?.currentTarget ? originFromElement(e.currentTarget) : undefined;
      setThemeWithTransition(setTheme, nextTheme, origin);
    },
    [theme, setTheme],
  );

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

/**
 * Tuile d'icône du drawer. Neutre au repos ; l'accent est réservé à l'item
 * ACTIF (état « vous êtes ici », pas décoration) et aux actions primaires —
 * même grammaire que le sidebar desktop. L'ancien traitement arc-en-ciel (une
 * teinte par item) contredisait le registre « calme & concentré » et le ban
 * product « accent plein sur états inactifs ».
 */
function RowIcon({
  icon: Icon,
  accent = false,
}: {
  icon: PhosphorIcon;
  accent?: boolean;
}) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
      style={{
        backgroundColor: accent ? "var(--accent-subtle)" : "var(--surface-2)",
        color: accent ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      <Icon size={18} weight="duotone" />
    </span>
  );
}

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
  const gmailConnected = useGmailConnected();
  const pathname = usePathname();
  const t = useTranslations();
  // Gates de visibilité — mêmes flags que le sidebar desktop, appliqués ici de
  // façon identique pour garantir la parité (journal masqué par défaut, etc.).
  const journalEnabled = usePluginEnabled("journal", false);
  const routinesEnabled = usePluginEnabled("routines", true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
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

  const gateEnabled: Record<NavGate, boolean> = {
    journal: journalEnabled,
    routines: routinesEnabled,
    mail: gmailConnected,
  };
  const isItemVisible = (item: NavItem) => (item.gate ? gateEnabled[item.gate] : true);
  // Groupes du drawer dérivés du catalogue : on retire les routes déjà
  // présentes dans la bottom-nav (Accueil, Notes, Todos) pour éviter les
  // doublons ; le reste (dont Assistant IA et Pomodoro, jadis injoignables au
  // doigt) peuple le drawer. Même ordre et mêmes libellés que le sidebar.
  const drawerGroups = NAV_GROUP_ORDER.map((groupId) => ({
    groupId,
    headerless: NAV_HEADERLESS_GROUPS.has(groupId),
    items: navItemsInGroup(groupId).filter(
      (item) => !MOBILE_PRIMARY_HREFS.includes(item.href) && isItemVisible(item),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <Drawer
      isOpen={isOpen}
      onOpenChange={(o) => !o && onClose()}
      placement="bottom"
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

          {/* Recherche unifiée (emails + notes + bases). Sur desktop elle est
              sur Cmd+Shift+K ; au doigt elle n'avait aucune affordance. */}
          <div className="mb-6">
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent("supernote:open-unified-search"));
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[var(--surface-2)]"
                style={{ color: "var(--text-primary)" }}
              >
                <RowIcon icon={MagnifyingGlass} accent />
                <span className="flex-1 text-[15px] font-medium">Rechercher partout</span>
                <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
          </div>

          {/* Sections dérivées du catalogue — chaque groupe = une carte
              arrondie. Libellé de section aligné sur le sidebar desktop (i18n),
              sauf les groupes épinglés (navigation) rendus sans en-tête. Une
              hairline sépare les lignes. L'item actif prend l'accent (« vous
              êtes ici »), visible quand on ouvre « Plus » depuis une section
              qui ne vit que dans le drawer (Finance, Contacts…). */}
          {drawerGroups.map(({ groupId, headerless, items }) => (
            <div key={groupId} className="mb-6">
              {!headerless && (
                <p
                  className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t(NAV_GROUP_LABEL_KEY[groupId])}
                </p>
              )}
              <div
                className="overflow-hidden rounded-2xl"
                style={{ backgroundColor: "var(--surface-1)" }}
              >
                {items.map((item, idx) => {
                  const active = isNavActive(item.href, pathname);
                  const isLast = idx === items.length - 1;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-[var(--surface-2)]"
                      style={{
                        color: active ? "var(--accent)" : "var(--text-primary)",
                        borderBottom: isLast
                          ? undefined
                          : "1px solid var(--border-subtle)",
                      }}
                    >
                      <RowIcon icon={item.icon} accent={active} />
                      <span className="flex-1 text-[15px] font-medium">
                        {t(item.labelKey)}
                      </span>
                      <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Système — Paramètres (placement spécial, hors groupes scrollables
              du catalogue, comme le bas du sidebar desktop). */}
          <div className="mb-6">
            <p
              className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Système
            </p>
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <Link
                href={NAV_SETTINGS.href}
                onClick={onClose}
                aria-current={isNavActive(NAV_SETTINGS.href, pathname) ? "page" : undefined}
                className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-[var(--surface-2)]"
                style={{
                  color: isNavActive(NAV_SETTINGS.href, pathname)
                    ? "var(--accent)"
                    : "var(--text-primary)",
                }}
              >
                <RowIcon
                  icon={NAV_SETTINGS.icon}
                  accent={isNavActive(NAV_SETTINGS.href, pathname)}
                />
                <span className="flex-1 text-[15px] font-medium">
                  {t(NAV_SETTINGS.labelKey)}
                </span>
                <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
              </Link>
            </div>
          </div>

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
                <RowIcon icon={Plugs} />
                <span className="flex-1 text-[15px] font-medium">
                  Connecter un vault
                </span>
                <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
              </button>
            </div>
          </div>

          {/* Raccourcis clavier — cheat-sheet éditeur accessible depuis le
              tiroir mobile, sans quitter l'app. */}
          <div className="mb-6">
            <p
              className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Éditeur
            </p>
            <div
              className="overflow-hidden rounded-2xl"
              style={{ backgroundColor: "var(--surface-1)" }}
            >
              <Button
                variant="ghost"
                onPress={() => setCheatOpen(true)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left rounded-none"
                style={{ color: "var(--text-primary)" }}
              >
                <RowIcon icon={Keyboard} />
                <span className="flex-1 text-[15px] font-medium">
                  Raccourcis clavier
                </span>
                <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
              </Button>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
      <ShortcutsCheatSheet
        isOpen={cheatOpen}
        onClose={() => setCheatOpen(false)}
      />
    </Drawer>
  );
});
