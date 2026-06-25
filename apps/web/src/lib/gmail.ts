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
  labelIds?: string[];
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

/**
 * Décode un corps quoted-printable (RFC 2045) en chaîne UTF-8.
 *
 * Certaines parts text/plain remontent encore encodées en quoted-printable
 * (selon le client émetteur) une fois le base64url Gmail décodé : `=20`=espace,
 * `=C3=A9`=« é », et le « soft line break » (`=` en toute fin de ligne) qui doit
 * être supprimé avec le saut de ligne. Sans ce décodage, les espaces et accents
 * apparaissent mal parsés (« =20 », « =C3=A9 », lignes recollées à `=`).
 *
 * On décode octet par octet pour reconstituer l'UTF-8 multi-octets, puis on
 * applique TextDecoder. Les `=XX` invalides sont laissés tels quels (robuste).
 * Pur.
 */
export function decodeQuotedPrintable(text: string): string {
  if (!text) return "";
  // Soft line breaks : "=" suivi d'un CRLF/LF en fin de ligne → suppression.
  const unfolded = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < unfolded.length; i++) {
    const ch = unfolded[i]!;
    if (ch === "=" && i + 2 < unfolded.length) {
      const hex = unfolded.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    // Caractère littéral : ASCII → octet brut ; non-ASCII résiduel → UTF-8.
    // (Le QP n'émet que de l'ASCII ; on reste robuste si du non-ASCII traîne.)
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out.push(code);
    } else {
      for (const b of encoder.encode(ch)) out.push(b);
    }
  }
  return new TextDecoder("utf-8").decode(Uint8Array.from(out));
}

/**
 * Détecte une chaîne (déjà base64-décodée) qui est en réalité encore encodée en
 * quoted-printable : présence de soft line breaks ou de séquences `=XX`
 * hexadécimales. Heuristique conservatrice — pas de `=` isolé déclencheur.
 */
function looksQuotedPrintable(text: string): boolean {
  return /=\r?\n/.test(text) || /=[0-9A-Fa-f]{2}/.test(text);
}

/**
 * Normalise les espaces d'un corps texte pour un affichage correct :
 *  - NBSP (U+00A0) et NBSP étroit (U+202F) → espace normal ;
 *  - espaces/tabs en fin de ligne supprimés ;
 *  - CRLF → LF.
 * Conserve les retours à la ligne (pas de réécriture du flux). Pur.
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[  ]/g, " ")
    .replace(/[ \t]+$/gm, "");
}

/** Parse "Nom <email>" ou "email" en {name,email}. */
export function parseAddress(raw: string): EmailAddress {
  const s = raw.trim();
  if (!s) return { name: "", email: "" };
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1]!.trim().replace(/^"|"$/g, ""), email: m[2]!.trim() };
  return { name: s, email: s };
}

/** Catégorie d'un message dans l'affichage chat (couleur + alignement). */
export type BubbleKind = "mine" | "internal" | "external";

/** Domaine (minuscule) d'une adresse, "" si pas de "@" exploitable. */
function emailDomain(email: string): string {
  const s = (email ?? "").trim().toLowerCase();
  const at = s.lastIndexOf("@");
  return at >= 0 && at < s.length - 1 ? s.slice(at + 1) : "";
}

/**
 * Classe un expéditeur vis-à-vis du compte connecté, pour l'affichage chat :
 *  - "mine"     : expéditeur === compte connecté (priorité absolue).
 *  - "internal" : même domaine que le compte connecté (collègue interne).
 *  - "external" : le reste (ou `selfEmail` absent / sans domaine).
 * Insensible à la casse. Pur, testable. Le domaine « interne » est dérivé du
 * compte connecté — aucun domaine codé en dur.
 */
export function classifyBubble(fromEmail: string, selfEmail: string | undefined): BubbleKind {
  const from = (fromEmail ?? "").trim().toLowerCase();
  const self = (selfEmail ?? "").trim().toLowerCase();
  if (self && from === self) return "mine";
  const selfDomain = emailDomain(self);
  if (selfDomain && emailDomain(from) === selfDomain) return "internal";
  return "external";
}

function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/**
 * Décode le corps d'une part : base64url Gmail, puis quoted-printable si le
 * Content-Transfer-Encoding l'impose (ou détection heuristique), puis
 * normalisation des espaces (NBSP, fins de ligne). Centralise la chaîne de
 * décodage pour que TOUTES les parts text/plain remontées soient propres.
 */
function decodePartText(part: GmailPart): string {
  let text = decodeBody(part.body!.data!);
  const cte = header(part, "Content-Transfer-Encoding").toLowerCase();
  if (cte === "quoted-printable" || (cte === "" && looksQuotedPrintable(text))) {
    text = decodeQuotedPrintable(text);
  }
  return normalizeWhitespace(text);
}

/** Trouve récursivement le premier corps text/plain dans l'arbre des parts. */
function findPlainText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodePartText(part);
  for (const sub of part.parts ?? []) {
    const found = findPlainText(sub);
    if (found) return found;
  }
  // Fallback : payload mono-part text/plain (ou sans mimeType explicite). On
  // NE décode PAS un mono-part binaire (image/pdf/octet-stream) — sinon on
  // renverrait du charabia comme corps.
  if (!part.parts && part.body?.data && (!part.mimeType || part.mimeType === "text/plain")) {
    return decodePartText(part);
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

// ─── Thread search & read (P1) ────────────────────────────────────────────────

export interface ThreadSummary {
  id: string;
  snippet: string;
}

export interface EmailThread {
  id: string;
  messages: EmailMessage[];
  /** Union dédupliquée des labelIds de tous les messages du thread. */
  labelIds: string[];
}

/** Union dédupliquée des labelIds d'un ensemble de messages (pur, testable). */
export function unionLabelIds(messages: Array<{ labelIds?: string[] }>): string[] {
  return [...new Set(messages.flatMap((m) => m.labelIds ?? []))];
}

/**
 * Recherche de threads via la syntaxe Gmail (`q`) : `from:`, `is:unread`,
 * `subject:`, `after:`, etc. `maxResults` borne la page (défaut 20).
 */
export async function searchThreads(
  clientId: string,
  query: string,
  maxResults = 20,
): Promise<ThreadSummary[]> {
  const qs = `?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const json = await gmailFetch<{ threads?: Array<{ id: string; snippet?: string }> }>(
    clientId,
    `/threads${qs}`,
  );
  return (json.threads ?? []).map((t) => ({ id: t.id, snippet: t.snippet ?? "" }));
}

/** Lit un thread complet (format=full) et parse chaque message. */
export async function getThread(clientId: string, threadId: string): Promise<EmailThread> {
  const json = await gmailFetch<{ id: string; messages?: GmailRawMessage[] }>(
    clientId,
    `/threads/${encodeURIComponent(threadId)}?format=full`,
  );
  const rawMsgs = json.messages ?? [];
  return {
    id: json.id,
    messages: rawMsgs.map((m) => parseGmailMessage(m)),
    labelIds: unionLabelIds(rawMsgs),
  };
}

/** Ligne de liste enrichie d'un thread (pour l'affichage façon boîte mail). */
export interface ThreadListItem {
  id: string;
  subject: string;
  from: EmailAddress;
  date: string;
  snippet: string;
  labelIds: string[];
}

/**
 * Métadonnées légères d'un thread (Subject/From/Date du message le plus récent)
 * via `format=metadata` — bien plus léger que `format=full`. Utilisé pour
 * peupler la liste de gauche.
 */
async function getThreadListItem(clientId: string, threadId: string): Promise<ThreadListItem> {
  const json = await gmailFetch<{ id: string; snippet?: string; messages?: GmailRawMessage[] }>(
    clientId,
    `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
  );
  const msgs = json.messages ?? [];
  const last = msgs[msgs.length - 1];
  const parsed = last ? parseGmailMessage(last) : null;
  const labelIds = unionLabelIds(msgs);
  return {
    id: threadId,
    subject: parsed?.subject || "(sans objet)",
    from: parsed?.from ?? { name: "", email: "" },
    date: parsed?.date ?? "",
    snippet: json.snippet ?? parsed?.snippet ?? "",
    labelIds,
  };
}

/**
 * Recherche + enrichit chaque thread (sujet/expéditeur/date) pour un affichage
 * façon boîte mail. 1 appel `threads.list` + N appels `format=metadata`
 * (parallèles). N borné par `maxResults`.
 */
export async function listThreadSummaries(
  clientId: string,
  query: string,
  maxResults = 20,
): Promise<ThreadListItem[]> {
  const threads = await searchThreads(clientId, query, maxResults);
  return Promise.all(threads.map((t) => getThreadListItem(clientId, t.id)));
}

// ─── Labels (P2) ─────────────────────────────────────────────────────────────

export interface GmailLabelColor {
  textColor: string;
  backgroundColor: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  /** Couleur Gmail (palette fixe) si l'utilisateur en a défini une ; sinon absente. */
  color?: GmailLabelColor;
}

/** Labels utilisateur (exclut les labels système Gmail). `color` inclus par labels.list. */
export async function listLabels(clientId: string): Promise<GmailLabel[]> {
  const json = await gmailFetch<{
    labels?: Array<{
      id: string;
      name: string;
      type?: string;
      color?: { textColor?: string; backgroundColor?: string };
    }>;
  }>(clientId, "/labels");
  return (json.labels ?? [])
    .filter((l) => l.type === "user")
    .map((l) => {
      const bg = l.color?.backgroundColor;
      return bg
        ? {
            id: l.id,
            name: l.name,
            color: { backgroundColor: bg, textColor: l.color?.textColor ?? "#ffffff" },
          }
        : { id: l.id, name: l.name };
    });
}

/**
 * Résout des labelIds (bruts, incluant les systèmes) en labels utilisateur
 * affichables, en s'appuyant sur la liste des labels utilisateur. Les labels
 * système (INBOX, UNREAD, CATEGORY_*, SENT…) sont naturellement écartés car
 * absents de `userLabels`. Pur, testable. Préserve l'ordre de `userLabels`.
 */
export function resolveUserLabels(labelIds: string[], userLabels: GmailLabel[]): GmailLabel[] {
  const set = new Set(labelIds);
  return userLabels.filter((l) => set.has(l.id));
}

/**
 * Scope `gmail.modify` (RESTRICTED) — requis pour AJOUTER/RETIRER des labels.
 * Demandé en consentement INCRÉMENTAL à la 1ʳᵉ mutation (mode testing : bandeau
 * "app non vérifiée", token 7 j). Token caché séparément (cache per-scope).
 */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/**
 * Ajoute/retire des labels sur TOUS les messages d'un thread via
 * `threads.modify`. Token scope `modify` (consentement paresseux au 1ᵉʳ appel).
 */
export async function modifyThreadLabels(
  clientId: string,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_MODIFY_SCOPE, prompt: "" });
  const res = await fetch(`${GMAIL_API_BASE}/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      addLabelIds: changes.addLabelIds ?? [],
      removeLabelIds: changes.removeLabelIds ?? [],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail modify ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** Raccourci : ajoute un label à un thread. */
export function addThreadLabel(clientId: string, threadId: string, labelId: string): Promise<void> {
  return modifyThreadLabels(clientId, threadId, { addLabelIds: [labelId] });
}

/** Raccourci : retire un label d'un thread. */
export function removeThreadLabel(clientId: string, threadId: string, labelId: string): Promise<void> {
  return modifyThreadLabels(clientId, threadId, { removeLabelIds: [labelId] });
}

/**
 * Met un thread entier à la corbeille Gmail via `threads.trash` (RÉVERSIBLE :
 * Gmail conserve 30 j, restaurable). Scope `gmail.modify`. On évite le DELETE
 * permanent (qui exigerait le scope complet `https://mail.google.com/`).
 */
export async function trashThread(clientId: string, threadId: string): Promise<void> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_MODIFY_SCOPE, prompt: "" });
  const res = await fetch(`${GMAIL_API_BASE}/threads/${encodeURIComponent(threadId)}/trash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail trash ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ─── Primitives compose (P3) ──────────────────────────────────────────────────

export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

/** Bytes UTF-8 → base64 standard (binaire via btoa). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Chaîne UTF-8 → base64url sans padding (inverse de decodeBody). */
export function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Encode un en-tête non-ASCII en mot encodé RFC 2047 (=?UTF-8?B?…?=). */
function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(value)) return value;
  const b64 = bytesToBase64(new TextEncoder().encode(value));
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Normalise un ou plusieurs destinataires en valeur d'en-tête `To` (séparés
 * par ", "). Trim chaque adresse, ignore les vides. Rétro-compatible : une
 * simple chaîne reste inchangée.
 */
export function formatRecipients(to: string | string[] | undefined): string {
  if (!to) return "";
  const list = Array.isArray(to) ? to : [to];
  return list
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .join(", ");
}

/** Construit un message RFC 2822 (texte brut UTF-8) pour `drafts.create`. */
export function buildRawMessage(input: { to?: string | string[]; subject: string; body: string }): string {
  const lines: string[] = [];
  const to = formatRecipients(input.to);
  if (to) lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodeHeaderWord(input.subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("");
  lines.push(input.body);
  return lines.join("\r\n");
}

export interface DraftResult {
  draftId: string;
}

/**
 * Crée un brouillon Gmail (jamais d'envoi). Scope `gmail.compose` demandé en
 * incrémental (consentement au 1ᵉʳ appel). Le message raw est un RFC 2822
 * encodé base64url. L'utilisateur relit/envoie depuis Gmail.
 */
export async function createDraft(
  clientId: string,
  input: { to?: string | string[]; subject: string; body: string },
): Promise<DraftResult> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_COMPOSE_SCOPE, prompt: "" });
  const raw = toBase64Url(buildRawMessage(input));
  const res = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail draft ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("Réponse Gmail inattendue : brouillon sans id.");
  }
  return { draftId: json.id };
}

/** URL web d'un brouillon Gmail (à ouvrir après création). */
export function buildGmailDraftUrl(draftId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(draftId)}`;
}
