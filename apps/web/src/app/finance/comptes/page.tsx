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
import { Button, EmptyState, Skeleton } from "@supernote/ui";

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
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Comptes</h1>
          </div>
          <Button
            variant="primary"
            size="sm"
            onPress={handleCreate}
            isDisabled={createMutation.isPending}
          >
            <Plus size={12} /> Nouveau compte
          </Button>
        </div>

        {query.isLoading ? (
          <FinanceRowsSkeleton />
        ) : accounts.length === 0 ? (
          <EmptyList onCreate={handleCreate} />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {accounts.map((a) => (
                <li key={a.id}>
                  {/* Mobile : nom + solde seulement (2 colonnes) ; les pistes
                      fixes 140px ne tiennent pas sous 768px */}
                  <Link
                    href={`/finance/comptes/${a.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border px-4 py-3 hover:bg-[var(--surface-2)] md:grid-cols-[1fr_140px_140px_140px]"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                  >
                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {a.name}
                    </span>
                    <span
                      className="hidden rounded-full px-2 py-0.5 text-xs font-medium justify-self-start md:inline-flex"
                      style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {KIND_LABELS[a.kind] ?? a.kind}
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {formatCurrency(a.balance)}
                    </span>
                    <span className="hidden text-right text-xs md:block" style={{ color: "var(--text-muted)" }}>
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

function EmptyList({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      title="Aucun compte pour l'instant"
      description="Ajoute un compte courant, une épargne ou un PEA pour suivre ton patrimoine — tout reste sur ta machine."
      action={{ label: "Créer mon premier compte", onClick: onCreate, icon: <Plus size={14} /> }}
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
