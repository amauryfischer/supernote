"use client";

import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, Plus, TrendUp, TrendDown } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import Link from "next/link";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFinanceAssets, useFinanceAccounts } from "@/components/finance/hooks";
import type { Asset } from "@/components/finance/fixtures";
import { formatCurrency, CATEGORY_COLORS, CATEGORY_LABELS } from "@/components/finance/utils";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";

interface LivePrice {
  price: number;
  currency: string;
  change24h?: number;
}

function AssetCard({ asset, accountName, livePrice }: { asset: Asset; accountName: string; livePrice?: LivePrice }) {
  const currentValue = livePrice ? livePrice.price : asset.currentValue;
  const gain = currentValue - asset.acquisitionValue;
  const gainPct = asset.acquisitionValue > 0 ? (gain / asset.acquisitionValue) * 100 : 0;
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
        {formatCurrency(currentValue)}
        {livePrice && (
          <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--success)" }}>live</span>
        )}
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
        {accountName && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Compte : {accountName}
          </p>
        )}
        {asset.ticker && (
          <p className="text-xs font-mono" style={{ color: "var(--accent)" }}>{asset.ticker}</p>
        )}
        {asset.symbol && !asset.ticker && (
          <p className="text-xs font-mono" style={{ color: "var(--accent)" }}>{asset.symbol}</p>
        )}
      </div>
    </div>
  );
}

export default function ActifsPage() {
  const isMobile = useIsMobile();
  const { assets, isLoading, isFallback } = useFinanceAssets();
  const { accounts } = useFinanceAccounts();
  const [livePrices, setLivePrices] = useState<Map<string, LivePrice>>(new Map());
  const [refreshing, setRefreshing] = useState(false);

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "asset" });
    },
  });
  const handleNewAsset = useCallback(async () => {
    try {
      await createMutation.mutateAsync({
        typeId: "asset",
        fields: { name: "Nouvel actif", current_value: 0, category: "action" },
      });
    } catch (err) {
      console.error("[finance/actifs] create failed", err);
    }
  }, [createMutation]);

  const accountNameMap = Object.fromEntries(accounts.map((a) => [a.id, a.name]));

  const byCategory = assets.reduce<Record<string, Asset[]>>((acc, asset) => {
    const cat = asset.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat]!.push(asset);
    return acc;
  }, {});

  const handleRefreshPrices = useCallback(async () => {
    setRefreshing(true);
    const tickeredAssets = assets.filter((a) => a.ticker);
    await Promise.allSettled(
      tickeredAssets.map(async (asset) => {
        try {
          const r = await trpcVanillaClient.system.fetchPrice.query({
            ticker: asset.ticker!,
            isCrypto: asset.category === "crypto",
          });
          setLivePrices((prev) => new Map(prev).set(asset.id, {
            price: r.price,
            currency: r.currency,
            change24h: r.change24h,
          }));
        } catch { /* non-fatal */ }
      })
    );
    setRefreshing(false);
  }, [assets]);

  const categories = Object.entries(byCategory);

  useMobileTitle(isMobile ? "Actifs" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouvel actif", onPress: () => void handleNewAsset() }
      : null
  );
  useMobileHeaderActions([]);

  return (
    <AppShell>
    <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
      <div className="hidden md:flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/finance" className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Actifs</h1>
          {isFallback && (
            <span className="text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}>
              mode dégradé
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onPress={() => void handleRefreshPrices()}
            isDisabled={refreshing || isFallback}
            variant="outline"
            size="sm"
            className="flex items-center gap-2 font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {refreshing ? "Actualisation..." : "Refresh prix"}
          </Button>
          <Button
            onPress={() => void handleNewAsset()}
            isDisabled={createMutation.isPending}
            size="sm"
            className="flex items-center gap-2 font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Plus size={14} /> Actif
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
      ) : assets.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Pas encore de données financières. Importer OFX/CSV ou ajouter un actif.
          </p>
        </div>
      ) : (
        categories.map(([cat, catAssets]) => {
          const total = catAssets.reduce((s, a) => {
            const lp = livePrices.get(a.id);
            return s + (lp ? lp.price : a.currentValue);
          }, 0);
          const color = CATEGORY_COLORS[cat] ?? "#94A3B8";
          return (
            <div key={cat}>
              <div className="mb-3 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </h2>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {catAssets.length} actif{catAssets.length > 1 ? "s" : ""} · {formatCurrency(total)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                {catAssets.map((asset) => (
                  <Link
                    key={asset.id}
                    href={`/finance/actifs/${asset.id}`}
                    className="block transition-transform hover:-translate-y-0.5"
                  >
                    <AssetCard
                      asset={asset}
                      accountName={asset.accountId ? (accountNameMap[asset.accountId] ?? "—") : ""}
                      livePrice={livePrices.get(asset.id)}
                    />
                  </Link>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
    </AppShell>
  );
}
