"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, CaretDown, CaretRight, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFinanceLoans } from "@/components/finance/hooks";
import type { Loan } from "@/components/finance/fixtures";
import {
  formatCurrency,
  formatDate,
  getLoanMonthlyPayment,
  getLoanRemainingPrincipal,
  getLoanEndDate,
} from "@/components/finance/utils";
import { computeAmortizationSchedule } from "@supernote/finance/amortization";
import { trpc } from "@/lib/trpc/client";

const KIND_LABELS: Record<string, string> = {
  mortgage: "Immobilier",
  consumer: "Conso",
  personal: "Personnel",
  auto: "Auto",
  student: "Etudiant",
  other: "Autre",
};

const KIND_COLORS: Record<string, string> = {
  mortgage: "#7C3AED",
  auto: "#D97706",
  consumer: "#2563EB",
  personal: "#059669",
  student: "#0891B2",
  other: "#64748B",
};

function AmortizationTable({ loan }: { loan: Loan }) {
  const schedule = computeAmortizationSchedule({
    principal: loan.principal,
    annualRate: loan.annualRate,
    termMonths: loan.termMonths,
    startDate: new Date(loan.startDate),
  });
  const first12 = schedule.slice(0, 12);

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-subtle)" }}>
      <table className="min-w-[480px] w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: "var(--surface-2)" }}>
            {["#", "Date", "Mensualite", "Capital", "Interets", "Restant"].map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first12.map((row) => (
            <tr key={row.period} className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-muted)" }}>{row.period}</td>
              <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{formatDate(row.date.toISOString())}</td>
              <td className="px-3 py-2 font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(row.payment)}</td>
              <td className="px-3 py-2 tabular-nums" style={{ color: "var(--success)" }}>{formatCurrency(row.principal)}</td>
              <td className="px-3 py-2 tabular-nums" style={{ color: "var(--danger)" }}>{formatCurrency(row.interest)}</td>
              <td className="px-3 py-2 tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(row.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {schedule.length > 12 && (
        <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)", backgroundColor: "var(--surface-2)" }}>
          + {schedule.length - 12} lignes supplémentaires (tableau tronqué à 12 mois)
        </p>
      )}
    </div>
  );
}

function LoanRow({ loan }: { loan: Loan }) {
  const [expanded, setExpanded] = useState(false);
  const monthly = getLoanMonthlyPayment(loan);
  const remaining = getLoanRemainingPrincipal(loan);
  const endDate = getLoanEndDate(loan);
  const color = KIND_COLORS[loan.kind] ?? "#64748B";
  const paidPct = loan.principal > 0 ? ((loan.principal - remaining) / loan.principal) * 100 : 0;

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border-subtle)" }}>
      <Link
        href={`/finance/prets/${loan.id}`}
        className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-[var(--surface-2)]"
        style={{ backgroundColor: "var(--surface-1)" }}
      >
        <button
          className="flex-shrink-0"
          style={{ color: "var(--text-muted)" }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? "Réduire" : "Développer"}
        >
          {expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
        </button>
        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{loan.name}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {KIND_LABELS[loan.kind] ?? loan.kind} · {loan.lender} · {(loan.annualRate * 100).toFixed(2).replace(".", ",")} %
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--danger)" }}>{formatCurrency(remaining)}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>restant / {formatCurrency(loan.principal)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{formatCurrency(monthly)} / mois</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>fin {formatDate(endDate.toISOString())}</p>
        </div>
        <div className="w-24">
          <div className="mb-1 flex justify-between text-xs">
            <span style={{ color: "var(--text-muted)" }}>Remboursé</span>
            <span style={{ color: "var(--text-secondary)" }}>{paidPct.toFixed(0)} %</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--surface-3)" }}>
            <div className="h-full rounded-full" style={{ width: `${paidPct}%`, backgroundColor: color }} />
          </div>
        </div>
      </Link>
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--border-subtle)" }}>
          <p className="mb-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Tableau d&apos;amortissement (12 premiers mois)
          </p>
          <AmortizationTable loan={loan} />
        </div>
      )}
    </div>
  );
}

export default function PretsPage() {
  const isMobile = useIsMobile();
  const { loans, isLoading, isFallback } = useFinanceLoans();

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "loan" });
    },
  });
  const handleNewLoan = useCallback(async () => {
    try {
      await createMutation.mutateAsync({
        typeId: "loan",
        fields: { name: "Nouveau prêt", amount: 0, rate: 0 },
      });
    } catch (err) {
      console.error("[finance/prets] create failed", err);
    }
  }, [createMutation]);

  useMobileTitle(isMobile ? "Prêts" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouveau prêt", onPress: () => void handleNewLoan() }
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
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Prêts</h1>
          {isFallback && (
            <span className="text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}>
              mode dégradé
            </span>
          )}
        </div>
        <button
          onClick={() => void handleNewLoan()}
          disabled={createMutation.isPending}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Prêt
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
      ) : loans.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Pas encore de données financières. Importer OFX/CSV ou ajouter un prêt.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {loans.map((loan) => <LoanRow key={loan.id} loan={loan} />)}
          </div>
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Total capital restant dû
            </p>
            <p className="mt-1 text-2xl font-bold" style={{ color: "var(--danger)" }}>
              {formatCurrency(loans.reduce((s, l) => s + getLoanRemainingPrincipal(l), 0))}
            </p>
          </div>
        </>
      )}
    </div>
    </AppShell>
  );
}
