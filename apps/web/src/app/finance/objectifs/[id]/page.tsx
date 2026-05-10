"use client";

/**
 * Goal detail/edit page — fields persist on blur via entities.update.
 */

import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { parseDecimal } from "@/components/finance/utils";

const STATUS_OPTIONS = [
  { value: "en_cours", label: "En cours" },
  { value: "atteint", label: "Atteint" },
  { value: "abandonne", label: "Abandonné" },
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

export default function ObjectifDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Objectif" : null);
  useMobileFab(null);
  useMobileHeaderActions([]);

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "goal" });
    },
  });

  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("0");
  const [currentAmount, setCurrentAmount] = useState("0");
  const [deadline, setDeadline] = useState("");
  const [status, setStatus] = useState("en_cours");

  // Hydrate-once per id (see comptes/[id]/page.tsx for rationale).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (hydratedFor.current === query.data.id) return;
    hydratedFor.current = query.data.id;
    const f = query.data.fields as Record<string, unknown>;
    setName(String(f["name"] ?? ""));
    setTargetAmount(String(f["target_amount"] ?? 0));
    setCurrentAmount(String(f["current_amount"] ?? 0));
    setDeadline(String(f["deadline"] ?? ""));
    setStatus(String(f["status"] ?? "en_cours"));
  }, [query.data]);

  function persist(patch: Record<string, string | number | boolean | string[] | null>) {
    if (!query.data) return;
    updateMutation.mutate({ id: query.data.id, fields: patch });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-3 py-6 md:px-6 md:py-8">
        <Link
          href="/finance/objectifs"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Objectifs
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Objectif introuvable.</p>
        ) : (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist({ name })}
              placeholder="Nom de l'objectif"
              className="mb-6 w-full bg-transparent text-2xl font-semibold outline-none"
              style={{ color: "var(--text-primary)" }}
            />

            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Montant cible (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  onBlur={() => persist({ target_amount: parseDecimal(targetAmount) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Montant actuel (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={currentAmount}
                  onChange={(e) => setCurrentAmount(e.target.value)}
                  onBlur={() => persist({ current_amount: parseDecimal(currentAmount) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Échéance</FieldLabel>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  onBlur={() => persist({ deadline })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Statut</FieldLabel>
                <select
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); persist({ status: e.target.value }); }}
                  className={inputClass}
                  style={inputStyle}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
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
