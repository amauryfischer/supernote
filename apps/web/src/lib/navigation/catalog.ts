/**
 * Catalogue de navigation — SOURCE UNIQUE de la structure de nav.
 *
 * Avant ce fichier, la même liste de routes était recopiée à la main dans cinq
 * endroits (Sidebar desktop, MoreDrawer mobile, MobileBottomNav, deux tables de
 * libellés). Elles avaient déjà dérivé : `/ai` et `/pomodoro` étaient
 * injoignables au doigt, et les groupes n'avaient ni le même nom ni le même
 * ordre desktop ↔ mobile.
 *
 * Principe PRODUCT.md « un seul espace, une seule grammaire » : desktop et
 * mobile dérivent tous deux d'ici, donc la parité est garantie par construction.
 *
 * Ce module est PUR data (pas de hook, pas de JSX) pour être importable partout.
 * Les libellés sont des clés i18n (`nav.*`) résolues par `useTranslations()`
 * côté composant. Les gates (`routines`, `mail`) marquent les items
 * dont la visibilité dépend d'un flag plugin / de la connexion Gmail : chaque
 * surface applique les hooks correspondants et filtre — mais de la MÊME façon.
 */

import {
  Archive,
  CheckSquare,
  EnvelopeSimple,
  FileText,
  Function,
  Gear,
  GridNine,
  House,
  Lightning,
  Robot,
  Tag,
  Timer,
  Users,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type NavGroupId = "navigation" | "knowledge" | "tools";

/** Gate de visibilité — même sémantique appliquée sur toutes les surfaces. */
export type NavGate = "routines" | "mail";

export interface NavItem {
  href: string;
  /** Clé i18n, ex. `nav.home`. Résolue via `useTranslations()`. */
  labelKey: string;
  icon: PhosphorIcon;
  group: NavGroupId;
  gate?: NavGate;
}

/** Ordre d'affichage des groupes, identique desktop et mobile. */
export const NAV_GROUP_ORDER: readonly NavGroupId[] = ["navigation", "knowledge", "tools"];

/** Clé i18n du libellé de chaque groupe. */
export const NAV_GROUP_LABEL_KEY: Record<NavGroupId, string> = {
  navigation: "nav.groups.navigation",
  knowledge: "nav.groups.knowledge",
  tools: "nav.groups.tools",
};

/**
 * Groupes rendus SANS en-tête de section, sur les deux surfaces. Le groupe
 * « navigation » (Accueil, Assistant IA) est épinglé en tête : un libellé
 * « Navigation » au-dessus d'une nav est un eyebrow redondant.
 */
export const NAV_HEADERLESS_GROUPS: ReadonlySet<NavGroupId> = new Set<NavGroupId>(["navigation"]);

/** Items de la nav principale (scrollable), dans l'ordre. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", labelKey: "nav.home", icon: House, group: "navigation" },
  { href: "/ai", labelKey: "nav.ai", icon: Robot, group: "navigation" },

  { href: "/notes", labelKey: "nav.notes", icon: FileText, group: "knowledge" },
  { href: "/mail", labelKey: "nav.mail", icon: EnvelopeSimple, group: "knowledge", gate: "mail" },
  { href: "/archive", labelKey: "nav.archive", icon: Archive, group: "knowledge" },
  { href: "/todos", labelKey: "nav.todos", icon: CheckSquare, group: "knowledge" },
  { href: "/habits", labelKey: "nav.habits", icon: GridNine, group: "knowledge" },
  { href: "/contacts", labelKey: "nav.contacts", icon: Users, group: "knowledge" },
  { href: "/finance", labelKey: "nav.finance", icon: Wallet, group: "knowledge" },

  { href: "/tags", labelKey: "nav.tags", icon: Tag, group: "tools" },
  { href: "/variables", labelKey: "nav.variables", icon: Function, group: "tools" },
  { href: "/routines", labelKey: "nav.routines", icon: Lightning, group: "tools", gate: "routines" },
  { href: "/pomodoro", labelKey: "nav.pomodoro", icon: Timer, group: "tools" },
];

/**
 * Réglages — placement spécial (bas du sidebar desktop, section « Système » du
 * drawer mobile), donc hors des groupes scrollables ci-dessus.
 */
export const NAV_SETTINGS: NavItem = {
  href: "/parametres",
  labelKey: "nav.settings",
  icon: Gear,
  group: "tools",
};

/**
 * Routes promues en onglets de la bottom-nav mobile : elles ne réapparaissent
 * donc PAS dans le drawer « Plus » (évite les doublons). Le reste du catalogue
 * peuple le drawer automatiquement.
 */
export const MOBILE_PRIMARY_HREFS: readonly string[] = ["/", "/notes", "/todos"];

/** `true` si `href` correspond à la route active (exact pour `/`, préfixe sinon). */
export function isNavActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Items d'un groupe, dans l'ordre du catalogue. */
export function navItemsInGroup(group: NavGroupId): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

/**
 * Préfixes de route qui, lorsqu'ils sont actifs, doivent surligner l'onglet
 * « Plus » de la bottom-nav : tout ce qui vit uniquement dans le drawer
 * (donc hors onglets primaires et hors `/archive`, couvert par l'onglet Notes).
 */
export const MOBILE_MORE_MATCH_PREFIXES: readonly string[] = [
  ...NAV_ITEMS.map((i) => i.href),
  NAV_SETTINGS.href,
].filter((href) => href !== "/" && !MOBILE_PRIMARY_HREFS.includes(href) && href !== "/archive");
