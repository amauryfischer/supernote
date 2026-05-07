"use client";

import { ArrowLeft, Plus, TrendUp, TrendDown } from "@phosphor-icons/react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { ASSETS, ACCOUNTS, type Asset } from "@/components/finance/fixtures";
import { formatCurrency, CATEGORY_COLORS, CATEGORY_LABELS } from "@/components/finance/utils";

const assetsByCategory = ASSETS.reduce<Record<string, Asset[]>>((acc, asset) => {
  const cat = asset.category;
  if (!acc[cat]) acc[cat] = [];
  acc[cat]!.push(asset);
  return acc;
}, {});

function getAccountName(accountId: string | undefined): string {
  if (!accountId) return "—";
  return ACCOUNTS.find((a) => a.id === accountId)?.name ?? "—";
}

function AssetCard({ asset }: { asset: Asset }) {
  const gain = asset.currentValue - asset.acquisitionValue;
  const gainPct = (gain / asset.acquisitionValue) * 100;
  const positive = gain >= 0;

  return (
    <div
      className="rounded-xl border p-4 transition-shadow hover:shadow-sm"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
          {asset.name}
        </p>
        {positive ? (
          <TrendUp size={14} style={{ color: "var(--success)", flexShrink: 0 }} />
        ) : (
          <TrendDown size={14} style={{ color: "var(--danger)", flexShrink: 0 }} />
        )}
      </div>
      <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
        {formatCurrency(asset.currentValue)}
      </p>
      <p
        className="mt-0.5 text-xs font-medium"
        style={{ color: positive ? "var(--success)" : "var(--danger)" }}
      >
        {positive ? "+" : ""}
        {formatCurrency(gain)} ({gainPct > 0 ? "+" : ""}
        {gainPct.toFixed(1).replace(".", ",")} %)
      </p>
      <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border-subtle)" }}>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Achat : {formatCurrency(asset.acquisitionValue)}
        </p>
        {asset.accountId && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Compte : {getAccountName(asset.accountId)}
          </p>
        )}
        {asset.ticker && (
          <p className="text-xs font-mono" style={{ color: "var(--accent)" }}>
            {asset.ticker}
          </p>
        )}
        {asset.symbol && (
          <p className="text-xs font-mono" style={{ color: "var(--accent)" }}>
            {asset.symbol}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ActifsPage() {
  const categories = Object.entries(assetsByCategory);

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
            Actifs
          </h1>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Actif
        </button>
      </div>

      {categories.map(([cat, assets]) => {
        const total = assets.reduce((s, a) => s + a.currentValue, 0);
        const color = CATEGORY_COLORS[cat] ?? "#94A3B8";
        return (
          <div key={cat}>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {CATEGORY_LABELS[cat] ?? cat}
              </h2>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {assets.length} actif{assets.length > 1 ? "s" : ""} · {formatCurrency(total)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
    </AppShell>
  );
}
