"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { CaretDown, CaretUp, MagnifyingGlass, X } from "@phosphor-icons/react";
import { Button, Input, Tooltip, cn } from "@supernote/ui";

export interface FindState {
  ranges: Range[];
  current: number;
}

export const NO_FIND: FindState = { ranges: [], current: -1 };

const MAX_MATCHES = 2000;
const MUTATION_THROTTLE_MS = 250;
const HIGHLIGHT_ALL = "sn-find";
const HIGHLIGHT_CURRENT = "sn-find-current";

// Dernière requête : rouvrir la barre la retrouve présélectionnée, comme une recherche navigateur.
let lastQuery = "";

// Texte replié (minuscules, sans accents) + index d'origine de chaque caractère replié.
function fold(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const f = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
  }
  return { text, map };
}

// shortcut: un résultat ne traverse pas deux nœuds texte (mot moitié en gras, lien) ; à améliorer en concaténant le texte par bloc.
function findRanges(root: Element, query: string): Range[] {
  const q = fold(query.trim()).text;
  if (!q) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < MAX_MATCHES; node = walker.nextNode()) {
    const raw = node.nodeValue ?? "";
    if (!raw.trim()) continue;
    const { text, map } = fold(raw);
    for (let at = text.indexOf(q); at !== -1 && ranges.length < MAX_MATCHES; at = text.indexOf(q, at + q.length)) {
      const range = document.createRange();
      range.setStart(node, map[at]!);
      range.setEnd(node, map[at + q.length - 1]! + 1);
      // Texte replié (display: none) : pas de rectangle, donc pas un résultat.
      if (range.getClientRects().length > 0) ranges.push(range);
    }
  }
  return ranges;
}

function editorRoot(c: HTMLElement): Element {
  return c.querySelector(".ProseMirror") ?? c;
}

function centerRange(c: HTMLElement, range: Range) {
  const r = range.getBoundingClientRect();
  const box = c.getBoundingClientRect();
  c.scrollTo({ top: c.scrollTop + r.top - box.top - c.clientHeight / 2 + r.height / 2 });
}

/** Mod+F n'est intercepté que si le focus est dans `rootRef` (la vue de note) ; sinon le navigateur cherche. */
export function useNoteFind(rootRef: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  // Incrémenté à chaque Mod+F : la barre déjà ouverte reprend le focus.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      const root = rootRef.current;
      if (!root || !root.contains(document.activeElement)) return;
      e.preventDefault();
      setOpen(true);
      setFocusTick((t) => t + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rootRef]);
  const show = useCallback(() => {
    setOpen(true);
    setFocusTick((t) => t + 1);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, focusTick, show, hide };
}

interface NoteFindProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  focusTick: number;
  onClose: () => void;
  /** Plages trouvées et résultat courant, pour la minimap. */
  onChange: (state: FindState) => void;
  className?: string;
}

export function NoteFind({ scrollRef, focusTick, onClose, onChange, className }: NoteFindProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  const resRef = useRef<FindState>(NO_FIND);
  const queryRef = useRef(lastQuery);
  const [query, setQuery] = useState(lastQuery);
  const [res, setRes] = useState<FindState>(NO_FIND);

  const commit = useCallback((next: FindState) => {
    resRef.current = next;
    setRes(next);
  }, []);

  const run = useCallback((q: string, mode: "reset" | "keep") => {
    const c = scrollRef.current;
    if (!c) return;
    const ranges = findRanges(editorRoot(c), q);
    let cur = -1;
    if (ranges.length > 0) {
      if (mode === "keep") {
        cur = Math.min(Math.max(resRef.current.current, 0), ranges.length - 1);
      } else {
        // Premier résultat à l'écran ou en dessous, pas forcément le premier du document.
        const top = c.getBoundingClientRect().top;
        cur = Math.max(0, ranges.findIndex((r) => r.getBoundingClientRect().top >= top));
      }
    }
    commit({ ranges, current: cur });
    if (mode === "reset" && cur >= 0) centerRange(c, ranges[cur]!);
  }, [scrollRef, commit]);

  const go = useCallback((delta: number) => {
    const c = scrollRef.current;
    const { ranges, current } = resRef.current;
    if (!c || ranges.length === 0) return;
    const cur = (current + delta + ranges.length) % ranges.length;
    commit({ ranges, current: cur });
    centerRange(c, ranges[cur]!);
  }, [scrollRef, commit]);

  useEffect(() => {
    const active = document.activeElement;
    prevFocusRef.current = active && active !== document.body ? active : null;
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  useEffect(() => {
    lastQuery = query;
    queryRef.current = query;
    run(query, "reset");
  }, [query, run]);

  // Le contenu change (frappe, collab) : on recalcule sans bouger la vue. Throttle, comme NoteMinimap.
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    let timer = 0;
    const mo = new MutationObserver(() => {
      if (!timer) timer = window.setTimeout(() => { timer = 0; run(queryRef.current, "keep"); }, MUTATION_THROTTLE_MS);
    });
    mo.observe(c, { childList: true, characterData: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      mo.disconnect();
    };
  }, [scrollRef, run]);

  // CSS Custom Highlight API : surlignage sans toucher au DOM de ProseMirror.
  useEffect(() => {
    onChange(res);
    if (typeof CSS === "undefined" || !CSS.highlights) return;
    const all = new Highlight(...res.ranges);
    const current = new Highlight(...(res.ranges[res.current] ? [res.ranges[res.current]!] : []));
    current.priority = 1;
    CSS.highlights.set(HIGHLIGHT_ALL, all);
    CSS.highlights.set(HIGHLIGHT_CURRENT, current);
    return () => {
      CSS.highlights.delete(HIGHLIGHT_ALL);
      CSS.highlights.delete(HIGHLIGHT_CURRENT);
    };
  }, [res, onChange]);

  useEffect(() => () => onChange(NO_FIND), [onChange]);

  const close = (alwaysRefocus: boolean) => {
    onClose();
    const c = scrollRef.current;
    const prev = prevFocusRef.current;
    const inEditor = prev instanceof HTMLElement && prev.closest(".ProseMirror");
    const target = inEditor ? (prev as HTMLElement) : alwaysRefocus && c ? editorRoot(c) : null;
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const count = res.ranges.length;
  const label = !query.trim() ? "" : count === 0 ? "0/0" : `${res.current + 1}/${count}${count >= MAX_MATCHES ? "+" : ""}`;

  return (
    <div
      role="search"
      className={cn(
        "sn-no-print absolute z-20 flex max-w-[calc(100%-1rem)] items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border)] px-1.5 py-0.5 shadow-lg focus-within:border-[var(--accent)]",
        className,
      )}
      style={{ backgroundColor: "var(--surface-1)" }}
    >
      <MagnifyingGlass size={14} aria-hidden style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher…"
        aria-label="Rechercher dans la note"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-8 border-0 bg-transparent px-1.5 py-0 focus:ring-0"
        // L'anneau global :focus-visible (hors @layer) bat les utilitaires : le focus se lit sur la bordure de la barre.
        style={{ outline: "none" }}
        wrapperClassName="min-w-0 flex-1 md:w-48 md:flex-initial"
      />
      <span
        aria-live="polite"
        className="min-w-[3ch] shrink-0 px-1 text-center text-xs tabular-nums"
        style={{ color: query.trim() && count === 0 ? "var(--color-danger)" : "var(--text-muted)" }}
      >
        {label}
      </span>
      <Tooltip content="Précédent (Maj+Entrée)">
        <Button variant="ghost" size="icon" aria-label="Résultat précédent" className="sn-hit h-8 w-8 min-w-8 shrink-0" onPress={() => go(-1)}>
          <CaretUp size={14} />
        </Button>
      </Tooltip>
      <Tooltip content="Suivant (Entrée)">
        <Button variant="ghost" size="icon" aria-label="Résultat suivant" className="sn-hit h-8 w-8 min-w-8 shrink-0" onPress={() => go(1)}>
          <CaretDown size={14} />
        </Button>
      </Tooltip>
      <Tooltip content="Fermer (Échap)">
        <Button variant="ghost" size="icon" aria-label="Fermer la recherche" className="sn-hit h-8 w-8 min-w-8 shrink-0" onPress={() => close(false)}>
          <X size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}
