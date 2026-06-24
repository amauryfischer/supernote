import type { EmailMessage } from "@/lib/gmail";

/** Sources de valeur extractibles d'un email pour le mapping de capture. */
export type EmailFieldSource = "subject" | "fromName" | "fromEmail" | "date" | "snippet" | "body";

/** Libellés UI des sources email. */
export const EMAIL_FIELD_SOURCE_LABELS: Record<EmailFieldSource, string> = {
  subject: "Sujet",
  fromName: "Expéditeur (nom)",
  fromEmail: "Expéditeur (email)",
  date: "Date",
  snippet: "Extrait",
  body: "Corps",
};

/** Valeur (string) d'une source email donnée. Date = ISO. */
export function emailSourceValue(msg: EmailMessage, src: EmailFieldSource): string {
  switch (src) {
    case "subject": return msg.subject;
    case "fromName": return msg.from.name;
    case "fromEmail": return msg.from.email;
    case "date": return msg.date;
    case "snippet": return msg.snippet;
    case "body": return msg.bodyText;
  }
}

/** Compose le corps markdown d'une note de capture (en-tête + corps + lien). */
export function emailToMarkdown(msg: EmailMessage): string {
  const date = msg.date ? new Date(msg.date).toLocaleString() : "";
  const lines = [
    `**De :** ${msg.from.name}${msg.from.email ? ` <${msg.from.email}>` : ""}`,
    date ? `**Date :** ${date}` : "",
    msg.subject ? `**Sujet :** ${msg.subject}` : "",
    "",
    msg.bodyText || msg.snippet,
    "",
    `[Ouvrir dans Gmail](${msg.webLink})`,
  ];
  return lines.filter((l) => l !== "").join("\n\n");
}

interface MappableField {
  name: string;
  label: string;
  type: string;
}

/**
 * Auto-mappe les champs d'une base vers des sources email par heuristique
 * (nom + type). Champs non text/date/email → non mappés (""). L'utilisateur
 * ajuste ensuite.
 */
export function autoMapBaseFields(fields: MappableField[]): Record<string, EmailFieldSource | ""> {
  const map: Record<string, EmailFieldSource | ""> = {};
  for (const f of fields) {
    const n = `${f.name} ${f.label}`.toLowerCase();
    const t = f.type;
    let src: EmailFieldSource | "" = "";
    if (t === "email") src = "fromEmail";
    else if (t === "date" || t === "datetime") src = "date";
    else if (t === "text" || t === "longtext" || t === "markdown") {
      if (/titre|title|sujet|subject|name|nom/.test(n)) src = "subject";
      else if (/expéd|from|exp\b|sender/.test(n)) src = "fromName";
      else if (/mail/.test(n)) src = "fromEmail";
      else if (/corps|body|contenu|content|message|note/.test(n)) src = "body";
      else if (/extrait|snippet|résumé|apercu|aperçu/.test(n)) src = "snippet";
    }
    map[f.name] = src;
  }
  return map;
}
