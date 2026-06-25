/**
 * email-to-event — transforme un EmailMessage en évènement de calendrier.
 *
 * Pur, sans I/O, sans scope OAuth. Deux sorties :
 *  - `buildGoogleCalendarUrl(message)` : une URL « TEMPLATE » Google Agenda
 *    pré-remplie (titre = sujet, détails = extrait + lien Gmail) qu'on ouvre
 *    dans un nouvel onglet (`window.open`). Aucune permission requise : Google
 *    affiche simplement le formulaire de création d'évènement pré-rempli.
 *  - `buildIcs(message)` : un fichier .ics (VEVENT, RFC 5545) téléchargeable,
 *    utilisable hors écosystème Google.
 *
 * Détection optionnelle d'une date/heure dans le corps (best-effort, FR/EN) →
 * pré-remplit la plage `dates=` de l'URL et le `DTSTART/DTEND` de l'.ics.
 */

import type { EmailMessage } from "./gmail";
import { parseEmailBody } from "./email-quote";

const GCAL_BASE = "https://calendar.google.com/calendar/render";

/** Durée par défaut d'un évènement déduit d'un email (1 h). */
export const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

/** Longueur max de l'extrait injecté dans les détails de l'évènement. */
const DETAILS_SNIPPET_MAX = 800;

export interface EventDraft {
  /** Titre de l'évènement (= sujet de l'email, ou fallback). */
  title: string;
  /** Description longue (extrait du corps + lien Gmail). */
  details: string;
  /** Début détecté, sinon `null` (l'utilisateur choisira dans Google/ICS). */
  start: Date | null;
  /** Fin = start + durée par défaut (présent ssi `start` présent). */
  end: Date | null;
}

// ─── Détection date/heure (best-effort, bonus) ────────────────────────────────

const MONTHS_FR: Record<string, number> = {
  janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10,
  decembre: 11, décembre: 11,
};

const MONTHS_EN: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11,
};

/** Normalise un libellé de mois (minuscule, sans accent géré via tables). */
function monthIndex(token: string): number | null {
  const k = token.toLowerCase();
  if (k in MONTHS_FR) return MONTHS_FR[k]!;
  if (k in MONTHS_EN) return MONTHS_EN[k]!;
  return null;
}

/** Cherche une heure « 14h », « 14h30 », « 14:30 », « 2pm », « 9 am ». */
function findTime(text: string): { hours: number; minutes: number } | null {
  // 14h, 14h30, 14:30, 14 h 30
  const m24 = text.match(/\b(\d{1,2})\s*[h:]\s*(\d{2})?\b/i);
  if (m24) {
    const h = Number(m24[1]);
    const min = m24[2] ? Number(m24[2]) : 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { hours: h, minutes: min };
  }
  // 2pm, 2:30 pm, 9 am
  const m12 = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i);
  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2] ? Number(m12[2]) : 0;
    const pm = m12[3]!.toLowerCase() === "p";
    if (h >= 1 && h <= 12) {
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
      return { hours: h, minutes: min };
    }
  }
  return null;
}

/**
 * Détecte une date dans le corps (best-effort). Reconnaît :
 *  - `12/06/2026`, `12-06-2026` (jour/mois/année, format FR)
 *  - `2026-06-12` (ISO)
 *  - `12 juin 2026`, `June 12 2026`, `12 June` (mois textuel)
 * + une heure éventuelle accolée. Renvoie `null` si rien d'exploitable.
 * Volontairement conservateur : préfère ne rien détecter à mal détecter.
 */
export function detectDateTime(text: string, now: Date = new Date()): Date | null {
  if (!text) return null;
  const time = findTime(text);
  const apply = (d: Date): Date => {
    if (time) {
      d.setHours(time.hours, time.minutes, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0); // défaut 9h si jour seul
    }
    return d;
  };

  // ISO : 2026-06-12
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const d = Number(iso[3]);
    if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) return apply(new Date(y, mo, d));
  }

  // FR numérique : 12/06/2026 ou 12/06 (année courante)
  const num = text.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (num) {
    const d = Number(num[1]);
    const mo = Number(num[2]) - 1;
    let y = num[3] ? Number(num[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    if (mo >= 0 && mo <= 11 && d >= 1 && d <= 31) return apply(new Date(y, mo, d));
  }

  // Mois textuel : « 12 juin 2026 », « 12 juin », « June 12, 2026 », « June 12 »
  const dmy = text.match(/\b(\d{1,2})\s+([a-zà-ÿ]+)\.?\s*(\d{4})?\b/i);
  if (dmy) {
    const mi = monthIndex(dmy[2]!);
    if (mi !== null) {
      const d = Number(dmy[1]);
      const y = dmy[3] ? Number(dmy[3]) : now.getFullYear();
      if (d >= 1 && d <= 31) return apply(new Date(y, mi, d));
    }
  }
  const mdy = text.match(/\b([a-zà-ÿ]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\b/i);
  if (mdy) {
    const mi = monthIndex(mdy[1]!);
    if (mi !== null) {
      const d = Number(mdy[2]);
      const y = mdy[3] ? Number(mdy[3]) : now.getFullYear();
      if (d >= 1 && d <= 31) return apply(new Date(y, mi, d));
    }
  }

  return null;
}

// ─── Construction du brouillon d'évènement ────────────────────────────────────

/**
 * Extrait l'essentiel d'un message pour pré-remplir un évènement.
 * `detectDate` (défaut true) active la détection date/heure dans le corps.
 */
export function buildEventDraft(
  message: EmailMessage,
  opts: { detectDate?: boolean; now?: Date } = {},
): EventDraft {
  const detect = opts.detectDate ?? true;
  const subject = message.subject?.trim();
  const title = subject || "Évènement (email)";

  // Corps « propre » : sans citation ni signature.
  const parsed = parseEmailBody(message.bodyText || message.snippet || "");
  const cleanBody = (parsed.body || message.snippet || "").trim();
  const snippet =
    cleanBody.length > DETAILS_SNIPPET_MAX
      ? `${cleanBody.slice(0, DETAILS_SNIPPET_MAX).trimEnd()}…`
      : cleanBody;

  const fromLabel = message.from?.name || message.from?.email || "";
  const detailsParts: string[] = [];
  if (fromLabel) detailsParts.push(`De : ${fromLabel}`);
  if (snippet) detailsParts.push(snippet);
  if (message.webLink) detailsParts.push(`Email d'origine : ${message.webLink}`);
  const details = detailsParts.join("\n\n");

  let start: Date | null = null;
  let end: Date | null = null;
  if (detect) {
    const detected = detectDateTime(cleanBody, opts.now);
    if (detected) {
      start = detected;
      end = new Date(detected.getTime() + DEFAULT_EVENT_DURATION_MS);
    }
  }

  return { title, details, start, end };
}

// ─── Formatage des dates ──────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format Google Agenda / ICS « flottant » local : YYYYMMDDTHHMMSS. */
export function formatLocalStamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Format ICS UTC : YYYYMMDDTHHMMSSZ. */
export function formatUtcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// ─── URL Google Agenda ────────────────────────────────────────────────────────

/**
 * Construit l'URL Google Agenda pré-remplie (action=TEMPLATE). Si une plage
 * `start/end` est fournie (ou détectée), elle est injectée dans `dates=` au
 * format `YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS` (heure locale flottante). Sans plage,
 * `dates` est omis : Google ouvre le formulaire sur l'heure courante.
 */
export function buildGoogleCalendarUrl(
  message: EmailMessage,
  opts: { detectDate?: boolean; now?: Date } = {},
): string {
  const draft = buildEventDraft(message, opts);
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", draft.title);
  if (draft.details) params.set("details", draft.details);
  if (draft.start && draft.end) {
    params.set("dates", `${formatLocalStamp(draft.start)}/${formatLocalStamp(draft.end)}`);
  }
  return `${GCAL_BASE}?${params.toString()}`;
}

// ─── Fichier ICS ──────────────────────────────────────────────────────────────

/** Échappe une valeur de texte ICS (RFC 5545 §3.3.11). */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Plie une ligne ICS à 75 octets (RFC 5545 §3.1) — continuation par espace. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

/**
 * Génère un VCALENDAR/VEVENT valide. Si pas de date détectée, on cale
 * l'évènement à `now` (durée par défaut) pour produire un .ics importable —
 * l'utilisateur ajustera dans son agenda. UID stable dérivé de l'id du message.
 */
export function buildIcs(
  message: EmailMessage,
  opts: { detectDate?: boolean; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const draft = buildEventDraft(message, opts);
  const start = draft.start ?? now;
  const end = draft.end ?? new Date(start.getTime() + DEFAULT_EVENT_DURATION_MS);
  const uid = `${message.id || formatUtcStamp(now)}@supernote.mail`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Supernote//Mail to Event//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatUtcStamp(now)}`,
    `DTSTART:${formatUtcStamp(start)}`,
    `DTEND:${formatUtcStamp(end)}`,
    `SUMMARY:${escapeIcs(draft.title)}`,
    `DESCRIPTION:${escapeIcs(draft.details)}`,
    ...(message.webLink ? [`URL:${escapeIcs(message.webLink)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // CRLF entre lignes (RFC 5545 §3.1) + pliage.
  return lines.map(foldIcsLine).join("\r\n");
}

/**
 * Construit une data-URL `text/calendar` directement ouvrable/téléchargeable.
 * Pratique côté UI : `const a = document.createElement("a"); a.href = ...`.
 */
export function buildIcsDataUrl(
  message: EmailMessage,
  opts: { detectDate?: boolean; now?: Date } = {},
): string {
  const ics = buildIcs(message, opts);
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
