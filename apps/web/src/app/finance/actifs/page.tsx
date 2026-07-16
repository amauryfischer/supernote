"use client";

/**
 * Assets list — mirrors the comptes page but for the `asset` entity type.
 * Renders a single tRPC list, lets the user create a fresh asset, and
 * navigates to the detail page for editing / price refresh.
 */

import { ArrowLeft, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatDate } from "@/components/finance/utils";
import { Button, EmptyState, Skeleton } from "@supernote/ui";

const CATEGORY_LABELS: Record<string, string> = {
  immo: "Immobilier",
  action: "Action",
  crypto: "Crypto",
  fond: "Fonds",
};

const CATEGORY_COLORS: Record<string, string> = {
  immo: "#7C3AED",
  action: "#2563EB",
  crypto: "#D97706",
  fond: "#0891B2",
};

interface Asset {
  id: string;
  name: string;
  category: string;
  symbol: string;
  currentValue: number;
  acquisitionValue: number;
  updatedAt: string;
}

function strField(f: Record<string, unknown>, key: string): string {
  const v = f[key];
  return typeof v === "string" ? v : "";
}
function numField(f: Record<string, unknown>, key: string): number {
  const v = f[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function ActifsPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.entities.list.useQuery({ typeId: "asset", limit: 500, offset: 0 });
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (data) => {
      void utils.entities.list.invalidate({ typeId: "asset" });
      router.push(`/finance/actifs/${data.id}`);
    },
  });

  const assets: Asset[] = (query.data?.items ?? []).map((e) => {
    const f = e.fields as Record<string, unknown>;
    return {
      id: e.id,
      name: strField(f, "name") || "Actif",
      category: strField(f, "category") || "action",
      symbol: strField(f, "symbol"),
      currentValue: numField(f, "current_value"),
      acquisitionValue: numField(f, "acquisition_value"),
      updatedAt: e.updatedAt,
    };
  });

  const totalCurrent = assets.reduce((s, a) => s + a.currentValue, 0);
  const totalCost = assets.reduce((s, a) => s + a.acquisitionValue, 0);
  const pnl = totalCurrent - totalCost;
  const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

  const handleCreate = () => {
    createMutation.mutate({
      typeId: "asset",
      fields: { name: "Nouvel actif", category: "action", current_value: 0, acquisition_value: 0 },
    });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/finance"
              className="flex items-center gap-1 text-sm hover:underline"
              style={{ color: "var(--text-muted)" }}
            >
              <ArrowLeft size={14} /> Finance
            </Link>
            <span style={{ color: "var(--border)" }}>/</span>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Actifs</h1>
          </div>
          <Button
            variant="primary"
            size="sm"
            onPress={handleCreate}
            isDisabled={createMutation.isPending}
          >
            <Plus size={12} /> Nouvel actif
          </Button>
        </div>

        {query.isLoading ? (
          <FinanceRowsSkeleton />
        ) : assets.length === 0 ? (
          <EmptyList onCreate={handleCreate} />
        ) : (
          <>
            {/* Même hiérarchie que le dashboard finance : la valeur clé domine,
                les stats secondaires suivent */}
            <div
              className="mb-4 grid grid-cols-1 gap-3 rounded-xl border p-4 sm:grid-cols-3"
              style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
            >
              <Stat label="Valeur actuelle" value={formatCurrency(totalCurrent)} primary />
              <Stat label="Acquisition" value={formatCurrency(totalCost)} />
              <Stat
                label="Plus / moins value"
                value={`${formatCurrency(pnl)} (${pnlPct.toFixed(2)} %)`}
                tone={pnl >= 0 ? "positive" : "negative"}
              />
            </div>

            <ul className="flex flex-col gap-2">
              {assets.map((a) => {
                const itemPnl = a.currentValue - a.acquisitionValue;
                return (
                  <li key={a.id}>
                    {/* Mobile : nom + valeur seulement (2 colonnes) ; les pistes
                        fixes 140/120px ne tiennent pas sous 768px */}
                    <Link
                      href={`/finance/actifs/${a.id}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border px-4 py-3 hover:bg-[var(--surface-2)] md:grid-cols-[1fr_auto_140px_120px_120px]"
                      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                    >
                      <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {a.name}
                      </span>
                      <span
                        className="hidden rounded-full px-2 py-0.5 text-xs font-medium md:inline-flex"
                        style={{
                          backgroundColor: (CATEGORY_COLORS[a.category] ?? "#94a3b8") + "20",
                          color: CATEGORY_COLORS[a.category] ?? "#94a3b8",
                        }}
                      >
                        {CATEGORY_LABELS[a.category] ?? a.category}
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        {formatCurrency(a.currentValue)}
                      </span>
                      <span
                        className="hidden text-right text-xs font-medium tabular-nums md:block"
                        style={{ color: itemPnl >= 0 ? "var(--success)" : "var(--danger)" }}
                      >
                        {a.acquisitionValue > 0 ? `${itemPnl >= 0 ? "+" : ""}${formatCurrency(itemPnl)}` : "—"}
                      </span>
                      <span className="hidden text-right text-xs md:block" style={{ color: "var(--text-muted)" }}>
                        {a.symbol || formatDate(a.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              {assets.length} actif{assets.length > 1 ? "s" : ""}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
  primary = false,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  primary?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className={`mt-0.5 tabular-nums ${primary ? "text-2xl font-bold" : "text-base font-semibold"}`}
        style={{
          color:
            tone === "positive"
              ? "var(--success)"
              : tone === "negative"
                ? "var(--danger)"
                : "var(--text-primary)",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyList({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      title="Aucun actif enregistré"
      description="Ajoute une action, une crypto ou un bien immobilier pour suivre sa valeur au fil du temps."
      action={{ label: "Créer mon premier actif", onClick: onCreate, icon: <Plus size={14} /> }}
    />
  );
}

// Lignes squelette de la liste — remplace le « Chargement… » texte (local-first).
function FinanceRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
