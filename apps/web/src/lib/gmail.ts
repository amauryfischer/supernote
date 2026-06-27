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

/**
 * Nombre de fils NON LUS en boîte de réception, pour le compteur discret de la
 * nav latérale (« Mail »).
 *
 * Source choisie : `labels.get` sur le label système `INBOX` → champ
 * `threadsUnread` (un seul appel REST léger, valeur déjà agrégée par Gmail). On
 * privilégie `threadsUnread` plutôt que `messagesUnread` car toute l'UI Mail
 * raisonne en FILS (la liste, le triage, le marquage-lu agissent au thread). Le
 * scope `gmail.readonly` déjà demandé suffit (pas de nouveau consentement). On
 * borne à `>= 0` par prudence (un payload partiel renvoie 0 = pas de badge).
 */
export async function getInboxUnreadCount(clientId: string): Promise<number> {
  const json = await gmailFetch<{ threadsUnread?: number; messagesUnread?: number }>(
    clientId,
    "/labels/INBOX",
  );
  const n = json.threadsUnread ?? json.messagesUnread ?? 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ─── Types & parseurs purs (P1) ───────────────────────────────────────────────

export interface EmailAddress {
  name: string;
  email: string;
}

/**
 * Pièce jointe d'un message (part avec `filename` non vide ET `body.attachmentId`).
 * `data` n'est PAS inclus : on télécharge le contenu à la demande via
 * `fetchAttachment(clientId, messageId, attachmentId)` (les parts `format=full`
 * ne renvoient que les métadonnées, pas les octets des grosses pièces jointes).
 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  /** Id du message porteur (nécessaire pour l'appel `messages/{id}/attachments/...`). */
  messageId: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  date: string; // ISO, "" si non parsable
  snippet: string;
  bodyText: string; // text/plain (toujours présent : chemin texte/citation/signature)
  /**
   * Corps text/html du 1ᵉʳ part HTML, décodé (base64url + quoted-printable +
   * normalisation), NON sanitizé (sanitization déléguée à la VUE via DOMPurify,
   * jamais stocké/rendu tel quel). Absent si le message n'a pas de part HTML
   * (chemin texte conservé). Voir `findHtml`.
   */
  bodyHtml?: string;
  webLink: string;
  /** Pièces jointes (métadonnées seules ; contenu téléchargé à la demande). */
  attachments: EmailAttachment[];
  /** Message-ID RFC822 (sert d'In-Reply-To/References pour une réponse threadée). */
  messageId?: string;
  references?: string;
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
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
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

/**
 * Trouve récursivement le premier corps text/html dans l'arbre des parts, décodé
 * (base64url → quoted-printable si requis → normalisation des espaces), exactement
 * comme `findPlainText` mais ciblant `text/html`. Renvoie `undefined` si aucune
 * part HTML — le chemin texte reste le défaut.
 *
 * NB : le contenu N'EST PAS sanitizé ici (pur, pas de DOM côté worker/lib). La
 * sanitization (DOMPurify) se fait à l'affichage. On ne descend jamais dans un
 * mono-part binaire (image/pdf) — on ne renverrait que du HTML si la part est
 * explicitement `text/html`.
 */
function findHtml(part: GmailPart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === "text/html" && part.body?.data) return decodePartText(part);
  for (const sub of part.parts ?? []) {
    const found = findHtml(sub);
    if (found) return found;
  }
  return undefined;
}

/**
 * Collecte récursivement les pièces jointes d'un arbre de parts : toute part
 * dotée d'un `filename` non vide ET d'un `body.attachmentId` (les pièces jointes
 * "vraies", par opposition aux corps text/plain ou html inline). On ne descend
 * jamais dans le contenu : `data` n'est pas exposé (téléchargé à la demande).
 * Pur, testable.
 */
function collectAttachments(part: GmailPart | undefined, messageId: string): EmailAttachment[] {
  if (!part) return [];
  const out: EmailAttachment[] = [];
  const filename = (part.filename ?? "").trim();
  const attachmentId = part.body?.attachmentId;
  if (filename && attachmentId) {
    out.push({
      filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
      attachmentId,
      messageId,
    });
  }
  for (const sub of part.parts ?? []) {
    out.push(...collectAttachments(sub, messageId));
  }
  return out;
}

function toIsoDate(raw: string): string {
  if (!raw) return "";
  const t = Date.parse(raw);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

export function parseGmailMessage(raw: GmailRawMessage): EmailMessage {
  const p = raw.payload;
  const toRaw = header(p, "To");
  const bodyHtml = findHtml(p);
  const msg: EmailMessage = {
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
    attachments: collectAttachments(p, raw.id),
    messageId: header(p, "Message-ID") || header(p, "Message-Id"),
    references: header(p, "References"),
  };
  // Propriété optionnelle : on ne l'attache que si une part HTML existe (les
  // consommateurs testent `bodyHtml` en présence → chemin HTML, sinon texte).
  if (bodyHtml) msg.bodyHtml = bodyHtml;
  return msg;
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

/** Une page de résultats `threads.list` : les items + le curseur page suivante. */
export interface ThreadsPage {
  items: ThreadSummary[];
  /** Curseur opaque à repasser en `pageToken` ; absent = plus de page. */
  nextPageToken?: string;
}

/**
 * Recherche paginée de threads via la syntaxe Gmail (`q`). Renvoie la page +
 * `nextPageToken` (curseur opaque Gmail). `pageToken` charge une page suivante.
 * Base de `searchThreads` (qui n'expose que les items, rétro-compatible).
 */
export async function searchThreadsPage(
  clientId: string,
  query: string,
  opts: { maxResults?: number; pageToken?: string } = {},
): Promise<ThreadsPage> {
  const maxResults = opts.maxResults ?? 20;
  const token = opts.pageToken ? `&pageToken=${encodeURIComponent(opts.pageToken)}` : "";
  const qs = `?q=${encodeURIComponent(query)}&maxResults=${maxResults}${token}`;
  const json = await gmailFetch<{
    threads?: Array<{ id: string; snippet?: string }>;
    nextPageToken?: string;
  }>(clientId, `/threads${qs}`);
  return {
    items: (json.threads ?? []).map((t) => ({ id: t.id, snippet: t.snippet ?? "" })),
    nextPageToken: json.nextPageToken,
  };
}

/**
 * Recherche de threads via la syntaxe Gmail (`q`) : `from:`, `is:unread`,
 * `subject:`, `after:`, etc. `maxResults` borne la page (défaut 20). Variante
 * historique (items uniquement) : pour paginer, voir `searchThreadsPage`.
 */
export async function searchThreads(
  clientId: string,
  query: string,
  maxResults = 20,
): Promise<ThreadSummary[]> {
  const page = await searchThreadsPage(clientId, query, { maxResults });
  return page.items;
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
 * Plafond de requêtes Gmail concurrentes lors de l'enrichissement d'une page
 * (un `format=metadata` par thread). Gmail limite les requêtes EN VOL par
 * utilisateur : tout lancer d'un coup (`Promise.all` sur 50 items) renvoie un
 * 429 « Too many concurrent requests for user » (RESOURCE_EXHAUSTED). On draine
 * par pool borné.
 */
const GMAIL_METADATA_CONCURRENCY = 6;

/**
 * `map` borné en concurrence : exécute `fn` sur chaque item avec au plus `limit`
 * requêtes en vol, en PRÉSERVANT l'ordre des résultats. Évite le 429 « requêtes
 * concurrentes » de l'API Gmail quand une page enrichit beaucoup de threads.
 */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
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

/** Page enrichie de threads (items affichables) + curseur page suivante. */
export interface ThreadListPage {
  items: ThreadListItem[];
  /** Curseur opaque à repasser en `pageToken` ; absent = plus de page. */
  nextPageToken?: string;
}

/**
 * Variante paginée de `listThreadSummaries` : recherche + enrichit une page de
 * threads (sujet/expéditeur/date) et renvoie le `nextPageToken`. `pageToken`
 * charge la page suivante. 1 appel `threads.list` + N `format=metadata`
 * (parallèles), N borné par `maxResults`.
 */
export async function listThreadSummariesPage(
  clientId: string,
  query: string,
  opts: { maxResults?: number; pageToken?: string } = {},
): Promise<ThreadListPage> {
  const page = await searchThreadsPage(clientId, query, opts);
  // Pool borné (pas `Promise.all` brut) → évite le 429 « too many concurrent
  // requests » quand `maxResults` est élevé (ex. 50).
  const items = await mapPool(page.items, GMAIL_METADATA_CONCURRENCY, (t) =>
    getThreadListItem(clientId, t.id),
  );
  return { items, nextPageToken: page.nextPageToken };
}

/**
 * Recherche + enrichit chaque thread (sujet/expéditeur/date) pour un affichage
 * façon boîte mail. 1 appel `threads.list` + N appels `format=metadata`
 * (parallèles). N borné par `maxResults`. Variante historique (items uniquement) :
 * pour paginer (« Charger plus »), voir `listThreadSummariesPage`.
 */
export async function listThreadSummaries(
  clientId: string,
  query: string,
  maxResults = 20,
): Promise<ThreadListItem[]> {
  const page = await listThreadSummariesPage(clientId, query, { maxResults });
  return page.items;
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
 * Marque un thread comme lu : retire le label système `UNREAD` de tous ses
 * messages via `threads.modify`. Scope `gmail.modify`. Idempotent côté Gmail
 * (retirer un label déjà absent est un no-op).
 */
export function markThreadRead(clientId: string, threadId: string): Promise<void> {
  return modifyThreadLabels(clientId, threadId, { removeLabelIds: ["UNREAD"] });
}

/**
 * Marque un thread comme NON lu : ajoute le label système `UNREAD` à tous ses
 * messages via `threads.modify`. Scope `gmail.modify`. Idempotent côté Gmail
 * (ajouter un label déjà présent est un no-op). Symétrique de `markThreadRead`.
 */
export function markThreadUnread(clientId: string, threadId: string): Promise<void> {
  return modifyThreadLabels(clientId, threadId, { addLabelIds: ["UNREAD"] });
}

/**
 * Étoile / dé-étoile un thread : ajoute ou retire le label système `STARRED` de
 * tous ses messages via `threads.modify`. Scope `gmail.modify`. `starred=true`
 * ajoute l'étoile, `false` la retire. Idempotent côté Gmail.
 */
export function toggleStar(clientId: string, threadId: string, starred: boolean): Promise<void> {
  return modifyThreadLabels(
    clientId,
    threadId,
    starred ? { addLabelIds: ["STARRED"] } : { removeLabelIds: ["STARRED"] },
  );
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

/**
 * Restaure un thread depuis la corbeille Gmail via `threads.untrash` (inverse de
 * `trashThread`). Scope `gmail.modify`. Le thread retiré de TRASH n'est PAS
 * automatiquement remis dans l'inbox — l'appelant qui veut le re-afficher en
 * boîte de réception doit aussi ré-ajouter le label `INBOX` (voir l'undo de
 * triage côté page Mail). Sert au mécanisme « Annuler » après une suppression.
 */
export async function untrashThread(clientId: string, threadId: string): Promise<void> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_MODIFY_SCOPE, prompt: "" });
  const res = await fetch(`${GMAIL_API_BASE}/threads/${encodeURIComponent(threadId)}/untrash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail untrash ${res.status}: ${text.slice(0, 300)}`);
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

/**
 * Pièce jointe à JOINDRE à un message sortant (réponse / brouillon / compose).
 * `base64` = contenu encodé base64 STANDARD (pas base64url ; tel que produit par
 * `FileReader.readAsDataURL` après retrait du préfixe `data:`). Distinct de
 * `EmailAttachment` (entrant, métadonnées seules, téléchargé à la demande).
 */
export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  /** Contenu en base64 standard (avec ou sans padding ; ré-emballé en lignes de 76). */
  base64: string;
}

/** Génère un boundary MIME unique (préfixe lisible + aléa). Pur (hors `Math.random`). */
function makeBoundary(): string {
  return `=_supernote_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Re-emballe une chaîne base64 en lignes de 76 caractères (RFC 2045). Pur. */
function wrapBase64(b64: string): string {
  const clean = b64.replace(/[\r\n]/g, "");
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += 76) out.push(clean.slice(i, i + 76));
  return out.join("\r\n");
}

/**
 * Neutralise une valeur d'en-tête : retire CR, LF et caractères de contrôle pour
 * empêcher l'injection d'en-têtes (CRLF injection). Critique car certaines
 * valeurs proviennent d'emails REÇUS donc non fiables (Message-ID/References
 * recopiés dans In-Reply-To/References d'une réponse). Un `\r\n` non filtré
 * permettrait d'injecter un `Bcc:`/`Content-Type:` arbitraire. Pur.
 */
function sanitizeHeaderValue(value: string): string {
  // CR (0x0D), LF (0x0A) et tous les autres caractères de contrôle (0x00-0x1F, 0x7F).
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, "");
}

/** Échappe les guillemets/backslash d'un nom de fichier pour un header MIME. */
function quoteFilename(name: string): string {
  // Neutralise d'abord CR/LF/contrôle (anti-injection) puis échappe " et \.
  return sanitizeHeaderValue(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Construit un message RFC 2822 pour `drafts.create` / `messages.send`.
 *
 * Sans pièce jointe : message MONO-PART `text/plain; charset=UTF-8` (chemin
 * historique inchangé, rétro-compatible). Avec une ou plusieurs pièces jointes :
 * message `multipart/mixed` — une 1ʳᵉ part `text/plain` (le corps), puis une part
 * par pièce jointe (`Content-Type: <mime>; name=…`, `Content-Transfer-Encoding:
 * base64`, `Content-Disposition: attachment; filename=…`, octets base64 en lignes
 * de 76). Pur, testable.
 */
export function buildRawMessage(input: {
  to?: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
}): string {
  const headers: string[] = [];
  // Anti-injection d'en-têtes : on retire CR/LF/contrôle de TOUTES les valeurs
  // d'en-tête avant assemblage (cf. sanitizeHeaderValue). In-Reply-To/References
  // viennent d'emails reçus (Message-ID non fiable) → strictement à filtrer.
  const to = sanitizeHeaderValue(formatRecipients(input.to));
  if (to) headers.push(`To: ${to}`);
  const cc = sanitizeHeaderValue(formatRecipients(input.cc));
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${encodeHeaderWord(sanitizeHeaderValue(input.subject))}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`);
  if (input.references) headers.push(`References: ${sanitizeHeaderValue(input.references)}`);
  headers.push("MIME-Version: 1.0");

  const attachments = (input.attachments ?? []).filter((a) => a && a.base64);
  if (attachments.length === 0) {
    // Chemin historique mono-part : aucune régression sur l'envoi sans PJ.
    return [...headers, 'Content-Type: text/plain; charset="UTF-8"', "", input.body].join("\r\n");
  }

  const boundary = makeBoundary();
  const lines: string[] = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, ""];
  // Part 1 : le corps texte.
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(input.body);
  // Une part par pièce jointe.
  for (const att of attachments) {
    const mime = att.mimeType || "application/octet-stream";
    const name = quoteFilename(att.filename || "piece-jointe");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${mime}; name="${name}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${name}"`);
    lines.push("");
    lines.push(wrapBase64(att.base64));
  }
  lines.push(`--${boundary}--`);
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
  input: {
    to?: string | string[];
    cc?: string | string[];
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: OutgoingAttachment[];
  },
): Promise<DraftResult> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_COMPOSE_SCOPE, prompt: "" });
  const raw = toBase64Url(buildRawMessage(input));
  const message: { raw: string; threadId?: string } = { raw };
  if (input.threadId) message.threadId = input.threadId;
  const res = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
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

/**
 * Envoie un message (réponse) DANS un thread via `messages.send`. Scope
 * `gmail.compose` (qui autorise l'envoi). ⚠️ IRRÉVERSIBLE : le mail part
 * immédiatement (contrairement aux brouillons). `threadId` rattache la réponse
 * au fil ; `inReplyTo`/`references` assurent le threading côté autres clients.
 */
export async function sendReply(
  clientId: string,
  input: {
    threadId: string;
    to?: string | string[];
    cc?: string | string[];
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    attachments?: OutgoingAttachment[];
  },
): Promise<void> {
  const token = await requestAccessToken(clientId, { scope: GMAIL_COMPOSE_SCOPE, prompt: "" });
  const raw = toBase64Url(buildRawMessage(input));
  const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, threadId: input.threadId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail send ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ─── Pièces jointes (téléchargement) ──────────────────────────────────────────

/**
 * Télécharge le contenu d'une pièce jointe : `GET
 * /messages/{messageId}/attachments/{attachmentId}`. Renvoie le `body.data`
 * (base64url) — à décoder via `base64UrlToBytes`. Scope `gmail.readonly` suffit
 * (lecture seule).
 */
export async function fetchAttachment(
  clientId: string,
  messageId: string,
  attachmentId: string,
): Promise<{ data: string }> {
  const json = await gmailFetch<{ data?: string; size?: number }>(
    clientId,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  return { data: json.data ?? "" };
}

/** Décode du base64url (Gmail) en octets bruts (binaire, sans hypothèse UTF-8). */
export function base64UrlToBytes(data: string): Uint8Array {
  if (!data) return new Uint8Array(0);
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Formate une taille en octets de façon lisible (B / Ko / Mo / Go). Base 1024,
 * 1 décimale au-delà du kilo. Pur, testable.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  const rounded = exp === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exp]}`;
}

/**
 * Télécharge une pièce jointe et déclenche un téléchargement navigateur (Blob du
 * bon mimeType → `<a download>`). Effet de bord DOM — non pur. Le contenu n'est
 * JAMAIS interprété comme HTML (Blob brut), donc pas de surface XSS.
 */
export async function downloadAttachment(
  clientId: string,
  attachment: EmailAttachment,
): Promise<void> {
  const { data } = await fetchAttachment(clientId, attachment.messageId, attachment.attachmentId);
  const bytes = base64UrlToBytes(data);
  // Copie dans un ArrayBuffer propre pour satisfaire BlobPart (évite SharedArrayBuffer).
  const buf = bytes.slice().buffer;
  const blob = new Blob([buf], {
    type: attachment.mimeType || "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = attachment.filename || "piece-jointe";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
