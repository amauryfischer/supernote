"use client";

/**
 * Asset detail/edit page.
 *
 * Loads the entity once via `entities.get`, hydrates the form inputs as
 * useState seeds (no useEffect chain), persists on blur via `entities.update`.
 * Includes a "Rafraîchir le prix" button that calls a free price feed —
 * CoinGecko for crypto and Yahoo Finance / Stooq for actions / fonds.
 */

import { ArrowLeft, ArrowsClockwise } from "@phosphor-icons/react";
import { Input } from "@heroui/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/shell";
import { Skeleton } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { parseDecimal, formatCurrency } from "@/components/finance/utils";
import { fetchAssetPrice } from "@/lib/finance/price-fetch";

const CATEGORY_OPTIONS = [
  { value: "action", label: "Action" },
  { value: "crypto", label: "Crypto" },
  { value: "fond", label: "Fonds" },
  { value: "immo", label: "Immobilier" },
];

const fieldClass =
  "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]";
const fieldStyle: React.CSSProperties = {
  borderColor: "var(--border-subtle)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
};

// Skeleton de formulaire au chargement — remplace le « Chargement… » texte.
function FormSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function ActifDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const utils = trpc.useUtils();
  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "asset" });
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <Link
          href="/finance/actifs"
          className="mb-6 flex items-center gap-1.5 text-sm hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Actifs
        </Link>

        {query.isLoading ? (
          <FormSkeleton />
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Actif introuvable.</p>
        ) : (
          <AssetForm
            key={query.data.id}
            initialFields={query.data.fields as Record<string, unknown>}
            onPersist={(fields) =>
              updateMutation.mutate({ id: query.data!.id, fields })
            }
            isSaving={updateMutation.isPending}
            saveError={updateMutation.error?.message ?? null}
          />
        )}
      </div>
    </AppShell>
  );
}

interface AssetFormProps {
  initialFields: Record<string, unknown>;
  onPersist: (fields: Record<string, string | number>) => void;
  isSaving: boolean;
  saveError: string | null;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

function AssetForm({ initialFields, onPersist, isSaving, saveError }: AssetFormProps) {
  const [name, setName] = useState(String(initialFields["name"] ?? ""));
  const [category, setCategory] = useState(String(initialFields["category"] ?? "action"));
  const [symbol, setSymbol] = useState(String(initialFields["symbol"] ?? ""));
  const [currentValue, setCurrentValue] = useState(
    String(Number(initialFields["current_value"] ?? 0)),
  );
  const [acquisitionValue, setAcquisitionValue] = useState(
    String(Number(initialFields["acquisition_value"] ?? 0)),
  );
  const [quantity, setQuantity] = useState(
    String(Number(initialFields["quantity"] ?? 0)),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshError(null);
    if (!symbol.trim()) {
      setRefreshError("Renseignez un symbole (ex. AAPL, bitcoin) avant de rafraîchir.");
      return;
    }
    setRefreshing(true);
    try {
      const result = await fetchAssetPrice({ category, symbol });
      if (!result) {
        setRefreshError(
          category === "immo"
            ? "Pas de feed automatique pour l'immobilier — saisir la valeur à la main."
            : "Cours indisponible (symbole inconnu ou source bloquée).",
        );
        return;
      }
      const qty = parseDecimal(quantity);
      const value = qty > 0 ? result.value * qty : result.value;
      setCurrentValue(String(value));
      onPersist({ current_value: value });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => onPersist({ name })}
        placeholder="Nom de l'actif"
        className="mb-2 w-full bg-transparent text-2xl font-semibold outline-none"
        style={{ color: "var(--text-primary)" }}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Catégorie</FieldLabel>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              onPersist({ category: e.target.value });
            }}
            className={fieldClass}
            style={fieldStyle}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>
            Symbole
            <span className="ml-1 font-normal" style={{ color: "var(--text-muted)" }}>
              (ex. AAPL · CW8.PA · bitcoin)
            </span>
          </FieldLabel>
          <Input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onBlur={() => onPersist({ symbol })}
            placeholder="AAPL"
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <FieldLabel>Quantité</FieldLabel>
          <Input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => onPersist({ quantity: parseDecimal(quantity) })}
            placeholder="0"
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
        <div>
          <FieldLabel>Valeur actuelle (EUR)</FieldLabel>
          <Input
            type="text"
            inputMode="decimal"
            value={currentValue}
            onChange={(e) => setCurrentValue(e.target.value)}
            onBlur={() => onPersist({ current_value: parseDecimal(currentValue) })}
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
        <div>
          <FieldLabel>Valeur d'acquisition (EUR)</FieldLabel>
          <Input
            type="text"
            inputMode="decimal"
            value={acquisitionValue}
            onChange={(e) => setAcquisitionValue(e.target.value)}
            onBlur={() => onPersist({ acquisition_value: parseDecimal(acquisitionValue) })}
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)", backgroundColor: "var(--surface-1)" }}
        >
          <ArrowsClockwise size={12} className={refreshing ? "animate-spin" : undefined} />
          {refreshing ? "Récupération…" : "Rafraîchir le prix"}
        </button>
        <PnlBadge
          currentValue={parseDecimal(currentValue)}
          acquisitionValue={parseDecimal(acquisitionValue)}
        />
      </div>

      {refreshError && (
        <p className="text-xs" style={{ color: "var(--danger)" }}>{refreshError}</p>
      )}

      <SaveIndicator isPending={isSaving} errorMsg={saveError} />
    </div>
  );
}

function PnlBadge({ currentValue, acquisitionValue }: { currentValue: number; acquisitionValue: number }) {
  if (acquisitionValue <= 0) return null;
  const pnl = currentValue - acquisitionValue;
  const pct = (pnl / acquisitionValue) * 100;
  const positive = pnl >= 0;
  return (
    <span
      className="text-xs font-semibold tabular-nums"
      style={{ color: positive ? "var(--success)" : "var(--danger)" }}
    >
      {positive ? "+" : ""}{formatCurrency(pnl)} ({pct.toFixed(2)} %)
    </span>
  );
}

function SaveIndicator({ isPending, errorMsg }: { isPending: boolean; errorMsg: string | null }) {
  if (isPending) {
    return <p className="text-xs" style={{ color: "var(--text-muted)" }}>Enregistrement…</p>;
  }
  if (errorMsg) {
    return <p className="text-xs" style={{ color: "var(--danger)" }}>Échec : {errorMsg}</p>;
  }
  return null;
}
