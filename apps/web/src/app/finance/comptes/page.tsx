"use client";

/**
 * Accounts list — minimal rewrite.
 *
 * Shows every entity of type "account" as a row. New account = single
 * tRPC create + invalidate. Click a row → navigate to detail page.
 */

import { ArrowLeft, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency, formatDate } from "@/components/finance/utils";

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

interface Account {
  id: string;
  name: string;
  kind: string;
  institution: string;
  balance: number;
  updatedAt: string;
}

function field<T>(f: Record<string, unknown>, key: string, coerce: (v: unknown) => T, fallback: T): T {
  return key in f ? coerce(f[key]) : fallback;
}

export default function ComptesPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.entities.list.useQuery({ typeId: "account", limit: 500, offset: 0 });
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (data) => {
      void utils.entities.list.invalidate({ typeId: "account" });
      // Open the new account immediately so the user can fill it in.
      router.push(`/finance/comptes/${data.id}`);
    },
  });

  const accounts: Account[] = (query.data?.items ?? []).map((e) => {
    const f = e.fields as Record<string, unknown>;
    return {
      id: e.id,
      name: field(f, "name", (v) => (typeof v === "string" ? v : "Compte"), "Compte"),
      kind: field(f, "kind", (v) => (typeof v === "string" ? v : "other"), "other"),
      institution: field(f, "institution", (v) => (typeof v === "string" ? v : ""), ""),
      balance: field(
        f,
        "current_balance",
        (v) => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0),
        0,
      ),
      updatedAt: e.updatedAt,
    };
  });

  const total = accounts.reduce((s, a) => s + a.balance, 0);

  const handleCreate = () => {
    createMutation.mutate({
      typeId: "account",
      fields: { name: "Nouveau compte", kind: "checking", current_balance: 0 },
    });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-3 py-6 md:px-6 md:py-8">
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
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Comptes</h1>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Plus size={12} /> Nouveau compte
          </button>
        </div>

        {query.isLoading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>
        ) : accounts.length === 0 ? (
          <EmptyList onCreate={handleCreate} pending={createMutation.isPending} />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/finance/comptes/${a.id}`}
                    className="grid grid-cols-[1fr_140px_140px_140px] items-center gap-4 rounded-lg border px-4 py-3 hover:bg-[var(--surface-2)]"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                  >
                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {a.name}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium justify-self-start"
                      style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {KIND_LABELS[a.kind] ?? a.kind}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {formatCurrency(a.balance)}
                    </span>
                    <span className="text-right text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatDate(a.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
              {accounts.length} compte{accounts.length > 1 ? "s" : ""} · Total : {formatCurrency(total)}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function EmptyList({ onCreate, pending }: { onCreate: () => void; pending: boolean }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Aucun compte pour l'instant.
      </p>
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={12} /> Créer mon premier compte
      </button>
    </div>
  );
}
