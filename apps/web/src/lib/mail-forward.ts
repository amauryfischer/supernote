/**
 * mail-forward — helpers PURS pour transférer (forward) un message Gmail : sujet
 * « Fwd: » et corps avec en-tête « Message transféré » + métadonnées du message
 * d'origine. Aucune I/O : le pré-remplissage du compose vit dans la VUE
 * (`EmailThreadView` → `app/mail/page.tsx`), l'envoi réel dans `gmail.ts`.
 */

import { classifyBubble, type EmailAddress, type EmailMessage } from "./gmail";
import type { ReplyParams } from "./mail-reply";

/** Fil d'origine d'un transfert : il y part, comme depuis Gmail web. */
export type ForwardThread = Pick<ReplyParams, "threadId" | "inReplyTo" | "references">;

// Gmail « Fwd: », Outlook « TR: » (fr) / « FW: » (en).
const FORWARD_SUBJECT_RE = /^\s*(fwd?|tr)\s*:/i;

/** Préfixe « Fwd: » si absent (insensible à la casse, tolère les espaces). */
export function buildForwardSubject(subject: string): string {
  const s = (subject ?? "").trim();
  if (!s) return "Fwd:";
  return /^fwd\s*:/i.test(s) ? s : `Fwd: ${s}`;
}

/** Liste lisible de destinataires « Nom <email> » ou « email », jointe par « , ». */
function formatRecipients(message: EmailMessage): string {
  return message.to
    .map((a) => {
      const email = a.email?.trim() ?? "";
      const name = a.name?.trim() ?? "";
      if (name && email) return `${name} <${email}>`;
      return name || email;
    })
    .filter((s) => s.length > 0)
    .join(", ");
}

/** Expéditeur lisible : « Nom <email> », ou seulement l'un des deux. */
function formatSender(message: EmailMessage): string {
  const email = message.from.email?.trim() ?? "";
  const name = message.from.name?.trim() ?? "";
  if (name && email) return `${name} <${email}>`;
  return name || email;
}

/**
 * Corps d'un transfert : bloc « ---------- Message transféré ---------- » suivi
 * des en-têtes (De / Date / Objet / À), une ligne vide, puis le corps texte du
 * message d'origine (`bodyText`, sinon `snippet`). Les en-têtes vides sont quand
 * même listés (clé « De: » etc.) pour rester lisible et stable côté test. Pur.
 */
export function buildForwardedBody(message: EmailMessage): string {
  const header = "---------- Message transféré ----------";
  const lines = [
    header,
    `De: ${formatSender(message)}`,
    `Date: ${message.date ?? ""}`,
    `Objet: ${message.subject ?? ""}`,
    `À: ${formatRecipients(message)}`,
    "",
    message.bodyText || message.snippet || "",
  ];
  return lines.join("\n");
}

export interface ForwardMark {
  by: EmailAddress;
  to: EmailAddress[];
  date: string;
}

/**
 * Transferts visibles dans le fil, indexés par id du message transféré. Un
 * transfert (Gmail web, ou l'app qui l'envoie dans le fil d'origine) désigne
 * son original par `References` ; sans correspondance, c'est le message qui le
 * précède. Le 1ᵉʳ message n'est jamais un transfert : un fil peut s'ouvrir sur
 * un « TR: » reçu. Pur.
 */
export function forwardMarks(messages: EmailMessage[]): Map<string, ForwardMark[]> {
  const marks = new Map<string, ForwardMark[]>();
  messages.forEach((fwd, i) => {
    if (i === 0 || !FORWARD_SUBJECT_RE.test(fwd.subject)) return;
    const earlier = messages.slice(0, i);
    const original =
      earlier.findLast((m) => m.messageId && fwd.references?.includes(m.messageId)) ?? earlier.at(-1);
    if (!original) return;
    marks.set(original.id, [...(marks.get(original.id) ?? []), { by: fwd.from, to: fwd.to, date: fwd.date }]);
  });
  return marks;
}

/**
 * Pastille « Transféré à X » (noms ou partie locale, avec l'auteur quand ce
 * n'est pas soi) ; adresses complètes et date dans `title`.
 */
export function forwardLabel(mark: ForwardMark, selfEmail?: string): { label: string; title: string } {
  // Adresse nue : `parseAddress` recopie l'email dans `name`.
  const who = (a: EmailAddress) => (a.name && a.name !== a.email ? a.name : a.email.split("@")[0]);
  const by = classifyBubble(mark.by.email, selfEmail) === "mine" ? "" : ` par ${who(mark.by)}`;
  const short = mark.to.map(who).join(", ");
  const full = mark.to.map((a) => a.email).join(", ");
  const when = mark.date ? ` · ${new Date(mark.date).toLocaleString()}` : "";
  return { label: `Transféré${by} à ${short}`, title: `Transféré${by} à ${full}${when}` };
}
