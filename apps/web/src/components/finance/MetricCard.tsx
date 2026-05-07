"use client";

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  delta?: { value: string; positive: boolean };
  hero?: boolean;
}

export function MetricCard({ label, value, sub, delta, hero }: MetricCardProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <span
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <span
        className={hero ? "text-3xl font-bold tracking-tight" : "text-2xl font-semibold"}
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </span>
      )}
      {delta && (
        <span
          className="mt-1 text-xs font-medium"
          style={{ color: delta.positive ? "var(--success)" : "var(--danger)" }}
        >
          {delta.value}
        </span>
      )}
    </div>
  );
}
