"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { SNAPSHOTS } from "./fixtures";
import { formatShortDate, CATEGORY_COLORS, CATEGORY_LABELS } from "./utils";

const chartData = SNAPSHOTS.map((s) => ({
  label: formatShortDate(s.takenAt),
  total: s.totalNetWorth,
  ...s.breakdown,
}));

const STACKED_KEYS = ["cash", "stock", "crypto", "real_estate", "bond", "other"] as const;

export function NetWorthChart() {
  const [stacked, setStacked] = useState(false);

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Evolution patrimoniale
        </h3>
        <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--border-subtle)" }}>
          {(["total", "categorie"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setStacked(mode === "categorie")}
              className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
              style={
                (mode === "categorie") === stacked
                  ? { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }
                  : { color: "var(--text-secondary)" }
              }
            >
              {mode === "total" ? "Total" : "Par catégorie"}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        {stacked ? (
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value, name) => [
                typeof value === "number"
                  ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value)
                  : String(value),
                CATEGORY_LABELS[String(name)] ?? String(name),
              ]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend formatter={(v) => CATEGORY_LABELS[v] ?? v} />
            {STACKED_KEYS.map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={CATEGORY_COLORS[key]}
                fill={CATEGORY_COLORS[key]}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value) => [
                typeof value === "number"
                  ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value)
                  : String(value),
                "Patrimoine net",
              ]}
              contentStyle={{ fontSize: 12 }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={{ fill: "var(--accent)", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
