"use client";

import type { ReactNode } from "react";
import { ArrowBendUpLeft } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import { shortName, type TourDeTable as Tour } from "@/lib/mail-tour";

const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

/** Suivi d'une demande à plusieurs : qui a répondu, qui manque, relance des silencieux. */
export function TourDeTable({
  tour,
  onRemind,
  children,
}: {
  tour: Tour;
  onRemind?: (emails: string[]) => void;
  children?: ReactNode;
}) {
  const done = !tour.open && tour.missing.length === 0;
  const age = days(tour.askedAt);
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
    >
      <span className="flex flex-col gap-[3px] font-mono leading-none tabular-nums" style={{ color: "var(--text-muted)" }}>
        <span className="text-[9px] uppercase tracking-[0.08em]">{tour.open ? "Voix" : "Tour de table"}</span>
        <span className="text-[15px] font-semibold" style={{ color: done ? "var(--text-secondary)" : "var(--sn-ember-ink)" }}>
          {tour.open ? tour.asked.length : `${tour.answered.length}/${tour.asked.length}`}
        </span>
      </span>
      <ul className="flex min-w-[11rem] flex-1 flex-wrap gap-1.5" aria-label="Réponses à ta demande">
        {tour.asked.map((a) => {
          const answered = !tour.open && tour.answered.includes(a);
          const plain = tour.open;
          return (
            <li
              key={a.email}
              title={plain ? a.name || a.email : `${a.name || a.email} — ${answered ? "a répondu" : `sans réponse depuis ${age} j`}`}
              className="flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs"
              style={{
                borderColor: answered || plain ? "var(--border-subtle)" : "color-mix(in oklab, var(--sn-ember) 45%, transparent)",
                color: answered ? "var(--text-muted)" : "var(--text-primary)",
              }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: answered || plain ? "var(--text-muted)" : "var(--sn-ember)" }}
              />
              <span className={answered ? "line-through decoration-[var(--border-strong,var(--text-muted))]" : "font-medium"}>{shortName(a)}</span>
              {!plain && <span className="sr-only">{answered ? "a répondu" : "n'a pas répondu"}</span>}
            </li>
          );
        })}
      </ul>
      {tour.open ? null : done ? (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Tout le monde a répondu
        </span>
      ) : (
        onRemind && (
          <Button variant="outline" size="sm" onPress={() => onRemind(tour.missing.map((a) => a.email))}>
            <ArrowBendUpLeft size={14} aria-hidden />
            Relancer {tour.missing.length === 1 ? shortName(tour.missing[0]!) : `les ${tour.missing.length}`}
          </Button>
        )
      )}
      {children}
    </div>
  );
}
