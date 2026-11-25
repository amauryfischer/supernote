import { senderHue } from "@/lib/mail-avatar";

/** Destin d'un mail : ce qu'il va devenir, pas quand il est arrivé. */
export type DestinKind = "libre" | "repondre" | "lot" | "avec" | "reunion" | "delegue" | "quand" | "note" | "info";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lit le destin que l'utilisateur a déjà codé dans le nom de ses labels (« voir avec paul », « codir », « todo melvin »…). */
export function classifyLabel(name: string): { kind: DestinKind; title: string } | null {
  const n = name.trim();
  if (/^(todo\/\d|supernote\/)/i.test(n)) return null;
  const avec = /^voir avec\s+(.+)$/i.exec(n);
  if (avec) return { kind: "avec", title: cap(avec[1]!) };
  const todo = /^todo\s+(.+)$/i.exec(n);
  if (todo && !/^perso$/i.test(todo[1]!)) return { kind: "delegue", title: cap(todo[1]!) };
  if (/(codir|coger|daily|copil|cse|1-1|entretien|r[ée]union|comit[ée]|hebdo)/i.test(n)) return { kind: "reunion", title: cap(n) };
  if (/d[ée]veloppement/i.test(n)) return { kind: "delegue", title: cap(n.replace(/d[ée]veloppement/i, "dev")) };
  if (/(week-?end|urgent|[àa] faire|r[ée]pondre|demain|semaine)/i.test(n)) return { kind: "quand", title: cap(n) };
  return null;
}

const KIND_HUE: Partial<Record<DestinKind, number>> = { lot: 190, reunion: 215, delegue: 150, quand: 45, note: 265 };

/** Couleur d'une voie : la teinte de la personne pour « avec X », une teinte fixe par nature sinon. */
export function voieColor(kind: DestinKind, title: string): string {
  if (kind === "repondre") return "var(--sn-ember)";
  if (kind === "avec") return `hsl(${senderHue(title)} 70% 50%)`;
  const hue = KIND_HUE[kind];
  return hue === undefined ? "var(--text-muted)" : `hsl(${hue} 60% 52%)`;
}

console.assert(classifyLabel("voir avec aurelia")?.title === "Aurelia" && classifyLabel("todo melvin")?.kind === "delegue");
console.assert(classifyLabel("CSE-todo")?.kind === "reunion" && classifyLabel("Factures") === null && classifyLabel("Todo/1 Faire") === null);
