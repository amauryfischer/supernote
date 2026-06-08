"use client";

/**
 * PlantSprite — rendu SVG procédural d'une plante. La silhouette dépend du
 * stade (tige + feuillage) et de l'espèce (variété de forme), la couleur de
 * la vigueur, la fleur de la floraison (backlinks). Animations CSS douces
 * (balancement, ouverture de fleur) — voir garden.css.
 */

import type { Plant, PlantStage } from "@/lib/garden/plantMath";

const STAGE_HEIGHT: Record<PlantStage, number> = {
  thriving: 1,
  growing: 0.78,
  dormant: 0.55,
  withering: 0.4,
};

const STAGE_STEM: Record<PlantStage, string> = {
  thriving: "#3f8f4f",
  growing: "#52a35f",
  dormant: "#8a925f",
  withering: "#9c8a63",
};

const STAGE_LEAF: Record<PlantStage, string> = {
  thriving: "#5cc46a",
  growing: "#74c47f",
  dormant: "#9aa56a",
  withering: "#b0a071",
};

const FLOWER_COLORS = ["#ec8fb5", "#f0b450", "#a78bfa", "#6fb6e8"];

export function PlantSprite({ plant, size = 64 }: { plant: Plant; size?: number }): React.JSX.Element {
  const h = STAGE_HEIGHT[plant.stage];
  const stem = STAGE_STEM[plant.stage];
  const leaf = STAGE_LEAF[plant.stage];
  const flower = FLOWER_COLORS[plant.species] ?? FLOWER_COLORS[0]!;
  const wilt = plant.stage === "withering";

  // Géométrie en viewBox 100x120 : sol en bas, tige montante.
  const groundY = 110;
  const topY = groundY - 78 * h;
  const midY = (groundY + topY) / 2;
  // Variété d'espèce : courbure de la tige.
  const bend = [0, -8, 8, -4][plant.species] ?? 0;
  const ctrlX = 50 + bend;

  return (
    <svg
      width={size}
      height={size * 1.2}
      viewBox="0 0 100 120"
      className={`sn-plant sn-plant--${plant.stage}`}
      role="img"
      aria-label={`${plant.title} — ${plant.stage}`}
    >
      {/* Ombre au sol */}
      <ellipse cx="50" cy={groundY + 4} rx={14 * h + 6} ry="4" fill="rgba(0,0,0,0.10)" />

      {/* Tige (balancement appliqué via CSS sur le groupe) */}
      <g className="sn-plant__sway" style={{ transformOrigin: "50px 110px" }}>
        <path
          d={`M50 ${groundY} Q ${ctrlX} ${midY} ${50 + bend * 0.5} ${topY}`}
          stroke={stem}
          strokeWidth={wilt ? 3 : 4}
          fill="none"
          strokeLinecap="round"
        />
        {/* Feuilles (paires selon hauteur) */}
        <path
          d={`M${50 + bend * 0.3} ${midY} q -22 -10 -30 4 q 16 8 30 -4 z`}
          fill={leaf}
          opacity={wilt ? 0.65 : 1}
        />
        <path
          d={`M${50 + bend * 0.45} ${midY - 22 * h} q 22 -10 30 4 q -16 8 -30 -4 z`}
          fill={leaf}
          opacity={wilt ? 0.55 : 1}
        />

        {/* Fleur (floraison = au moins un backlink) */}
        {plant.flowering && (
          <g
            className="sn-plant__flower"
            style={{ transformOrigin: `${50 + bend * 0.5}px ${topY}px` }}
          >
            {[0, 72, 144, 216, 288].map((deg) => (
              <ellipse
                key={deg}
                cx={50 + bend * 0.5}
                cy={topY - 7}
                rx="5"
                ry="9"
                fill={flower}
                transform={`rotate(${deg} ${50 + bend * 0.5} ${topY})`}
              />
            ))}
            <circle cx={50 + bend * 0.5} cy={topY} r="4.5" fill="#fef3c7" />
          </g>
        )}
        {/* Bourgeon quand pas de fleur mais vivace */}
        {!plant.flowering && plant.stage !== "withering" && (
          <circle cx={50 + bend * 0.5} cy={topY} r="4" fill={leaf} />
        )}
      </g>
    </svg>
  );
}
