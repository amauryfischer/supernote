"use client";

import { useEffect, useState } from "react";

const TARGETS = "button, a[href], [role='button'], [role='tab'], [role='menuitem'], [data-kb-item], input[type=checkbox]";
const ALPHABET = "asdfghjklqwertyuiopzxcvbnm";

interface Hint {
  label: string;
  el: HTMLElement;
  top: number;
  left: number;
}

function collectHints(): Hint[] {
  const seen = new Set<HTMLElement>();
  const els = [...document.querySelectorAll<HTMLElement>(TARGETS)].filter((el) => {
    if (el.matches(":disabled, [aria-disabled=true]") || el.closest("[inert], [aria-hidden=true]")) return false;
    // Ligne `data-kb-item` contenant le bouton : une seule lettre pour la ligne.
    const owner = el.parentElement?.closest<HTMLElement>("[data-kb-item]");
    if (owner && owner !== el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    // Élément recouvert (panneau replié, overlay) : le point central doit lui appartenir.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(el.contains(hit) || hit.contains(el)) || seen.has(el)) return false;
    seen.add(el);
    return true;
  });
  const two = els.length > ALPHABET.length;
  return els.map((el, i) => {
    const r = el.getBoundingClientRect();
    const label = two
      ? `${ALPHABET[Math.floor(i / ALPHABET.length) % ALPHABET.length]}${ALPHABET[i % ALPHABET.length]}`
      : (ALPHABET[i] ?? "");
    return { label, el, top: Math.max(0, r.top), left: Math.max(0, r.left) };
  });
}

/** Lettres posées sur chaque bouton ou lien visible ; taper la lettre l'active (Échap pour sortir). */
export function LetterHints({ onClose }: { onClose: () => void }) {
  const [hints] = useState(collectHints);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      if (e.key === "Escape" || key.length !== 1) return onClose();
      const next = typed + key;
      const matches = hints.filter((h) => h.label.startsWith(next));
      const exact = matches.find((h) => h.label === next);
      if (exact) {
        onClose();
        exact.el.focus({ preventScroll: true });
        exact.el.click();
      } else if (matches.length) setTyped(next);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [hints, typed, onClose]);

  // aria-modal : le ShortcutProvider coupe ses touches simples tant que les lettres sont affichées.
  return (
    <div role="dialog" aria-modal="true" aria-label="Lettres d'accès clavier" className="pointer-events-none fixed inset-0 z-[200]">
      {hints
        .filter((h) => h.label.startsWith(typed))
        .map((h) => (
          <kbd
            key={h.label}
            className="absolute rounded px-1 font-mono text-[11px] font-semibold uppercase leading-4 shadow"
            style={{ top: h.top, left: h.left, backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            <span style={{ opacity: 0.5 }}>{typed}</span>
            {h.label.slice(typed.length)}
          </kbd>
        ))}
    </div>
  );
}
