"use client";

import type { Loan } from "./fixtures";
import { formatCurrency, formatDate, getLoanMonthlyPayment, getLoanRemainingPrincipal } from "./utils";

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

function getNextPayments(loan: Loan) {
  const today = new Date();
  const payments: { date: Date; amount: number }[] = [];
  const monthly = getLoanMonthlyPayment(loan);
  let d = new Date(loan.startDate);
  d.setMonth(d.getMonth() + 1);
  while (d <= today) {
    d = new Date(d);
    d.setMonth(d.getMonth() + 1);
  }
  for (let i = 0; i < 3; i++) {
    const pd = new Date(d);
    pd.setMonth(pd.getMonth() + i);
    payments.push({ date: pd, amount: monthly });
  }
  return payments;
}

interface LoanTimelineProps {
  loans: Loan[];
}

export function LoanTimeline({ loans }: LoanTimelineProps) {
  if (loans.length === 0) {
    return (
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
      >
        <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Echéances de prêts — 3 prochains mois
        </h3>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun prêt enregistré.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <h3 className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Echéances de prêts — 3 prochains mois
      </h3>
      <div className="flex flex-col gap-6">
        {loans.map((loan) => {
          const payments = getNextPayments(loan);
          const remaining = getLoanRemainingPrincipal(loan);
          const color = KIND_COLORS[loan.kind] ?? "#64748B";
          return (
            <div key={loan.id}>
              <div className="mb-2 flex items-center gap-2">
                <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  {loan.name}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {KIND_LABELS[loan.kind] ?? loan.kind} · {loan.lender}
                </span>
                <span className="ml-auto text-xs font-medium" style={{ color: "var(--danger)" }}>
                  Restant : {formatCurrency(remaining)}
                </span>
              </div>
              <div className="flex gap-3">
                {payments.map((p, i) => (
                  <div
                    key={i}
                    className="flex flex-1 flex-col items-center rounded-lg border py-2"
                    style={{ borderColor: color + "40", backgroundColor: color + "10" }}
                  >
                    <span className="text-xs font-semibold" style={{ color }}>
                      {formatCurrency(p.amount)}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatDate(p.date.toISOString())}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
