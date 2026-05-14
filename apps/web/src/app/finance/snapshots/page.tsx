"use client";

import { useState } from "react";
import { ArrowLeft, Camera } from "@phosphor-icons/react";
import { Button, SelectRoot, SelectTrigger, SelectValue, SelectPopover, ListBox, ListBoxItem } from "@heroui/react";
import Link from "next/link";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFinanceSnapshots } from "@/components/finance/hooks";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatDate, CATEGORY_LABELS, CATEGORY_COLORS } from "@/components/finance/utils";
import type { Snapshot } from "@/components/finance/fixtures";

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
  const isMobile = useIsMobile();
  const { snapshots, isLoading, isFallback } = useFinanceSnapshots();
  const utils = trpc.useUtils();

  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => { void utils.entities.list.invalidate({ typeId: "snapshot" }); },
  });

  const [selectedA, setSelectedA] = useState<string>("");
  const [selectedB, setSelectedB] = useState<string>("");

  const effectiveA = selectedA || snapshots[0]?.id || "";
  const effectiveB = selectedB || snapshots[snapshots.length - 1]?.id || "";

  const snapA = snapshots.find((s) => s.id === effectiveA);
  const snapB = snapshots.find((s) => s.id === effectiveB);
  const netWorthDiff = snapA && snapB ? snapB.totalNetWorth - snapA.totalNetWorth : null;

  const handleTakeSnapshot = async () => {
    await createMutation.mutateAsync({
      typeId: "snapshot",
      fields: { taken_at: new Date().toISOString() },
    });
  };

  useMobileTitle(isMobile ? "Snapshots" : null);
  useMobileFab(
    isMobile
      ? { icon: Camera, label: "Prendre un snapshot", onPress: () => void handleTakeSnapshot() }
      : null
  );
  useMobileHeaderActions([]);

  // Reverse for timeline display (newest first)
  const reversed = [...snapshots].reverse();

  return (
    <AppShell>
    <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
      <div className="hidden md:flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/finance" className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Snapshots</h1>
          {isFallback && (
            <span className="text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}>
              mode dégradé
            </span>
          )}
        </div>
        <Button
          onPress={() => void handleTakeSnapshot()}
          isDisabled={createMutation.isPending}
          size="sm"
          className="flex items-center gap-2 font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Camera size={14} /> {createMutation.isPending ? "Enregistrement..." : "Prendre un snapshot"}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
      ) : snapshots.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Pas encore de données financières. Prendre un premier snapshot depuis le dashboard.
          </p>
        </div>
      ) : (
        <>
          {/* Diff selector */}
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Comparer deux snapshots
            </h3>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>De</label>
                <SelectRoot
                  selectedKey={effectiveA}
                  onSelectionChange={(key) => { if (key != null) setSelectedA(String(key)); }}
                >
                  <SelectTrigger
                    className="rounded-lg border px-3 py-2 text-sm w-full"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopover>
                    <ListBox>
                      {snapshots.map((s) => (
                        <ListBoxItem key={s.id} id={s.id}>{s.name}</ListBoxItem>
                      ))}
                    </ListBox>
                  </SelectPopover>
                </SelectRoot>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>A</label>
                <SelectRoot
                  selectedKey={effectiveB}
                  onSelectionChange={(key) => { if (key != null) setSelectedB(String(key)); }}
                >
                  <SelectTrigger
                    className="rounded-lg border px-3 py-2 text-sm w-full"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopover>
                    <ListBox>
                      {snapshots.map((s) => (
                        <ListBoxItem key={s.id} id={s.id}>{s.name}</ListBoxItem>
                      ))}
                    </ListBox>
                  </SelectPopover>
                </SelectRoot>
              </div>
              {netWorthDiff !== null && (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>Evolution</span>
                  <DiffBadge value={netWorthDiff} />
                </div>
              )}
            </div>
            {snapA && snapB && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Object.entries(snapB.breakdown).map(([cat, valueB]) => {
                  const valueA = (snapA.breakdown as Record<string, number>)[cat] ?? 0;
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
            {reversed.map((snap: Snapshot, i) => {
              const prevIdx = snapshots.length - 1 - i - 1;
              const prev = snapshots[prevIdx];
              const diff = prev ? snap.totalNetWorth - prev.totalNetWorth : null;
              return (
                <div key={snap.id} className="flex gap-4">
                  <div className="flex w-6 flex-col items-center">
                    <div
                      className="mt-4 h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: "var(--accent)" }}
                    />
                    {i < reversed.length - 1 && (
                      <div className="flex-1 w-0.5 mt-1" style={{ backgroundColor: "var(--border-subtle)" }} />
                    )}
                  </div>
                  <Link
                    href={`/finance/snapshots/${snap.id}`}
                    className="mb-4 flex-1 rounded-xl border p-4 transition-colors hover:bg-[var(--surface-2)]"
                    style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{snap.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{formatDate(snap.takenAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                          {formatCurrency(snap.totalNetWorth)}
                        </p>
                        {diff !== null && <DiffBadge value={diff} />}
                      </div>
                    </div>
                    {snap.notes && (
                      <p className="mt-2 text-xs italic" style={{ color: "var(--text-muted)" }}>{snap.notes}</p>
                    )}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {Object.entries(snap.breakdown).map(([cat, value]) => (
                        <div
                          key={cat}
                          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                          style={{
                            backgroundColor: (CATEGORY_COLORS[cat] ?? "#94A3B8") + "20",
                            color: CATEGORY_COLORS[cat] ?? "#94A3B8",
                          }}
                        >
                          {CATEGORY_LABELS[cat] ?? cat}: {(value / 1000).toFixed(0)}k
                        </div>
                      ))}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
    </AppShell>
  );
}
