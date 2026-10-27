"use client";

/**
 * MailSearchBar — champ de recherche du mail : filtrage LOCAL instantané à la
 * frappe, recherche Gmail complète à la validation.
 *
 * Trois affordances qui manquaient :
 *  - les puces : chaque opérateur saisi (`from:`, `is:unread`, …) devient une
 *    puce refermable — on voit ce qui filtre réellement et on l'enlève d'un clic ;
 *  - les suggestions d'opérateurs, pour ne pas avoir à connaître la syntaxe ;
 *  - l'historique des recherches validées.
 *
 * Le composant ne cherche pas lui-même : il remonte la saisie (`onChange`, pour
 * le filtrage local débattu côté page) et la validation (`onSubmit`).
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { Tooltip, Button, Input } from "@supernote/ui";
import { MagnifyingGlass, X, ClockCounterClockwise, Lightning } from "@phosphor-icons/react";
import {
  queryChips,
  removeToken,
  loadSearchHistory,
  clearSearchHistory,
  OPERATOR_SUGGESTIONS,
} from "@/lib/mail-search";

export function MailSearchBar({
  value,
  onChange,
  onSubmit,
  onClear,
  inputRef,
  /** Nombre de résultats locaux affichés (null = pas en mode recherche). */
  localCount,
  /** true quand les résultats affichés viennent de Gmail (recherche validée). */
  remote,
  /** Montée dans la barre du haut : filtres et aides passent en menu déroulant au focus. */
  inTopBar = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onClear: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  localCount: number | null;
  remote: boolean;
  inTopBar?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focused) setHistory(loadSearchHistory());
  }, [focused]);

  // Clic hors du bloc → referme le panneau (historique / suggestions).
  useEffect(() => {
    if (!focused) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  const chips = queryChips(value);
  const showPanel = focused && value.trim().length === 0 && history.length > 0;
  const showHints = focused && value.trim().length > 0;

  return (
    <div ref={wrapRef} className={inTopBar ? "relative w-full" : "relative flex flex-col gap-1.5 px-2.5 pb-1.5 pt-2.5"}>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
        <MagnifyingGlass
          size={14}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        />
        <Input
          ref={inputRef}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Rechercher dans les mails"
          className={`h-8 w-full pl-8 text-[13px] ${value ? "pr-24" : "pr-8"}`}
          aria-label="Rechercher dans les emails"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setFocused(false);
              onSubmit(value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              if (value) onClear();
              setFocused(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {/* Une seule recherche : filtre local à la frappe, ↵ élargit à tout Gmail. */}
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[3px] border px-1 font-mono text-[10px] leading-4"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {value ? "↵ tout Gmail" : "/"}
        </kbd>
        </div>
        {value && (
          <Tooltip content="Effacer la recherche">
            <Button
              size="icon"
              variant="ghost"
              onPress={onClear}
              aria-label="Effacer la recherche"
            >
              <X size={16} />
            </Button>
          </Tooltip>
        )}
      </div>

      {(!inTopBar || (focused && (chips.length > 0 || showHints))) && (
        <div
          className={
            inTopBar
              ? "absolute left-0 right-0 top-full z-30 mt-1 flex flex-col gap-1.5 rounded-lg border p-2 shadow-lg"
              : "contents"
          }
          style={inTopBar ? { background: "var(--surface-0)", borderColor: "var(--border-subtle)" } : undefined}
        >
      {/* Puces des filtres actifs. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {chips.map((c, i) => (
            <span
              key={`${c.token}-${i}`}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              style={
                c.kind === "texte"
                  ? { background: "var(--surface-2)", color: "var(--text-secondary)" }
                  : { background: "var(--accent-subtle)", color: "var(--accent)" }
              }
            >
              {c.kind !== "texte" && <span className="font-semibold">{c.kind}</span>}
              <span className="max-w-[12rem] truncate">{c.value}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Retirer le filtre ${c.kind} ${c.value}`}
                className="-my-1.5 inline-flex h-7 min-h-7 w-7 min-w-7 items-center justify-center p-0"
                onPress={() => onChange(removeToken(value, c.token))}
              >
                <X size={10} />
              </Button>
            </span>
          ))}
          {localCount !== null && (
            <span
              className="ml-auto inline-flex items-center gap-1 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {remote ? (
                <>Résultats Gmail</>
              ) : (
                <>
                  <Lightning size={11} weight="fill" aria-hidden />
                  {localCount} local{localCount > 1 ? "aux" : ""} — ↵ pour tout Gmail
                </>
              )}
            </span>
          )}
        </div>
      )}

      {/* Aide à la syntaxe pendant la frappe. */}
      {showHints && (
        <div className="flex flex-wrap gap-1">
          {OPERATOR_SUGGESTIONS.filter((o) => !value.includes(o.insert)).slice(0, 5).map((o) => (
            <Button
              key={o.insert}
              size="sm"
              variant="ghost"
              className="h-6 min-h-6 rounded-full px-2 text-[11px]"
              onPress={() => onChange(`${value.trimEnd()} ${o.insert}`.trim())}
            >
              <span className="font-mono">{o.label}</span>
              <span style={{ color: "var(--text-muted)" }}>{o.hint}</span>
            </Button>
          ))}
        </div>
      )}

        </div>
      )}

      {/* Historique (champ vide + focus). */}
      {showPanel && (
        <div
          className={`absolute z-30 rounded-lg border p-1 shadow-lg ${inTopBar ? "left-0 right-0 top-full mt-1" : "left-3 right-3 top-[3.25rem]"}`}
          style={{ background: "var(--surface-0)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between px-2 py-1">
            <span
              className="sn-eyebrow sn-eyebrow--compact inline-flex items-center gap-1"
            >
              <ClockCounterClockwise size={12} aria-hidden /> Recherches récentes
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 min-h-6 px-1.5 text-[11px]"
              onPress={() => {
                clearSearchHistory();
                setHistory([]);
              }}
            >
              Effacer
            </Button>
          </div>
          {history.map((h) => (
            <Button
              key={h}
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start truncate px-2 text-sm"
              onPress={() => {
                setFocused(false);
                onChange(h);
                onSubmit(h);
              }}
            >
              {h}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
