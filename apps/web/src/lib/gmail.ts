/**
 * Client Gmail API — lecture (P1). Décalque `google-drive.ts` : OAuth GIS
 * client-side, token en mémoire (caché par scope, voir requestAccessToken),
 * fetch REST direct (CORS) sur gmail.googleapis.com. Réutilise le Client ID
 * Google configuré dans Settings → Google Drive.
 *
 * Scope `gmail.readonly` = scope RESTRICTED Google → en mode "testing" le
 * consentement affiche un bandeau "app non vérifiée" et le token expire après
 * 7 jours (re-login). On demande ce scope par consentement INCRÉMENTAL (token
 * client séparé de Drive) pour ne pas forcer les utilisateurs Drive-only.
 */

import { requestAccessToken } from "./google-drive";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Récupère un token Gmail (consentement incrémental, scope readonly). */
function gmailToken(clientId: string, prompt: "" | "consent" | "none" = ""): Promise<string> {
  return requestAccessToken(clientId, { scope: GMAIL_READONLY_SCOPE, prompt });
}

async function gmailFetch<T>(clientId: string, path: string): Promise<T> {
  const token = await gmailToken(clientId);
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Lance explicitement le consentement Gmail (bouton "Connecter"). */
export async function connectGmail(clientId: string): Promise<void> {
  await gmailToken(clientId, "consent");
}

/** Adresse du compte connecté (affichage settings). */
export async function getGmailProfile(clientId: string): Promise<string> {
  const json = await gmailFetch<{ emailAddress?: string }>(clientId, "/profile");
  return json.emailAddress ?? "";
}

// ─── Types & parseurs purs (P1) ───────────────────────────────────────────────

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  date: string; // ISO, "" si non parsable
  snippet: string;
  bodyText: string; // text/plain uniquement en P1 (pas de HTML)
  webLink: string;
}

export interface GmailRawMessage {
  id: string;
  threadId: string;
  snippet?: string;
  payload?: GmailPart;
}

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

/** Décode le base64url Gmail (- _ , pas de padding) en chaîne UTF-8. */
export function decodeBody(data: string): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** Parse "Nom <email>" ou "email" en {name,email}. */
export function parseAddress(raw: string): EmailAddress {
  const s = raw.trim();
  if (!s) return { name: "", email: "" };
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1]!.trim().replace(/^"|"$/g, ""), email: m[2]!.trim() };
  return { name: s, email: s };
}

function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Trouve récursivement le premier corps text/plain dans l'arbre des parts. */
function findPlainText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data);
  for (const sub of part.parts ?? []) {
    const found = findPlainText(sub);
    if (found) return found;
  }
  // Fallback : payload mono-part text/plain (ou sans mimeType explicite). On
  // NE décode PAS un mono-part binaire (image/pdf/octet-stream) — sinon on
  // renverrait du charabia comme corps.
  if (!part.parts && part.body?.data && (!part.mimeType || part.mimeType === "text/plain")) {
    return decodeBody(part.body.data);
  }
  return "";
}

function toIsoDate(raw: string): string {
  if (!raw) return "";
  const t = Date.parse(raw);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

export function parseGmailMessage(raw: GmailRawMessage): EmailMessage {
  const p = raw.payload;
  const toRaw = header(p, "To");
  return {
    id: raw.id,
    threadId: raw.threadId,
    subject: header(p, "Subject"),
    from: parseAddress(header(p, "From")),
    // Limite P1 connue : split naïf sur "," → une virgule dans un nom affiché
    // entre guillemets ("Nom, Prénom" <a@b>) casse la liste. Acceptable : rare,
    // n'affecte que l'affichage des destinataires (pas la sécurité ni le corps).
    to: toRaw ? toRaw.split(",").map((a) => parseAddress(a)) : [],
    date: toIsoDate(header(p, "Date")),
    snippet: raw.snippet ?? "",
    bodyText: findPlainText(p),
    webLink: `https://mail.google.com/mail/u/0/#all/${raw.id}`,
  };
}
