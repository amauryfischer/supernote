"use client";

import {
  type IconWeight,
  CheckSquare,
  DotsThree,
  FileText,
  EnvelopeSimple,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";
import { Button } from "@supernote/ui";
import { MOBILE_MORE_MATCH_PREFIXES } from "@/lib/navigation/catalog";

interface NavTab {
  href: string;
  label: string;
  icon: PhosphorIcon;
  /**
   * When set, the tab does not navigate but instead invokes a callback (e.g.
   * the "Plus" tab opens a drawer rather than going to a route).
   */
  onPress?: () => void;
  /** Patterns that count as active for this tab. */
  match: (pathname: string) => boolean;
  /** Graisse active : `fill` par défaut ; les trois points pleins formaient
   *  une pilule noire. */
  activeWeight?: IconWeight;
}

/**
 * Bottom navigation — four tabs (two on each side) flanking a central slot
 * left empty for the floating action button. The FAB is rendered separately
 * by `MobileFab`; it positions itself over this slot, slightly raised so the
 * top of the circle peeks above the bar like a Material Design FAB.
 *
 * Layout: 56 px tall + safe-area-inset-bottom. Icons centered in each tab
 * column, label in 10 px below. L'onglet actif prend le rôle `--nav-active-*`
 * (neutre fort), jamais `--accent` en dur : la navigation est un état « vous
 * êtes ici », pas une sélection.
 */
export const MobileBottomNav = memo(function MobileBottomNav({
  onOpenMore,
}: {
  onOpenMore: () => void;
}) {
  const pathname = usePathname();

  // Two tabs on each side of the FAB: the central slot is reserved for the
  // create action — the most common verb on every page.
  const leftTabs: NavTab[] = [
    {
      href: "/mail",
      label: "Mail",
      icon: EnvelopeSimple,
      match: (p) => p.startsWith("/mail"),
    },
    {
      href: "/notes",
      label: "Notes",
      icon: FileText,
      match: (p) => p.startsWith("/notes") || p.startsWith("/archive"),
    },
  ];
  const rightTabs: NavTab[] = [
    {
      href: "/todos",
      label: "Todos",
      icon: CheckSquare,
      match: (p) => p.startsWith("/todos"),
    },
    {
      href: "#more",
      label: "Plus",
      icon: DotsThree,
      activeWeight: "bold",
      onPress: onOpenMore,
      match: (p) =>
        // Highlight "Plus" whenever we're on a section that lives only in the
        // drawer (finance, contacts, assistant IA, pomodoro…). Dérivé
        // du catalogue : tout ajout de route dans catalog.ts surligne « Plus »
        // sans édition ici — plus de liste recopiée à la main.
        MOBILE_MORE_MATCH_PREFIXES.some((prefix) => p.startsWith(prefix)),
    },
  ];

  return (
    <nav
      className="relative flex shrink-0 items-stretch border-t"
      style={{
        height: "calc(56px + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        backgroundColor: "var(--surface-chrome)",
        borderColor: "var(--border-subtle)",
      }}
      aria-label="Navigation principale"
    >
      {leftTabs.map((tab) => (
        <NavTabButton key={tab.label} tab={tab} active={tab.match(pathname)} />
      ))}
      {/* Central slot — the FAB renders into this gap (positioned by
          MobileFab as `absolute left-1/2 -translate-x-1/2 -top-5`). The flex
          item below holds the gap open so the right-side tabs don't slide
          into the FAB's footprint. Width matches the FAB's 56 px circle plus
          a little breathing room on each side. */}
      <div className="w-[72px] shrink-0" aria-hidden="true" />
      {rightTabs.map((tab) => (
        <NavTabButton key={tab.label} tab={tab} active={tab.match(pathname)} />
      ))}
    </nav>
  );
});

const NavTabButton = memo(function NavTabButton({
  tab,
  active,
}: {
  tab: NavTab;
  active: boolean;
}) {
  const Icon = tab.icon;
  // Discrete active/inactive state → token CSS transition via the shared
  // `.sn-motion-colors` utility (carries `--sn-transition-colors` AND the
  // reduced-motion degrade).
  const baseClass =
    "sn-motion-colors relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium";
  const style: React.CSSProperties = {
    color: active ? "var(--nav-active-fg)" : "var(--text-muted)",
    fontWeight: active ? 600 : 500,
    // L'anneau global `:focus-visible` porte un `outline-offset: 2px` qui
    // déborderait hors de la barre sur une cellule pleine hauteur : on le
    // rentre plutôt que de supprimer l'anneau (chemin clavier exigé par
    // PRODUCT.md — l'ancien `focus-visible:outline-none` n'avait aucun
    // remplaçant). Sans anneau, `outline-offset` seul est inerte.
    outlineOffset: "-3px",
  };

  // Active indicator — pastille courte qui glisse vers le haut + apparaît
  // quand l'onglet devient actif. `.sn-motion-glide` ne pilote que
  // transform+opacity (idle = 0 frame, compositor-friendly) et dégrade sous
  // reduced-motion. Le -50% X tient le centrage ; le Y/opacity portent l'entrée.
  const indicator = (
    <span
      aria-hidden="true"
      className="sn-motion-glide pointer-events-none absolute left-1/2 top-1 h-0.5 w-5 rounded-full"
      style={{
        backgroundColor: "var(--nav-active-fg)",
        opacity: active ? 1 : 0,
        transform: active
          ? "translate(-50%, 0)"
          : "translate(-50%, 3px)",
      }}
    />
  );

  if (tab.onPress) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={tab.onPress}
        className={baseClass}
        // ⚠️ `.button--md` (hors @layer) fixe hauteur/padding/rayon et bat les
        // utilitaires Tailwind : seul l'inline aligne l'onglet sur les `Link`.
        style={{ ...style, height: "100%", padding: 0, borderRadius: 0 }}
        aria-label={tab.label}
        aria-current={active ? "page" : undefined}
      >
        {indicator}
        <Icon size={22} weight={active ? (tab.activeWeight ?? "fill") : "regular"} />
        <span>{tab.label}</span>
      </Button>
    );
  }
  return (
    <Link
      href={tab.href}
      prefetch={true}
      className={baseClass}
      style={style}
      aria-current={active ? "page" : undefined}
    >
      {indicator}
      <Icon size={22} weight={active ? (tab.activeWeight ?? "fill") : "regular"} />
      <span>{tab.label}</span>
    </Link>
  );
});
