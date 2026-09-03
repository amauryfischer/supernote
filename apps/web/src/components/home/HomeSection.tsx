"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button, Skeleton } from "@supernote/ui";

/**
 * Grammaire commune des bandes de l'accueil : un en-tête `.sn-eyebrow` posé sur
 * un filet, puis des rangées à même la colonne de contenu. Pas de `Card` — la
 * page est une feuille, pas une pile de boîtes.
 */

export interface HomeSectionProps {
  title: string;
  /** Badge ou compteur affiché juste après le titre. */
  meta?: ReactNode;
  action?: { label: string; href: string };
  className?: string;
  children: ReactNode;
}

export function HomeSection({ title, meta, action, className, children }: HomeSectionProps) {
  return (
    <section className={className}>
      <div
        className="mb-1.5 flex items-center gap-2 border-b pb-1.5"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <h2 className="sn-eyebrow">{title}</h2>
        {meta}
        {action && (
          <Link
            href={action.href}
            prefetch={false}
            className="ml-auto shrink-0 rounded-[var(--radius-sm)] text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Rangée de liste partagée par Aujourd'hui / Reprendre / Ce jour-là. */
export const HOME_ROW_CLASS =
  "-mx-2 flex min-h-[40px] items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-2 transition-colors hover:bg-[var(--surface-2)] md:min-h-0 md:py-1.5";

const SKELETON_WIDTHS = ["w-[78%]", "w-[62%]", "w-[70%]", "w-[48%]"];

export function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5 py-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}`}
        />
      ))}
    </div>
  );
}

export interface SectionNoticeProps {
  children: ReactNode;
  action?: { label: string; onClick: () => void };
  /** Pastille d'état devant le message (erreur uniquement). */
  tone?: "muted" | "danger";
}

export function SectionNotice({ children, action, tone = "muted" }: SectionNoticeProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <p
        className="flex items-center gap-2 text-[13px]"
        style={{ color: tone === "danger" ? "var(--text-secondary)" : "var(--text-muted)" }}
      >
        {tone === "danger" && (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--danger)" }}
          />
        )}
        {children}
      </p>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
