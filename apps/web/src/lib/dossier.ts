import { contactEmails } from "@/lib/contact-from-email";

export const DOSSIER_MAX_ITEMS = 200;

// Un site sur un webmail ferait entrer toute la boîte dans le dossier.
const WEBMAIL = /^(gmail\.com|googlemail\.com|outlook\.[a-z.]+|hotmail\.[a-z.]+|live\.[a-z.]+|yahoo\.[a-z.]+|orange\.fr|free\.fr|icloud\.com|me\.com|laposte\.net|wanadoo\.fr|sfr\.fr|protonmail\.com|proton\.me)$/;

export interface EntityRef {
  id: string;
  typeId: string;
  fields: Record<string, unknown>;
}

export interface DossierScope {
  entityIds: string[];
  emails: string[];
  domain: string | null;
}

export type DossierKind = "mail" | "note" | "event" | "commitment" | "todo" | "interaction";

export interface DossierItem {
  key: string;
  kind: DossierKind;
  at: number;
  title: string;
  meta: string;
  url: string | null;
  upcoming?: boolean;
}

export interface DossierSection {
  id: string;
  title: string;
  items: DossierItem[];
}

export function websiteDomain(website: unknown): string | null {
  if (typeof website !== "string" || !website.trim()) return null;
  try {
    const url = new URL(website.includes("://") ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") && !WEBMAIL.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function dossierScope(entity: EntityRef, personnes: EntityRef[]): DossierScope {
  if (entity.typeId !== "organisation") {
    return { entityIds: [entity.id], emails: contactEmails(entity.fields), domain: null };
  }
  const members = personnes.filter((p) => p.fields["organisationId"] === entity.id);
  return {
    entityIds: [entity.id, ...members.map((m) => m.id)],
    emails: [...new Set(members.flatMap((m) => contactEmails(m.fields)))],
    domain: websiteDomain(entity.fields["website"]),
  };
}

export function matchesScope(scope: DossierScope, email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  return scope.emails.includes(e) || (!!scope.domain && e.endsWith(`@${scope.domain}`));
}

function monthTitle(at: number): string {
  return new Date(at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

/** « À venir » d'abord (du plus proche au plus lointain), puis le passé groupé par mois, du plus récent au plus ancien. */
export function buildDossier(items: DossierItem[], now = Date.now()): DossierSection[] {
  const unique = [...new Map(items.map((i) => [i.key, i])).values()];
  const upcoming = unique.filter((i) => i.upcoming && i.at >= now).sort((a, b) => a.at - b.at);
  const past = unique
    .filter((i) => !(i.upcoming && i.at >= now) && i.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, DOSSIER_MAX_ITEMS);
  const undated = unique.filter((i) => i.at <= 0);
  const sections: DossierSection[] = [];
  if (upcoming.length > 0) sections.push({ id: "upcoming", title: "À venir", items: upcoming });
  for (const item of past) {
    const title = monthTitle(item.at);
    const last = sections[sections.length - 1];
    if (last && last.id !== "upcoming" && last.title === title) last.items.push(item);
    else sections.push({ id: `m-${title}`, title, items: [item] });
  }
  if (undated.length > 0) sections.push({ id: "undated", title: "Sans date", items: undated });
  return sections;
}
