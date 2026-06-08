"use client";

/**
 * GardenView — vue plein écran du Jardin digital. Les notes deviennent des
 * plantes plantées en rangées : vigoureuses au premier plan, fanées au fond.
 * Clic sur une plante → ouvre la note.
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Spinner } from "@heroui/react";
import { Plant as PlantIcon, Flower, Drop } from "@phosphor-icons/react";
import { useGardenData } from "./useGardenData";
import { PlantSprite } from "./PlantSprite";
import { gardenStats } from "@/lib/garden/plantMath";
import "./garden.css";

function StatChip({
  icon,
  value,
  label,
}: { icon: React.ReactNode; value: number; label: string }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
    >
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

export function GardenView(): React.JSX.Element {
  const t = useTranslations("garden");
  const router = useRouter();
  const { plants, isLoading } = useGardenData();
  const stats = useMemo(() => gardenStats(plants), [plants]);

  // Plantation en rangées : on garde l'ordre vigueur croissante (fond → avant).
  // Découpe en rangées de taille fixe pour donner de la profondeur.
  const rows = useMemo(() => {
    const PER_ROW = 8;
    const out: typeof plants[] = [];
    for (let i = 0; i < plants.length; i += PER_ROW) {
      out.push(plants.slice(i, i + PER_ROW));
    }
    return out;
  }, [plants]);

  return (
    <div className="sn-garden-root flex h-full flex-col overflow-y-auto">
      {/* En-tête */}
      <div className="px-6 pt-6 pb-3 md:px-10">
        <h1 className="text-[26px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("title")}
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--text-muted)" }}>
          {t("subtitle")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatChip icon={<PlantIcon size={15} />} value={stats.total} label={t("stats.total")} />
          <StatChip icon={<Drop size={15} weight="fill" />} value={stats.thriving} label={t("stats.thriving")} />
          <StatChip icon={<Flower size={15} weight="fill" />} value={stats.flowering} label={t("stats.flowering")} />
        </div>
      </div>

      {/* Jardin */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner aria-label={t("loading")} />
        </div>
      ) : plants.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
          <PlantIcon size={40} />
          <p className="text-sm">{t("empty")}</p>
        </div>
      ) : (
        <div className="flex-1 px-4 pb-10 md:px-10">
          {rows.map((row, ri) => (
            <div
              key={ri}
              className="sn-garden-bed -mx-2 mb-1 flex flex-wrap items-end justify-center gap-1 px-2 pt-4"
              style={{ opacity: 0.7 + (0.3 * (ri + 1)) / rows.length }}
            >
              {row.map((plant, pi) => (
                <button
                  key={plant.id}
                  type="button"
                  className="sn-plant-tile"
                  onClick={() => router.push(`/notes/${plant.id}`)}
                  title={`${plant.title} · ${t(`status.${plant.stage}`)}${plant.backlinks > 0 ? ` · ${plant.backlinks} ${t("links")}` : ""}`}
                  // Décale le balancement par plante (variété, sans Math.random).
                  // La var CSS est lue par .sn-plant__sway dans garden.css.
                  style={{ ["--sn-sway-delay" as string]: `${(pi % 5) * 0.4}s` }}
                >
                  <PlantSprite plant={plant} size={56} />
                  <span className="sn-plant-tile__label">{plant.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
