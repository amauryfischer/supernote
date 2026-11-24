"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowBendUpLeft,
  ArrowBendUpRight,
  Check,
  Clock,
  Copy,
  Eye,
  ListChecks,
  NotePencil,
  PaperPlaneTilt,
  Stack,
  Tray,
  User,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { isSelfAddress } from "@/lib/mail-awaiting";
import { voieColor, type Destin, type DestinKind } from "@/lib/mail-destins";

const ROW = 34;
const TRACK_W = 76;

const KIND: Record<DestinKind, { icon: ReactNode; hint: string }> = {
  libre: { icon: <Tray size={14} />, hint: "pas encore de destin" },
  repondre: { icon: <ArrowBendUpLeft size={14} />, hint: "on attend ta réponse, pas encore de destin" },
  lot: { icon: <Stack size={14} />, hint: "même sujet" },
  avec: { icon: <User size={14} />, hint: "à voir avec" },
  reunion: { icon: <UsersThree size={14} />, hint: "ordre du jour" },
  delegue: { icon: <ArrowBendUpRight size={14} />, hint: "délégué" },
  quand: { icon: <Clock size={14} />, hint: "échéance" },
  note: { icon: <NotePencil size={14} />, hint: "de toi à toi" },
  info: { icon: <Eye size={14} />, hint: "rien à faire" },
};

const color = (d: Destin) => voieColor(d.kind, d.title);

/** Sur une voie qui attend quelqu'un, l'âge du fil le plus ancien dit qui relancer. */
function voieHint(d: Destin, spoken = false): string {
  const hint = KIND[d.kind].hint;
  if (d.items.length === 0 || (d.kind !== "delegue" && d.kind !== "avec")) return hint;
  const oldest = Math.min(...d.items.map((it) => Date.parse(it.date)).filter(Number.isFinite));
  const days = Math.floor((Date.now() - oldest) / 86_400_000);
  return days < 1 ? hint : spoken ? `${hint}, plus ancien fil ${days} j` : `${hint} · ${days} j`;
}

// « À répondre » sans label n'est pas un destin : la section « À toi » le compte déjà, une voie de plus donnerait deux chiffres.
const hasVoie = (d: Destin) => d.items.length > 0 && d.kind !== "libre" && d.kind !== "repondre";

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
  bare = false,
}: {
  destins: readonly Destin[];
  /** Voie qui filtre la liste, ou null. */
  voieId: string | null;
  onPickVoie: (id: string | null) => void;
  /** Dans une feuille déjà titrée : pas de second en-tête. */
  bare?: boolean;
}) {
  const voies = useMemo(() => destins.filter(hasVoie), [destins]);
  const open = voies.find((d) => d.id === voieId) ?? null;

  const height = voies.length * ROW;
  const total = destins.reduce((n, d) => n + d.items.length, 0);
  const sansVoie = total - voies.reduce((n, d) => n + d.items.length, 0);
  const peak = Math.max(1, ...voies.map((d) => d.items.length));

  return (
    <section aria-label="Aiguillage : chaque mail sur la voie de son destin" className="flex shrink-0 flex-col">
      {!bare && (
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
            <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              {sansVoie > 0 ? `tous onglets · ${sansVoie} sans voie` : "tous onglets"}
            </span>
            <span className="text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {total}
            </span>
          </span>
        </header>
      )}

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
                  aria-label={`${d.title} : ${n} fil(s), ${voieHint(d, true)}`}
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
                  <span className="hidden min-w-0 flex-1 truncate text-[11px] @[17rem]:block" style={{ color: "var(--text-muted)" }}>
                    {voieHint(d)}
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

/** Une ligne d'ordre du jour : l'objet sans le préfixe qui redit la voie (« À voir avec X — »), puis le résumé ou l'expéditeur. */
function agendaLine(it: Destin["items"][number], summary: string | undefined, selfEmails: readonly string[]): string {
  const subject = (it.subject || "(sans objet)").replace(/^\s*(re|tr|fwd?)\s*:\s*/i, "").replace(/^\s*[àa] voir avec\s+\S+\s*[—–:-]\s*/i, "").trim();
  const detail = summary?.trim() || (isSelfAddress(it.from.email, selfEmails) ? "" : it.from.name || it.from.email);
  return `- [ ] ${subject}${detail ? ` — ${detail}` : ""}`;
}

/** Bandeau au-dessus de la liste quand une voie la filtre : ce qu'on regarde, copier en ordre du jour, sortir. */
export function VoieBanner({
  voie,
  selfEmails,
  summaries,
  onClear,
  onArchiveAll,
  onTaskAll,
  onWrite,
}: {
  voie: Destin;
  selfEmails: readonly string[];
  /** Résumé d'une ligne par fil, quand l'IA l'a produit : il part dans l'ordre du jour copié. */
  summaries?: ReadonlyMap<string, string>;
  onClear: () => void;
  /** « Pour info » n'appelle aucune action : toute la pile se range d'un geste. */
  onArchiveAll?: () => void;
  /** « Notes à moi » : ce sont des tâches, pas du courrier. Absent tant que les vraies notes à soi ne sont pas connues. */
  onTaskAll?: () => void;
  /** Voie d'une personne : lui écrire la liste des points, plutôt que la recopier. */
  onWrite?: (title: string, body: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const points = () => voie.items.map((it) => agendaLine(it, summaries?.get(it.id), selfEmails).replace(/^- \[ \] /, "- ")).join("\n");
  const copy = () => {
    const text = [`${voie.title} — ${voie.items.length} point(s)`, ...voie.items.map((it) => agendaLine(it, summaries?.get(it.id), selfEmails))].join("\n");
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
        <span className="hidden font-normal md:inline" style={{ color: "var(--text-muted)" }}>
          {" "}
          · {voieHint(voie)}
        </span>
      </span>
      {voie.kind === "info" && onArchiveAll ? (
        <Button variant="ghost" size="sm" className="sn-hit h-8 min-h-8 shrink-0 gap-1.5 px-2 text-[12px]" onPress={onArchiveAll}>
          <Archive size={14} />
          Tout ranger
        </Button>
      ) : voie.kind === "note" && onTaskAll ? (
        <Button variant="ghost" size="sm" className="sn-hit h-8 min-h-8 shrink-0 gap-1.5 px-2 text-[12px]" onPress={onTaskAll}>
          <ListChecks size={14} />
          Tout en tâches
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="sn-hit h-8 min-h-8 shrink-0 gap-1.5 px-2 text-[12px]" onPress={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          Ordre du jour
        </Button>
      )}
      {onWrite && (voie.kind === "avec" || voie.kind === "delegue") && (
        <Tooltip content={`Écrire ces points à ${voie.title}`}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Écrire ces points à ${voie.title}`}
            className="sn-hit h-8 min-h-8 w-8 min-w-8 shrink-0"
            onPress={() => onWrite(voie.title, `Bonjour ${voie.title},\n\nLes points que j'aimerais voir avec toi :\n\n${points()}\n`)}
          >
            <PaperPlaneTilt size={14} />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Revoir toute la boîte">
        <Button variant="ghost" size="icon" aria-label="Revoir toute la boîte" className="sn-hit h-8 min-h-8 w-8 min-w-8 shrink-0" onPress={onClear}>
          <X size={14} />
        </Button>
      </Tooltip>
    </div>
  );
}

/** Sur téléphone, les voies tiennent en un ruban au-dessus de la liste : l'aiguillage reste à un geste, sans passer par un menu. */
export function VoieStrip({ destins, onPickVoie }: { destins: readonly Destin[]; onPickVoie: (id: string) => void }) {
  const voies = destins.filter(hasVoie);
  if (voies.length === 0) return null;
  return (
    <div role="group" aria-label="Voies : filtrer la liste par destin" className="flex shrink-0 gap-1.5 overflow-x-auto px-4 py-2">
      {voies.map((d) => (
        <Button
          key={d.id}
          variant="outline"
          size="sm"
          aria-label={`${d.title} : ${d.items.length} fil(s), ${voieHint(d, true)}`}
          className="sn-hit h-8 min-h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-[12px]"
          onPress={() => onPickVoie(d.id)}
        >
          <span aria-hidden className="flex" style={{ color: color(d) }}>
            {KIND[d.kind].icon}
          </span>
          {d.title}
          <span className="font-mono tabular-nums" style={{ color: "var(--text-muted)" }}>
            {d.items.length}
          </span>
        </Button>
      ))}
    </div>
  );
}
