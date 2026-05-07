"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { Snapshot } from "./fixtures";
import { CATEGORY_COLORS, CATEGORY_LABELS, formatCurrency } from "./utils";

interface CategoryDonutProps {
  snapshot: Snapshot | null;
}

export function CategoryDonut({ snapshot }: CategoryDonutProps) {
  if (!snapshot) {
    return (
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
      >
        <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Répartition par catégorie
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Pas encore de snapshot pour afficher la répartition.
        </p>
      </div>
    );
  }

  const total = Object.values(snapshot.breakdown).reduce((s, v) => s + v, 0);
  const pieData = Object.entries(snapshot.breakdown).map(([key, value]) => ({
    name: key,
    label: CATEGORY_LABELS[key] ?? key,
    value,
    color: CATEGORY_COLORS[key] ?? "#94A3B8",
    percent: total > 0 ? (value / total) * 100 : 0,
  }));

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Répartition par catégorie
      </h3>
      <div className="flex items-center gap-4">
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, props) => [
                typeof value === "number" ? formatCurrency(value) : String(value),
                (props.payload as { label?: string } | undefined)?.label ?? String(_name),
              ]}
              contentStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-1 flex-col gap-2">
          {pieData.map((d) => (
            <div key={d.name} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {d.label}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(d.value)}
                </span>
                <span
                  className="w-10 text-right text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {d.percent.toFixed(1).replace(".", ",")} %
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
