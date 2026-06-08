"use client";

/**
 * PixelGrid — grille annuelle façon GitHub contributions pour une habitude.
 *
 * Colonnes = semaines (lundi→dimanche), dernière colonne = semaine en cours.
 * La PREMIÈRE colonne est la semaine de création de l'habitude (`gridWeeks`,
 * cap 53) : la grille pousse d'une colonne par lundi au lieu d'ouvrir sur un
 * an de cases vides démotivantes. Les jours d'avant la création sont rendus
 * invisibles — sauf s'ils portent un check-in (donnée importée : on l'affiche).
 *
 * L'intensité de chaque pixel reflète la progression vers la cible du jour
 * (`dayLevel`). Cliquer un pixel passé/présent cycle son compteur
 * (0 → 1 → … → cible → 0) — rattrapage d'hier ou correction d'un faux clic.
 *
 * Le conteneur scrolle horizontalement et s'ancre à droite (les semaines
 * récentes d'abord) — sur mobile on remonte le temps en glissant vers la
 * gauche, comme dans HabitPixel.
 */

import { memo, useEffect, useMemo, useRef } from "react";
import { buildGrid, dayLevel, gridWeeks, toDateKey } from "@/lib/habits/habitData";

const CELL = 11; // px — côté d'un pixel
const GAP = 3; // px — gouttière

interface PixelGridProps {
  checkins: Record<string, number>;
  target: number;
  color: string;
  /** Date de création de l'habitude — borne gauche de la grille. */
  createdAt: string;
  /** Pixel à faire « pop » (clé du jour fraîchement coché). */
  poppingKey?: string | null;
  onCycleDay: (dateKey: string) => void;
}

/** Couleur de fond d'un pixel selon son niveau d'intensité. */
function cellBackground(level: 0 | 1 | 2 | 3 | 4, color: string): string {
  switch (level) {
    case 0:
      return "var(--surface-2)";
    case 1:
      return `color-mix(in srgb, ${color} 32%, var(--surface-2))`;
    case 2:
      return `color-mix(in srgb, ${color} 62%, var(--surface-2))`;
    default:
      return color;
  }
}

export const PixelGrid = memo(function PixelGrid({
  checkins,
  target,
  color,
  createdAt,
  poppingKey,
  onCycleDay,
}: PixelGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayKey = toDateKey(new Date());
  const weeks = gridWeeks(createdAt, new Date());
  const createdKey = toDateKey(new Date(createdAt));

  // La grille ne dépend que du jour courant et de la largeur demandée — les
  // check-ins ne changent que la couleur des cellules, pas leur position.
  const { columns, monthLabels } = useMemo(() => buildGrid(new Date(), weeks), [weeks, todayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ancrage à droite : les semaines récentes sont visibles d'emblée.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const colWidth = CELL + GAP;

  return (
    // `justify-end` : la grille et ses étiquettes se rangent côté présent
    // (droite) tant que l'habitude est jeune ; à 53 semaines le bloc occupe
    // toute la carte et le conteneur scrolle.
    <div className="flex items-stretch justify-end gap-2">
      {/* Étiquettes de jours — hors du conteneur scrollable pour rester
          visibles pendant le défilement. Lun/Mer/Ven suffisent. */}
      <div
        className="grid shrink-0 text-[9px] leading-none"
        aria-hidden="true"
        style={{
          gridTemplateRows: `repeat(7, ${CELL}px)`,
          rowGap: GAP,
          marginTop: 14, // aligné sous la rangée des mois
          color: "var(--text-muted)",
        }}
      >
        {["Lun", "", "Mer", "", "Ven", "", ""].map((label, i) => (
          <span key={i} className="flex items-center">
            {label}
          </span>
        ))}
      </div>

      {/* Pas de `flex-1` : le conteneur prend la largeur de la grille (jeune
          habitude = bloc compact à droite) et shrink/scrolle quand l'année
          dépasse la carte (`min-w-0` autorise le shrink sous le contenu). */}
      <div ref={scrollRef} className="min-w-0 max-w-full overflow-x-auto px-[3px] pb-1">
        <div style={{ width: weeks * colWidth - GAP }}>
          {/* Rangée des mois */}
          <div
            className="relative h-[14px] text-[9px] leading-none"
            aria-hidden="true"
            style={{ color: "var(--text-muted)" }}
          >
            {monthLabels.map((m) => {
              // Un label posé sur les dernières colonnes déborderait à
              // droite — ce qui élargit le scrollWidth et fait apparaître
              // une scrollbar fantôme. On l'ancre alors à droite : le
              // débord part vers la gauche, qui ne compte pas dans le
              // scroll en LTR.
              const overflowsRight = m.week * colWidth + 28 > weeks * colWidth - GAP;
              return (
                <span
                  key={`${m.week}-${m.label}`}
                  className="absolute whitespace-nowrap"
                  style={overflowsRight ? { right: 0 } : { left: m.week * colWidth }}
                >
                  {m.label}
                </span>
              );
            })}
          </div>

          <div className="flex" style={{ gap: GAP }}>
            {columns.map((col, w) => (
              <div key={col[0]!.key} className="flex flex-col" style={{ gap: GAP }}>
                {col.map((cell) => {
                  const count = checkins[cell.key] ?? 0;
                  // Jour à venir, ou antérieur à la création sans check-in
                  // (un check importé d'avant la création reste affiché) —
                  // occupe la place pour garder la grille rectangulaire
                  // mais reste muet.
                  if (cell.future || (cell.key < createdKey && count === 0)) {
                    return (
                      <span
                        key={cell.key}
                        aria-hidden="true"
                        style={{ width: CELL, height: CELL }}
                      />
                    );
                  }
                  const level = dayLevel(count, target);
                  const isToday = cell.key === todayKey;
                  const dateLabel = new Date(`${cell.key}T00:00:00`).toLocaleDateString("fr-FR", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  });
                  return (
                    // Pixel natif assumé (exception CLAUDE.md) : ~370 cellules
                    // par habitude — un <Button> HeroUI par pixel exploserait le
                    // coût de rendu, et le focus/hit-target est sur-mesure.
                    <button
                      key={cell.key}
                      type="button"
                      title={`${dateLabel} · ${count}/${target}`}
                      aria-label={`${dateLabel} : ${count} sur ${target}`}
                      onClick={() => onCycleDay(cell.key)}
                      className={poppingKey === cell.key ? "sn-pixel-pop" : undefined}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2.5,
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        backgroundColor: cellBackground(level, color),
                        boxShadow:
                          level === 4
                            ? `0 0 5px color-mix(in srgb, ${color} 65%, transparent)`
                            : undefined,
                        outline: isToday
                          ? `1.5px solid color-mix(in srgb, ${color} 75%, var(--text-muted))`
                          : undefined,
                        outlineOffset: 1,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
