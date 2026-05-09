"use client";

/**
 * Asset detail/edit page — fields persist on blur via entities.update.
 */

import { AppShell } from "@/components/shell";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { parseDecimal } from "@/components/finance/utils";

const CATEGORY_OPTIONS = [
  { value: "immo", label: "Immobilier" },
  { value: "action", label: "Action" },
  { value: "crypto", label: "Crypto" },
  { value: "fond", label: "Fonds" },
];

const inputClass =
  "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]";
const inputStyle: React.CSSProperties = {
  borderColor: "var(--border-subtle)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      {children}
    </label>
  );
}

export default function ActifDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "asset" });
    },
  });

  const [name, setName] = useState("");
  const [category, setCategory] = useState("action");
  const [currentValue, setCurrentValue] = useState("0");
  const [acquisitionValue, setAcquisitionValue] = useState("0");

  // Hydrate-once per id: see comptes/[id]/page.tsx for the rationale —
  // re-hydrating after every mutation success races user input on the
  // numeric fields ("la valeur ne change pas" reproducer).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (hydratedFor.current === query.data.id) return;
    hydratedFor.current = query.data.id;
    const f = query.data.fields as Record<string, unknown>;
    setName(String(f["name"] ?? ""));
    setCategory(String(f["category"] ?? "action"));
    setCurrentValue(String(f["current_value"] ?? 0));
    setAcquisitionValue(String(f["acquisition_value"] ?? 0));
  }, [query.data]);

  function persist(patch: Record<string, string | number | boolean | string[] | null>) {
    if (!query.data) return;
    updateMutation.mutate({ id: query.data.id, fields: patch });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/finance/actifs"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Actifs
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Actif introuvable.</p>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist({ name })}
              placeholder="Nom de l'actif"
              className="mb-6 w-full bg-transparent text-2xl font-semibold outline-none"
              style={{ color: "var(--text-primary)" }}
            />

            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Catégorie</FieldLabel>
                <select
                  value={category}
                  onChange={(e) => { setCategory(e.target.value); persist({ category: e.target.value }); }}
                  className={inputClass}
                  style={inputStyle}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel>Valeur actuelle (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  onBlur={() => persist({ current_value: parseDecimal(currentValue) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Valeur d'acquisition (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={acquisitionValue}
                  onChange={(e) => setAcquisitionValue(e.target.value)}
                  onBlur={() => persist({ acquisition_value: parseDecimal(acquisitionValue) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            </div>

            <SaveIndicator
              isPending={updateMutation.isPending}
              isError={updateMutation.isError}
              isSuccess={updateMutation.isSuccess}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function SaveIndicator(props: { isPending: boolean; isError: boolean; isSuccess: boolean }) {
  if (props.isPending) {
    return <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>Enregistrement…</p>;
  }
  if (props.isError) {
    return <p className="mt-4 text-xs" style={{ color: "var(--danger)" }}>Échec de l'enregistrement</p>;
  }
  if (props.isSuccess) {
    return <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>Enregistré</p>;
  }
  return null;
}
