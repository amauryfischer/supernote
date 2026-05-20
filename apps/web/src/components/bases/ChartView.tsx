"use client";

/**
 * ChartView — rendu d'une vue de type graphique via recharts.
 *
 * Lit `view.chartConfig` pour savoir quoi tracer ; si absent ou incomplet,
 * affiche une banderole de configuration. La config est éditée via un petit
 * panneau intégré qui mutate `view.chartConfig` directement.
 */

import { useMemo } from "react";
import { Button } from "@heroui/react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell as RechartsCell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { EntityType, Field } from "@supernote/core";
import type { ChartAgg, ChartConfig, ChartKind, View } from "@supernote/ipc";
import { NativeSelect } from "@/components/settings/NativeSelect";
import { useEntitiesForView, useViewMutations } from "./hooks";

interface ChartViewProps {
  base: EntityType;
  view: View;
}

const DEFAULT_CFG: ChartConfig = {
  kind: "bar",
  xField: undefined,
  yField: undefined,
  yAgg: "sum",
  seriesField: undefined,
  stacked: false,
};

const PALETTE = [
  "#6366F1",
  "#EC4899",
  "#10B981",
  "#F59E0B",
  "#3B82F6",
  "#A855F7",
  "#EF4444",
  "#14B8A6",
];

export function ChartView({ base, view }: ChartViewProps) {
  const cfg = useMemo<ChartConfig>(
    () => ({ ...DEFAULT_CFG, ...(view.chartConfig ?? {}) }),
    [view.chartConfig],
  );
  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const { update: updateView } = useViewMutations();
  const items = data?.items ?? [];

  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of base.fields) m.set(f.id, f);
    return m;
  }, [base.fields]);

  const numericFields = useMemo(
    () =>
      base.fields.filter((f) =>
        ["number", "currency", "percent", "rating", "progress", "duration", "autoNumber"].includes(
          f.kind,
        ),
      ),
    [base.fields],
  );

  const groupableFields = useMemo(
    () =>
      base.fields.filter((f) =>
        ["text", "select", "multiselect", "status", "date", "datetime", "bool", "relation"].includes(
          f.kind,
        ),
      ),
    [base.fields],
  );

  const updateCfg = (patch: Partial<ChartConfig>) => {
    updateView.mutate({ id: view.id, chartConfig: { ...cfg, ...patch } });
  };

  const series = useMemo(() => buildSeries(items, cfg, fieldById), [items, cfg, fieldById]);

  return (
    <div className="flex h-full flex-col">
      {/* Panneau config */}
      <div
        className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-xs"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <PickerSelect
          label="Type"
          value={cfg.kind}
          options={[
            { value: "bar", label: "Barres" },
            { value: "line", label: "Ligne" },
            { value: "area", label: "Aire" },
            { value: "pie", label: "Camembert" },
          ]}
          onChange={(v) => updateCfg({ kind: v as ChartKind })}
        />
        <PickerSelect
          label="X"
          value={cfg.xField ?? ""}
          options={[
            { value: "", label: "—" },
            ...groupableFields.map((f) => ({ value: f.id, label: f.label || f.name })),
          ]}
          onChange={(v) => updateCfg({ xField: v || undefined })}
        />
        <PickerSelect
          label="Y"
          value={cfg.yField ?? ""}
          options={[
            { value: "", label: "Compter" },
            ...numericFields.map((f) => ({ value: f.id, label: f.label || f.name })),
          ]}
          onChange={(v) => updateCfg({ yField: v || undefined })}
        />
        <PickerSelect
          label="Agrégat"
          value={cfg.yAgg}
          options={[
            { value: "sum", label: "Somme" },
            { value: "avg", label: "Moyenne" },
            { value: "count", label: "Compter" },
            { value: "min", label: "Min" },
            { value: "max", label: "Max" },
          ]}
          onChange={(v) => updateCfg({ yAgg: v as ChartAgg })}
        />
        <Button
          size="sm"
          variant={cfg.stacked ? "primary" : "ghost"}
          onPress={() => updateCfg({ stacked: !cfg.stacked })}
        >
          Empilé
        </Button>
      </div>

      {/* Rendu */}
      <div className="flex-1 p-3">
        {isLoading ? (
          <Placeholder label="Chargement…" />
        ) : items.length === 0 ? (
          <Placeholder label="Aucune entrée pour cette vue." />
        ) : !cfg.xField ? (
          <Placeholder label="Choisissez un champ X pour démarrer." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart(cfg, series)}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── Construction des séries ─────────────────────────────────────────────────

interface ChartPoint {
  name: string;
  value: number;
  [k: string]: string | number;
}

function buildSeries(
  items: Array<{ fields: Record<string, unknown> }>,
  cfg: ChartConfig,
  fieldById: Map<string, Field>,
): ChartPoint[] {
  if (!cfg.xField) return [];
  const xField = fieldById.get(cfg.xField);
  if (!xField) return [];
  const yKind = cfg.yField ?? "__count__";

  // group → bucket numérique
  const groups = new Map<string, number[]>();
  for (const it of items) {
    const xRaw = it.fields[cfg.xField];
    const xKey = formatX(xRaw);
    const yRaw = cfg.yField ? it.fields[cfg.yField] : 1;
    const num = coerceNumber(yRaw);
    if (num === null) continue;
    const bucket = groups.get(xKey);
    if (bucket) bucket.push(num);
    else groups.set(xKey, [num]);
  }

  const points: ChartPoint[] = [];
  for (const [name, nums] of groups) {
    let value = 0;
    if (yKind === "__count__" || cfg.yAgg === "count") value = nums.length;
    else if (cfg.yAgg === "sum") value = nums.reduce((a, b) => a + b, 0);
    else if (cfg.yAgg === "avg")
      value = nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
    else if (cfg.yAgg === "min") value = Math.min(...nums);
    else if (cfg.yAgg === "max") value = Math.max(...nums);
    points.push({ name, value });
  }
  return points;
}

function formatX(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vide)";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return JSON.stringify(v);
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

// ── Renderers par kind ──────────────────────────────────────────────────────

function renderChart(cfg: ChartConfig, data: ChartPoint[]): React.ReactElement {
  if (cfg.kind === "line") {
    return (
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="value" stroke={PALETTE[0]} />
      </LineChart>
    );
  }
  if (cfg.kind === "area") {
    return (
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Area type="monotone" dataKey="value" fill={PALETTE[0]} stroke={PALETTE[0]} />
      </AreaChart>
    );
  }
  if (cfg.kind === "pie") {
    return (
      <PieChart>
        <Tooltip />
        <Legend />
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={120} label>
          {data.map((_, i) => (
            <RechartsCell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    );
  }
  // default = bar
  return (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
      <XAxis dataKey="name" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Bar dataKey="value" fill={PALETTE[0]} stackId={cfg.stacked ? "a" : undefined} />
    </BarChart>
  );
}

// ── Pickers UI ──────────────────────────────────────────────────────────────

function PickerSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      <NativeSelect value={value} onChange={onChange} options={options} />
    </label>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      className="flex h-full items-center justify-center text-xs"
      style={{ color: "var(--text-muted)" }}
    >
      {label}
    </div>
  );
}
