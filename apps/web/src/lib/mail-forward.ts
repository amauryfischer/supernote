/**
 * mail-forward — helpers PURS pour transférer (forward) un message Gmail : sujet
 * « Fwd: » et corps avec en-tête « Message transféré » + métadonnées du message
 * d'origine. Aucune I/O : le pré-remplissage du compose vit dans la VUE
 * (`EmailThreadView` → `app/mail/page.tsx`), l'envoi réel dans `gmail.ts`.
 */

import type { EmailMessage } from "./gmail";

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
