"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowBendUpLeft,
  ArrowBendUpRight,
  Check,
  Clock,
  Copy,
  Eye,
  NotePencil,
  Stack,
  Tray,
  User,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { voieColor, type Destin, type DestinKind } from "@/lib/mail-destins";

const ROW = 34;
const TRACK_W = 76;

const KIND: Record<DestinKind, { icon: ReactNode; hint: string }> = {
  libre: { icon: <Tray size={14} />, hint: "pas encore de destin" },
  repondre: { icon: <ArrowBendUpLeft size={14} />, hint: "on attend ta réponse, pas encore de destin" },
  lot: { icon: <Stack size={14} />, hint: "même sujet, plusieurs personnes" },
  avec: { icon: <User size={14} />, hint: "à voir avec" },
  reunion: { icon: <UsersThree size={14} />, hint: "ordre du jour" },
  delegue: { icon: <ArrowBendUpRight size={14} />, hint: "délégué" },
  quand: { icon: <Clock size={14} />, hint: "échéance" },
  note: { icon: <NotePencil size={14} />, hint: "écrit par toi, pour toi" },
  info: { icon: <Eye size={14} />, hint: "rien à faire" },
};

const color = (d: Destin) => voieColor(d.kind, d.title);

/**
 * Aiguillage : la boîte vue comme une gare de triage. Chaque fil part sur la voie de
 * son destin (à voir avec X, pour telle réunion, délégué, note à soi…), lu dans les
 * labels que l'utilisateur a déjà créés. Aucune IA : ce qui est affiché est vérifiable.
 * Choisir une voie filtre la liste principale : la liste est le quai.
 */
export function MailAiguillage({
  destins,
  voieId,
  onPickVoie,
}: {
  destins: readonly Destin[];
  /** Voie qui filtre la liste, ou null. */
  voieId: string | null;
  onPickVoie: (id: string | null) => void;
}) {
  // Les fils sans destin restent dans la liste : pas de voie « à aiguiller », le tri est fait à la main.
  const voies = useMemo(() => destins.filter((d) => d.items.length > 0 && d.kind !== "libre"), [destins]);
  const open = voies.find((d) => d.id === voieId) ?? null;

  const height = voies.length * ROW;
  const total = destins.reduce((n, d) => n + d.items.length, 0);
  const peak = Math.max(1, ...voies.map((d) => d.items.length));

  return (
    <section aria-label="Aiguillage : chaque mail sur la voie de son destin" className="flex shrink-0 flex-col">
      <header className="flex items-end justify-between gap-3 border-b px-4 pb-2.5 pt-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
            Aiguillage
          </h2>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
            un mail, un destin
          </p>
        </div>
        <span className="flex flex-col items-end gap-[3px] font-mono leading-none tabular-nums">
          <span className="text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
            boîte entière
          </span>
          <span className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {total}
          </span>
        </span>
      </header>

      <div className="relative shrink-0 px-2 py-2">
        <svg
          aria-hidden
          width={TRACK_W}
          height={height}
          viewBox={`0 0 ${TRACK_W} ${height}`}
          className="pointer-events-none absolute left-2 top-2"
          fill="none"
        >
          {voies.map((d, i) => {
            const y = i * ROW + ROW / 2;
            const y0 = height / 2;
            const path = `M 8 ${y0} C ${TRACK_W * 0.55} ${y0}, ${TRACK_W * 0.45} ${y}, ${TRACK_W} ${y}`;
            const n = d.items.length;
            const c = color(d);
            const lit = open?.id === d.id;
            return (
              <g key={d.id} opacity={open && !lit ? 0.55 : 1}>
                <path d={path} stroke={c} strokeOpacity="0.4" strokeWidth={1 + 9 * (n / peak)} strokeLinecap="round" />
                <path d={path} stroke={c} strokeWidth={lit ? 1.6 : 1} strokeDasharray="3 13" strokeLinecap="round" className="sn-track-flow" />
              </g>
            );
          })}
          <circle cx="8" cy={height / 2} r="5" fill="var(--surface-0)" stroke="var(--text-primary)" strokeWidth="1.5" />
        </svg>

        <ul className="flex flex-col" style={{ paddingLeft: TRACK_W }}>
          {voies.map((d) => {
            const n = d.items.length;
            const lit = open?.id === d.id;
            return (
              <li key={d.id} style={{ height: ROW }}>
                <Button
                  variant="ghost"
                  aria-pressed={lit}
                  aria-label={`${d.title} : ${n} fil(s), ${KIND[d.kind].hint}`}
                  className="h-full min-h-0 w-full justify-start gap-2 rounded-md px-2 text-left"
                  style={lit ? { backgroundColor: "var(--surface-2)", boxShadow: `inset 2px 0 0 0 ${color(d)}` } : undefined}
                  onPress={() => onPickVoie(lit ? null : d.id)}
                >
                  <span aria-hidden className="flex shrink-0" style={{ color: color(d) }}>
                    {KIND[d.kind].icon}
                  </span>
                  <span
                    className={`min-w-0 truncate text-[13px] ${n > 0 ? "font-medium" : ""}`}
                    style={{ color: n > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    {d.title}
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate text-[11px] @sm:block" style={{ color: "var(--text-muted)" }}>
                    {KIND[d.kind].hint}
                  </span>
                  <span
                    className="ml-auto shrink-0 font-mono text-[13px] font-semibold tabular-nums"
                    style={{ color: n === 0 ? "var(--text-muted)" : d.kind === "repondre" ? "var(--sn-ember-ink)" : "var(--text-primary)" }}
                  >
                    {n}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

    </section>
  );
}

/** Bandeau au-dessus de la liste quand une voie la filtre : ce qu'on regarde, copier en ordre du jour, sortir. */
export function VoieBanner({ voie, onClear }: { voie: Destin; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = [`${voie.title} — ${voie.items.length} point(s)`, ...voie.items.map((it) => `- ${it.subject || "(sans objet)"} (${it.from.name || it.from.email})`)].join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="flex items-center gap-2 border-b px-4 py-1" style={{ borderColor: "var(--border)" }}>
      <span aria-hidden className="flex shrink-0" style={{ color: color(voie) }}>
        {KIND[voie.kind].icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
        Voie « {voie.title} » · {voie.items.length}
        <span className="font-normal" style={{ color: "var(--text-muted)" }}>
          {" "}
          · {KIND[voie.kind].hint}
        </span>
      </span>
      <Button variant="ghost" size="sm" className="sn-hit h-8 min-h-8 shrink-0 gap-1.5 px-2 text-[12px]" onPress={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        Ordre du jour
      </Button>
      <Tooltip content="Revoir toute la boîte">
        <Button variant="ghost" size="icon" aria-label="Revoir toute la boîte" className="sn-hit h-8 min-h-8 w-8 min-w-8 shrink-0" onPress={onClear}>
          <X size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}
