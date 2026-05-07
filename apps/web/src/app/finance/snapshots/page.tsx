"use client";

import { useState } from "react";
import { ArrowLeft, Camera } from "@phosphor-icons/react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { SNAPSHOTS } from "@/components/finance/fixtures";
import { formatCurrency, formatDate, CATEGORY_LABELS, CATEGORY_COLORS } from "@/components/finance/utils";

function DiffBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: positive ? "var(--success)" + "20" : "var(--danger)" + "20",
        color: positive ? "var(--success)" : "var(--danger)",
      }}
    >
      {positive ? "+" : ""}{formatCurrency(value)}
    </span>
  );
}

export default function SnapshotsPage() {
  const [selectedA, setSelectedA] = useState(SNAPSHOTS[0]?.id ?? "");
  const [selectedB, setSelectedB] = useState(SNAPSHOTS[SNAPSHOTS.length - 1]?.id ?? "");

  const snapA = SNAPSHOTS.find((s) => s.id === selectedA);
  const snapB = SNAPSHOTS.find((s) => s.id === selectedB);

  const netWorthDiff = snapA && snapB ? snapB.totalNetWorth - snapA.totalNetWorth : null;

  return (
    <AppShell>
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/finance"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Snapshots
          </h1>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Camera size={14} /> Prendre un snapshot
        </button>
      </div>

      {/* Diff selector */}
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
      >
        <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Comparer deux snapshots
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>De</label>
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-0)",
                color: "var(--text-primary)",
              }}
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
            >
              {SNAPSHOTS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>A</label>
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-0)",
                color: "var(--text-primary)",
              }}
              value={selectedB}
              onChange={(e) => setSelectedB(e.target.value)}
            >
              {SNAPSHOTS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {netWorthDiff !== null && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Evolution</span>
              <DiffBadge value={netWorthDiff} />
            </div>
          )}
        </div>
        {snapA && snapB && (
          <div className="mt-4 grid grid-cols-6 gap-2">
            {Object.entries(snapB.breakdown).map(([cat, valueB]) => {
              const valueA = snapA.breakdown[cat as keyof typeof snapA.breakdown] ?? 0;
              const diff = valueB - valueA;
              return (
                <div
                  key={cat}
                  className="rounded-lg border p-2 text-center"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
                >
                  <div
                    className="mx-auto mb-1 h-2 w-2 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#94A3B8" }}
                  />
                  <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </p>
                  <p className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(valueB)}
                  </p>
                  <DiffBadge value={diff} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="flex flex-col gap-0">
        {[...SNAPSHOTS].reverse().map((snap, i) => {
          const prev = SNAPSHOTS[SNAPSHOTS.length - 1 - i - 1];
          const diff = prev ? snap.totalNetWorth - prev.totalNetWorth : null;
          return (
            <div key={snap.id} className="flex gap-4">
              {/* Timeline line */}
              <div className="flex w-6 flex-col items-center">
                <div
                  className="mt-4 h-3 w-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: "var(--accent)" }}
                />
                {i < SNAPSHOTS.length - 1 && (
                  <div className="flex-1 w-0.5 mt-1" style={{ backgroundColor: "var(--border-subtle)" }} />
                )}
              </div>
              {/* Card */}
              <div
                className="mb-4 flex-1 rounded-xl border p-4"
                style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {snap.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatDate(snap.takenAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {formatCurrency(snap.totalNetWorth)}
                    </p>
                    {diff !== null && <DiffBadge value={diff} />}
                  </div>
                </div>
                {snap.notes && (
                  <p className="mt-2 text-xs italic" style={{ color: "var(--text-muted)" }}>
                    {snap.notes}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {Object.entries(snap.breakdown).map(([cat, value]) => (
                    <div
                      key={cat}
                      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: (CATEGORY_COLORS[cat] ?? "#94A3B8") + "20",
                        color: CATEGORY_COLORS[cat] ?? "#94A3B8",
                      }}
                    >
                      {CATEGORY_LABELS[cat]}: {(value / 1000).toFixed(0)}k
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </AppShell>
  );
}
