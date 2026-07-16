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
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { useMobileFab, useMobileTitle } from "@/components/shell/shell-chrome-context";
import { trpc } from "@/lib/trpc/client";
import { formatCurrency } from "@/components/finance/utils";
import { EmptyState, Skeleton } from "@supernote/ui";

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
  return (
    <AppShell>
      <FinanceDashboard />
    </AppShell>
  );
}

function FinanceDashboard() {
  const router = useRouter();
  const query = trpc.entities.list.useQuery({ typeId: "account", limit: 500, offset: 0 });

  // Mobile chrome — page title + a FAB that jumps to the accounts list
  // (the place where a new account is created), so the create verb is
  // reachable from the bottom bar like every other section.
  useMobileTitle("Finance");
  useMobileFab({
    icon: Plus,
    label: "Gérer les comptes",
    onPress: () => router.push("/finance/comptes"),
  });

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
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Finance
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            Vue d'ensemble de vos comptes.
          </p>
        </div>
        <nav className="flex shrink-0 items-center gap-1" aria-label="Sections finance">
          <Link
            href="/finance/comptes"
            className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-secondary)" }}
          >
            Comptes
          </Link>
          <Link
            href="/finance/actifs"
            className="rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-secondary)" }}
          >
            Actifs
          </Link>
        </nav>
      </div>

      {query.isLoading ? (
        <LedgerSkeleton />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Wallet size={26} />}
          title="Pas encore de comptes"
          description="Ajoute un compte courant, une épargne ou un PEA pour suivre ton patrimoine — tout reste sur ta machine."
          action={{
            label: "Ajouter un compte",
            onClick: () => router.push("/finance/comptes"),
            icon: <Plus size={14} />,
          }}
        />
      ) : (
        // Registre : la liste des comptes est le héros, le total la coiffe en
        // en-tête (chiffre tabulaire aligné à droite) — plus de carte
        // hero-metric flottante (eyebrow uppercase + sous-stat).
        <div
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <div
            className="flex items-baseline justify-between gap-4 border-b px-4 py-3"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Patrimoine total
            </span>
            <span className="text-2xl font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(total)}
            </span>
          </div>
          <ul>
            {accounts.map((a, i) => (
              <li key={a.id}>
                <Link
                  href={`/finance/comptes/${a.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--border-subtle)" }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {a.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {KIND_LABELS[a.kind] ?? a.kind}
                    </p>
                  </div>
                  <p className="shrink-0 text-base font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(a.balance)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Skeleton du registre (en-tête total + lignes) — remplace le « Chargement… »
// texte : sur données locales, un skeleton se ressent instantané, pas un spinner.
function LedgerSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
    >
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-6 w-32" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: i === 0 ? undefined : "1px solid var(--border-subtle)" }}
        >
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
