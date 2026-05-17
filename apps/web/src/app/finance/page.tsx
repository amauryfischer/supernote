"use client";

/**
 * Finance dashboard — minimal rewrite.
 *
 * Lists accounts with their current balance and a total. No charts, no
 * snapshot timeline, no goals/loans cards (deleted with the section
 * rewrite). The previous version triggered render loops on detail page nav.
 */

import { Plus, Wallet } from "@phosphor-icons/react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/components/finance/utils";

interface Account {
  id: string;
  name: string;
  kind: string;
  balance: number;
}

const KIND_LABELS: Record<string, string> = {
  checking: "Courant",
  savings: "Épargne",
  livret: "Livret",
  pea: "PEA",
  cto: "CTO",
  assurance_vie: "Assurance-vie",
  crypto: "Crypto",
  other: "Autre",
};

function fieldString(f: Record<string, unknown>, key: string): string {
  const v = f[key];
  return typeof v === "string" ? v : "";
}
function fieldNumber(f: Record<string, unknown>, key: string): number {
  const v = f[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function FinancePage() {
  const query = trpc.entities.list.useQuery({ typeId: "account", limit: 500, offset: 0 });

  const accounts: Account[] = (query.data?.items ?? []).map((e) => {
    const f = e.fields as Record<string, unknown>;
    return {
      id: e.id,
      name: fieldString(f, "name") || "Compte",
      kind: fieldString(f, "kind") || "other",
      balance: fieldNumber(f, "current_balance"),
    };
  });

  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-3 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              Finance
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
              Vue d'ensemble de vos comptes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/finance/comptes"
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            >
              Comptes
            </Link>
            <Link
              href="/finance/actifs"
              className="rounded-lg border px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            >
              Actifs
            </Link>
          </div>
        </div>

        <div
          className="mb-6 rounded-xl border p-5"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <p className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Patrimoine total
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(total)}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {accounts.length} compte{accounts.length !== 1 ? "s" : ""}
          </p>
        </div>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>
        ) : accounts.length === 0 ? (
          <EmptyDashboard />
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/finance/comptes/${a.id}`}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                >
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {a.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {KIND_LABELS[a.kind] ?? a.kind}
                    </p>
                  </div>
                  <p className="text-base font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(a.balance)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function EmptyDashboard() {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <Wallet size={28} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Pas encore de comptes
      </p>
      <Link
        href="/finance/comptes"
        className="mt-1 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={12} /> Ajouter un compte
      </Link>
    </div>
  );
}
