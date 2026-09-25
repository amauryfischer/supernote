"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarBlank, CheckSquare, Envelope, Handshake, NoteBlank, Users } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import type { DossierItem, DossierKind, EntityRef } from "@/lib/dossier";
import { useDossier } from "./useDossier";

type Filter = "all" | "mail" | "note" | "event" | "commitment";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "mail", label: "Mails" },
  { id: "note", label: "Notes" },
  { id: "event", label: "Rendez-vous" },
  { id: "commitment", label: "Engagements" },
];

const ICONS: Record<DossierKind, typeof Envelope> = {
  mail: Envelope,
  note: NoteBlank,
  event: CalendarBlank,
  commitment: Handshake,
  todo: CheckSquare,
  interaction: Users,
};

function keep(item: DossierItem, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "commitment") return item.kind === "commitment" || item.kind === "todo";
  return item.kind === filter;
}

function shortDate(at: number): string {
  return at ? new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
}

// `!` : le CSS HeroUI de .button est hors @layer et gagne sinon sur les utilitaires Tailwind.
function Row({ item }: { item: DossierItem }) {
  const navigate = useNavigate();
  const Icon = ICONS[item.kind];
  const body = (
    <>
      <Icon size={16} aria-hidden className="shrink-0" style={{ color: "var(--text-muted)" }} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
          {item.title}
        </span>
        {item.meta && (
          <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {item.meta}
          </span>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
        {shortDate(item.at)}
      </span>
    </>
  );
  if (!item.url) return <div className="flex min-h-11 items-center gap-3 px-2">{body}</div>;
  const url = item.url;
  return (
    <Button
      variant="ghost"
      onPress={() => navigate(url)}
      className="flex h-auto! min-h-11 w-full! min-w-0 items-center justify-start! gap-3 px-2! py-1.5 font-normal!"
    >
      {body}
    </Button>
  );
}

/** Tout ce qui concerne la personne ou l'organisation, en un fil. Calculé, jamais écrit. */
export function DossierTab({ entity, name }: { entity: EntityRef; name: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const { sections, loading } = useDossier(entity);
  const visible = sections
    .map((s) => ({ ...s, items: s.items.filter((i) => keep(i, filter)) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer le dossier">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "secondary" : "ghost"}
            aria-pressed={filter === f.id}
            className="min-h-8"
            onPress={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {loading && visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement du dossier…</p>
      )}
      {!loading && visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {filter === "all"
            ? `Rien encore avec ${name}. Les mails, notes et rendez-vous apparaîtront ici.`
            : `Rien dans « ${FILTERS.find((f) => f.id === filter)?.label} » pour ${name}.`}
        </p>
      )}

      {visible.map((s) => (
        <section key={s.id} aria-label={s.title} className="flex flex-col gap-0.5">
          <span className="sn-eyebrow sn-eyebrow--compact px-2 capitalize">{s.title}</span>
          {s.items.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}
