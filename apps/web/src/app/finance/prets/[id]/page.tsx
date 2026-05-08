"use client";

/**
 * Loan detail/edit page — fields persist on blur via entities.update.
 */

import { AppShell } from "@/components/shell";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";

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

export default function PretDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "loan" });
    },
  });

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("0");
  const [rate, setRate] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Hydrate-once per id (see comptes/[id]/page.tsx for rationale).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (hydratedFor.current === query.data.id) return;
    hydratedFor.current = query.data.id;
    const f = query.data.fields as Record<string, unknown>;
    setName(String(f["name"] ?? ""));
    setAmount(String(f["amount"] ?? 0));
    setRate(String(f["rate"] ?? 0));
    setStartDate(String(f["start_date"] ?? ""));
    setEndDate(String(f["end_date"] ?? ""));
  }, [query.data]);

  function persist(patch: Record<string, string | number | boolean | string[] | null>) {
    if (!query.data) return;
    updateMutation.mutate({ id: query.data.id, fields: patch });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/finance/prets"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Prêts
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Prêt introuvable.</p>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist({ name })}
              placeholder="Nom du prêt"
              className="mb-6 w-full bg-transparent text-2xl font-semibold outline-none"
              style={{ color: "var(--text-primary)" }}
            />

            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Montant (EUR)</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => persist({ amount: parseFloat(amount) || 0 })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Taux (%)</FieldLabel>
                <input
                  type="number"
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  onBlur={() => persist({ rate: parseFloat(rate) || 0 })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Début</FieldLabel>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={() => persist({ start_date: startDate })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Fin</FieldLabel>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={() => persist({ end_date: endDate })}
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
