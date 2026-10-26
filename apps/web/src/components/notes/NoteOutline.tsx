"use client";

/**
 * Plan de la note : titre courant collant, liste des titres (popover desktop,
 * bottom-sheet mobile), saut vers un titre, lien profond `?heading=<ancre>`,
 * largeur de lecture et statistiques de lecture.
 *
 * Tout est lecture seule sur le DOM de l'éditeur : aucune mutation dans le
 * sous-arbre ProseMirror (le surlignage passe par une balise <style> du head).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  CaretDown,
  LinkSimple,
  ListDashes,
} from "@phosphor-icons/react";
import { useParams, useSearchParams } from "next/navigation";
import { Button, Tooltip } from "@supernote/ui";
import { MobileSheet } from "@/components/shell/mobile/MobileSheet";
import { FeedbackIcon, useActionFeedback } from "@/lib/action-feedback";
import { tagKind } from "./NoteMinimap";

export interface OutlineHeading {
  id: string;
  level: 1 | 2 | 3;
  text: string;
  /** Ancre stable du lien profond : les ids BlockNote sont régénérés à chaque chargement de la note. */
  anchor: string;
  /** Tags de la section (jusqu'au titre suivant) : sur téléphone, le rail de la minimap ne peut pas les nommer. */
  tags: string[];
}

/** Les ids de bloc BlockNote sont des UUID ; on valide avant de les injecter dans un sélecteur ou une règle CSS. */
const BLOCK_ID_RE = /^[\w-]+$/;
const ANCHOR_RE = /^[a-z0-9-]{1,90}$/;
/** Marge laissée au-dessus d'un titre atteint, sous la barre collante. */
const SCROLL_OFFSET_PX = 48;
/** Un titre est « courant » dès que son haut passe sous cette ligne (> SCROLL_OFFSET_PX, pour qu'un saut le rende courant). */
const CURRENT_THRESHOLD_PX = SCROLL_OFFSET_PX + 8;
const RESCAN_DELAY_MS = 150;
const DEEP_LINK_WAIT_MS = 5000;
const DEEP_LINK_REALIGN_MS = [250, 800];
const BLOCK_FLASH_MS = 2200;

const READ_WIDTH_PX = 736; // ≈ 75 caractères à 16 px
const MIN_GUTTER_PX = 40;
const READ_PREF_KEY = "supernote.readingFullWidth";
const WORDS_PER_MINUTE = 200;

// ── Lecture du plan dans le DOM ──────────────────────────────────────────────

function blockElement(col: HTMLElement | null, id: string): HTMLElement | null {
  if (!col || !BLOCK_ID_RE.test(id)) return null;
  return col.querySelector<HTMLElement>(`[data-id="${id}"]`);
}

function slugify(text: string): string {
  const slug = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 80) || "titre";
}

// `el` est le bloc [data-id] et non le h1-h3 : c'est lui que scrollToBlock cale, la marge du titre faussait le seuil.
function readHeadings(col: HTMLElement): { heading: OutlineHeading; el: HTMLElement }[] {
  const found: { heading: OutlineHeading; el: HTMLElement }[] = [];
  const seen = new Map<string, number>();
  // Ordre du document : chaque tag revient au dernier titre rencontré.
  for (const h of col.querySelectorAll<HTMLElement>("h1, h2, h3, .sn-tag")) {
    if (h.classList.contains("sn-tag")) {
      const path = h.getAttribute("data-tag-path") ?? h.textContent?.replace(/^#/, "").trim();
      const tags = found[found.length - 1]?.heading.tags;
      if (path && tags && !tags.includes(path)) tags.push(path);
      continue;
    }
    // Un h1-h3 d'un bloc personnalisé (callout, embed…) n'est pas un titre de la note.
    const contentType = h.closest(".bn-block-content")?.getAttribute("data-content-type");
    if (contentType && contentType !== "heading") continue;
    const el = h.closest<HTMLElement>("[data-id]");
    const id = el?.getAttribute("data-id");
    const text = h.textContent?.trim();
    if (!el || !id || !text) continue;
    const slug = slugify(text);
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    found.push({ heading: { id, level: Number(h.tagName[1]) as 1 | 2 | 3, text, anchor: n > 1 ? `${slug}-${n}` : slug, tags: [] }, el });
  }
  return found;
}

function sameHeadings(a: OutlineHeading[], b: OutlineHeading[]): boolean {
  return a.length === b.length && a.every((h, i) => h.id === b[i]!.id && h.level === b[i]!.level && h.anchor === b[i]!.anchor && h.tags.join() === b[i]!.tags.join());
}

export function useNoteOutline(
  colRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
): { headings: OutlineHeading[]; currentId: string | null; passedFirst: boolean } {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [passedFirst, setPassedFirst] = useState(false);

  useEffect(() => {
    const col = colRef.current;
    const scroller = scrollRef.current;
    if (!col || !scroller) return undefined;
    let items: { heading: OutlineHeading; el: HTMLElement }[] = [];

    const updateCurrent = () => {
      const top = scroller.getBoundingClientRect().top;
      const line = top + CURRENT_THRESHOLD_PX;
      let id: string | null = null;
      for (const it of items) {
        if (it.el.getBoundingClientRect().top > line) break;
        id = it.heading.id;
      }
      setCurrentId((prev) => (prev === id ? prev : id));
      // La barre collante n'apparaît qu'une fois le premier titre sorti par le haut.
      const passed = items.length > 0 && items[0]!.el.getBoundingClientRect().top < top;
      setPassedFirst((prev) => (prev === passed ? prev : passed));
    };
    const scan = () => {
      items = readHeadings(col);
      const next = items.map((it) => it.heading);
      setHeadings((prev) => (sameHeadings(prev, next) ? prev : next));
      updateCurrent();
    };

    let scanTimer = 0;
    const scheduleScan = () => {
      if (!scanTimer) {
        scanTimer = window.setTimeout(() => {
          scanTimer = 0;
          scan();
        }, RESCAN_DELAY_MS);
      }
    };
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateCurrent();
      });
    };

    const mo = new MutationObserver(scheduleScan);
    mo.observe(col, { childList: true, characterData: true, subtree: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(col);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scan();
    return () => {
      window.clearTimeout(scanTimer);
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [colRef, scrollRef]);

  return { headings, currentId, passedFirst };
}

// ── Saut vers un bloc, surlignage, lien profond ──────────────────────────────

export function scrollToBlock(
  col: HTMLElement | null,
  scroller: HTMLElement | null,
  id: string,
  smooth: boolean,
): boolean {
  const el = blockElement(col, id);
  if (!el || !scroller) return false;
  const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - SCROLL_OFFSET_PX;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  return true;
}

let flashStyle: HTMLStyleElement | null = null;
let flashTimer = 0;

/** Surligne brièvement un bloc via une règle du head keyée sur `data-id` : jamais d'attribut posé dans l'éditeur. */
function flashBlock(id: string): void {
  if (!BLOCK_ID_RE.test(id)) return;
  const rule = `.bn-block-outer[data-id="${id}"] > .bn-block > .bn-block-content { animation: sn-block-target ${BLOCK_FLASH_MS}ms ease-out; border-radius: 4px; }`;
  flashStyle ??= document.createElement("style");
  flashStyle.textContent = "";
  document.head.appendChild(flashStyle);
  void document.documentElement.offsetHeight; // relance l'animation si le même bloc est ciblé deux fois
  flashStyle.textContent = rule;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flashStyle?.remove(), BLOCK_FLASH_MS + 200);
}

function headingUrl(anchor: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("heading", anchor);
  url.hash = "";
  return url.toString();
}

/** Ancre visée par `?heading=` — seulement pour la note affichée par la page, pas pour une colonne empilée. */
export function useDeepLinkHeading(noteId: string): string | null {
  const params = useParams<{ id: string }>();
  const anchor = useSearchParams().get("heading");
  return params.id === noteId && anchor && ANCHOR_RE.test(anchor) ? anchor : null;
}

/** Fait défiler jusqu'au titre visé (l'éditeur peint après le montage) puis le surligne. */
export function useHeadingDeepLink(
  anchor: string | null,
  colRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!anchor) return undefined;
    const scroller = scrollRef.current;
    let frame = 0;
    const timers: number[] = [];
    let userMoved = false;
    const onUserMove = () => {
      userMoved = true;
    };
    scroller?.addEventListener("wheel", onUserMove, { passive: true });
    scroller?.addEventListener("touchmove", onUserMove, { passive: true });
    const started = performance.now();
    const attempt = () => {
      const col = colRef.current;
      const blockId = col ? readHeadings(col).find((it) => it.heading.anchor === anchor)?.heading.id : undefined;
      if (blockId && scrollToBlock(col, scrollRef.current, blockId, false)) {
        flashBlock(blockId);
        // Images et blocs dynamiques décalent la page après le premier calage.
        for (const delay of DEEP_LINK_REALIGN_MS) {
          timers.push(
            window.setTimeout(() => {
              if (!userMoved) scrollToBlock(colRef.current, scrollRef.current, blockId, false);
            }, delay),
          );
        }
        return;
      }
      if (performance.now() - started < DEEP_LINK_WAIT_MS) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((t) => window.clearTimeout(t));
      scroller?.removeEventListener("wheel", onUserMove);
      scroller?.removeEventListener("touchmove", onUserMove);
    };
  }, [anchor, colRef, scrollRef]);
}

// ── Largeur de lecture ───────────────────────────────────────────────────────

export function useReadingWidthPref(): [boolean, () => void] {
  const [full, setFull] = useState(() => {
    try {
      return localStorage.getItem(READ_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    try {
      localStorage.setItem(READ_PREF_KEY, full ? "0" : "1");
    } catch {}
    setFull(!full);
  };
  return [full, toggle];
}

/**
 * Pose `--sn-note-gutter` (marge latérale de `.sn-note-gutter`) sur la racine de la note :
 * titre, barre méta, texte et pied partagent ainsi la même arête gauche, centrée sur la
 * largeur du conteneur de défilement. `extraPx` = colonne latérale (marges IA) qui
 * s'ajoute à la colonne de texte. Mesure sans la barre de défilement : pas de boucle.
 */
export function useReadingGutter(
  rootRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  fullWidth: boolean,
  extraPx: number,
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = scrollRef.current;
    if (!root || !scroller) return undefined;
    const apply = () => {
      const gutter = fullWidth ? MIN_GUTTER_PX : Math.max(MIN_GUTTER_PX, (scroller.offsetWidth - READ_WIDTH_PX - extraPx) / 2);
      root.style.setProperty("--sn-note-gutter", `${Math.round(gutter)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(scroller);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sn-note-gutter");
    };
  }, [rootRef, scrollRef, fullWidth, extraPx]);
}

// ── Mots et temps de lecture ─────────────────────────────────────────────────

const numberFr = new Intl.NumberFormat("fr-FR");

function countWords(markdown: string): number {
  const text = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** « 1 234 mots · 6 min », ou null pour une note vide. À mémoïser sur le corps. */
export function formatWordStats(markdown: string): string | null {
  const words = countWords(markdown);
  if (words === 0) return null;
  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return `${numberFr.format(words)} ${words > 1 ? "mots" : "mot"} · ${minutes} min`;
}

// ── Boutons de la barre méta ─────────────────────────────────────────────────

export function OutlineMetaButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip content="Plan de la note (Ctrl+Alt+↑/↓ pour sauter de titre en titre)">
      <Button
        variant="ghost"
        size="icon"
        onPress={onToggle}
        className="sn-hit h-7 w-7 min-w-7"
        style={{ color: open ? "var(--accent)" : "var(--text-muted)" }}
        aria-label="Plan"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-outline-trigger
      >
        <ListDashes size={14} weight={open ? "bold" : "regular"} />
      </Button>
    </Tooltip>
  );
}

export function ReadingWidthButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <Tooltip content={full ? "Largeur de lecture" : "Pleine largeur"}>
      <Button
        variant="ghost"
        size="icon"
        onPress={onToggle}
        className="sn-hit h-8 w-8 min-w-8"
        style={{ color: full ? "var(--accent)" : "var(--text-muted)" }}
        aria-label="Pleine largeur"
        aria-pressed={full}
      >
        {full ? <ArrowsInLineHorizontal size={15} /> : <ArrowsOutLineHorizontal size={15} />}
      </Button>
    </Tooltip>
  );
}

// ── Barre collante : titre de la section courante ────────────────────────────

export function OutlineStickyBar({
  current,
  available,
  open,
  onToggle,
  trailing,
}: {
  current: OutlineHeading | null;
  /** La note a un plan : en haut de note, la barre se réduit à un bouton « Plan », sans bandeau. */
  available: boolean;
  open: boolean;
  onToggle: () => void;
  /** Boutons calés à droite de la barre, sur la même ligne que « Plan ». */
  trailing?: ReactNode;
}) {
  if (!current && !available && !trailing) return null;
  return (
    // Sur téléphone la barre de défilement flotte : le filet va jusqu'au bord.
    <div className="sn-no-print pointer-events-none absolute left-0 right-0 top-0 z-[var(--z-raised)] md:right-3">
      <div
        className="sn-note-gutter flex h-9 items-center md:h-8"
        style={
          current
            ? {
                // Opaque : un grand titre qui passe dessous laissait une traînée floue.
                backgroundColor: "var(--surface-0)",
                borderBottom: "1px solid var(--border-subtle)",
              }
            : undefined
        }
      >
        {(current || available) && <Button
          variant="ghost"
          size="sm"
          onPress={onToggle}
          className="sn-hit pointer-events-auto -ml-2 h-8 min-w-0 max-w-full gap-1.5 px-2 text-xs"
          style={{ color: "var(--text-secondary)" }}
          aria-label={current ? `Plan de la note, section courante : ${current.text}` : "Ouvrir le plan de la note"}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-outline-trigger
        >
          <ListDashes size={13} className="shrink-0" />
          <span className="truncate font-medium">{current ? current.text : "Plan"}</span>
          <CaretDown size={10} className="shrink-0" />
        </Button>}
        {trailing && <div className="pointer-events-auto -mr-2 ml-auto flex shrink-0 items-center gap-0.5">{trailing}</div>}
      </div>
      {/* Fondu sous la barre : la ligne qui passe dessous s'estompe au lieu d'être tranchée net. */}
      {current && <div aria-hidden className="h-4" style={{ background: "linear-gradient(var(--surface-0) 40%, transparent)" }} />}
    </div>
  );
}

// ── Liste des titres ─────────────────────────────────────────────────────────

function CopyLinkButton({ anchor, label }: { anchor: string; label: string }) {
  const feedback = useActionFeedback();
  return (
    <Tooltip content={feedback.state === "error" ? (feedback.error ?? "Copie impossible") : "Copier le lien vers ce titre"}>
      <Button
        variant="ghost"
        size="icon"
        onPress={() => void feedback.run(() => navigator.clipboard.writeText(headingUrl(anchor)))}
        className="sn-hit h-8 w-8 min-w-8 shrink-0"
        style={{ color: "var(--text-muted)" }}
        aria-label={`Copier le lien vers « ${label} »`}
      >
        <FeedbackIcon state={feedback.state} error={feedback.error} size={14} idle={<LinkSimple size={14} />} />
      </Button>
    </Tooltip>
  );
}

function OutlineList({
  headings,
  currentId,
  onJump,
}: {
  headings: OutlineHeading[];
  currentId: string | null;
  onJump: (id: string) => void;
}) {
  if (headings.length === 0) {
    return (
      <p className="px-3 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
        Aucun titre dans cette note. Tapez « # » en début de ligne pour en créer un.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {headings.map((h) => {
        const current = h.id === currentId;
        return (
          <li key={h.id} className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onJump(h.id)}
              aria-current={current ? "location" : undefined}
              className="sn-hit h-9 min-w-0 flex-1 justify-start text-left text-sm md:h-8"
              style={{
                paddingLeft: 8 + (h.level - 1) * 14,
                paddingRight: 8,
                color: current ? "var(--accent)" : h.level === 3 ? "var(--text-secondary)" : "var(--text-primary)",
                backgroundColor: current ? "var(--accent-subtle)" : undefined,
                fontWeight: h.level === 1 || current ? 600 : 400,
              }}
            >
              <span className="min-w-0 truncate">{h.text}</span>
              {h.tags.slice(0, 2).map((t) => {
                const kind = tagKind(t);
                return (
                  <span
                    key={t}
                    className="shrink-0 rounded px-1 text-[10px] font-semibold leading-4"
                    style={{
                      backgroundColor: kind ? `var(--sn-tag-${kind}-bg)` : "var(--surface-2)",
                      color: kind ? `var(--sn-tag-${kind}-fg)` : "var(--text-secondary)",
                    }}
                  >
                    #{t}
                  </span>
                );
              })}
              {h.tags.length > 2 && (
                <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  +{h.tags.length - 2}
                </span>
              )}
            </Button>
            <CopyLinkButton anchor={h.anchor} label={h.text} />
          </li>
        );
      })}
    </ul>
  );
}

function OutlinePanel({
  headings,
  currentId,
  onJump,
  onClose,
  belowBar,
}: {
  headings: OutlineHeading[];
  currentId: string | null;
  onJump: (id: string) => void;
  onClose: () => void;
  belowBar: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = panel?.querySelector<HTMLElement>("[aria-current='location']") ?? panel?.querySelector<HTMLElement>("button");
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-outline-panel], [data-outline-trigger]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) opener?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Plan de la note"
      data-outline-panel
      // Sous le libellé « ☰ section » de la barre collante, dans la colonne de texte : à droite, il couvrait les Marges IA.
      className={`sn-no-print sn-overlay-in absolute left-[max(0.5rem,calc(var(--sn-note-gutter,1rem)_-_0.5rem))] z-[var(--z-dropdown)] max-h-[min(calc(100%_-_3rem),28rem)] w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto rounded-[var(--radius-lg)] p-1.5 ${belowBar ? "top-9 md:top-8" : "top-2"}`}
      style={{
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <OutlineList headings={headings} currentId={currentId} onJump={onJump} />
    </div>
  );
}

/** Le plan : popover ancré à la zone de texte sur desktop, bottom-sheet sur mobile. */
export function OutlineSurface({
  open,
  onClose,
  isMobile,
  headings,
  currentId,
  colRef,
  scrollRef,
  belowBar,
}: {
  open: boolean;
  onClose: () => void;
  isMobile: boolean;
  headings: OutlineHeading[];
  currentId: string | null;
  colRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  belowBar: boolean;
}) {
  const jump = useCallback(
    (id: string) => {
      onClose();
      if (scrollToBlock(colRef.current, scrollRef.current, id, true)) flashBlock(id);
    },
    [onClose, colRef, scrollRef],
  );

  if (isMobile) {
    return (
      <MobileSheet isOpen={open} onClose={onClose} title="Plan de la note" size="md">
        <OutlineList headings={headings} currentId={currentId} onJump={jump} />
      </MobileSheet>
    );
  }
  if (!open) return null;
  return <OutlinePanel headings={headings} currentId={currentId} onJump={jump} onClose={onClose} belowBar={belowBar} />;
}
