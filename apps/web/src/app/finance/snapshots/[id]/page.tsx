"use client";

/**
 * Snapshot detail/edit page — fields persist on blur via entities.update.
 */

import { AppShell } from "@/components/shell";
import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { parseDecimal } from "@/components/finance/utils";

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

export default function SnapshotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.entities.get.useQuery({ id }, { enabled: !!id });
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "snapshot" });
    },
  });

  const [date, setDate] = useState("");
  const [netWorth, setNetWorth] = useState("0");
  const [totalAssets, setTotalAssets] = useState("0");
  const [totalDebts, setTotalDebts] = useState("0");
  const [notes, setNotes] = useState("");

  // Hydrate-once per id (see comptes/[id]/page.tsx for rationale).
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    if (hydratedFor.current === query.data.id) return;
    hydratedFor.current = query.data.id;
    const f = query.data.fields as Record<string, unknown>;
    // The snapshot list page uses `taken_at`, but the seed defines `date`.
    // Read both to be tolerant of either source. Persist as `date` per the seed.
    const rawDate = (f["date"] ?? f["taken_at"] ?? "") as string;
    setDate(rawDate ? String(rawDate).slice(0, 10) : "");
    setNetWorth(String(f["net_worth"] ?? f["total_net_worth"] ?? 0));
    setTotalAssets(String(f["total_assets"] ?? 0));
    setTotalDebts(String(f["total_debts"] ?? 0));
    setNotes(String(f["notes"] ?? ""));
  }, [query.data]);

  function persist(patch: Record<string, string | number | boolean | string[] | null>) {
    if (!query.data) return;
    updateMutation.mutate({ id: query.data.id, fields: patch });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link
          href="/finance/snapshots"
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} /> Snapshots
        </Link>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
        ) : query.isError || !query.data ? (
          <p className="text-sm" style={{ color: "var(--danger)" }}>Snapshot introuvable.</p>
        ) : (
          <>
            <h1 className="mb-6 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Snapshot {date || "(sans date)"}
            </h1>

            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>Date</FieldLabel>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  onBlur={() => persist({ date })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Patrimoine net (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={netWorth}
                  onChange={(e) => setNetWorth(e.target.value)}
                  onBlur={() => persist({ net_worth: parseDecimal(netWorth) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Total actifs (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={totalAssets}
                  onChange={(e) => setTotalAssets(e.target.value)}
                  onBlur={() => persist({ total_assets: parseDecimal(totalAssets) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Total dettes (EUR)</FieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  value={totalDebts}
                  onChange={(e) => setTotalDebts(e.target.value)}
                  onBlur={() => persist({ total_debts: parseDecimal(totalDebts) })}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>

              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => persist({ notes })}
                  rows={6}
                  placeholder="Notes libres…"
                  className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]"
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
