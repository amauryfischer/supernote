/**
 * EmailComposer — build `mailto:` URLs for one or more todos.
 *
 * In a PWA we can't send mail server-side without authenticating against an
 * SMTP/IMAP backend. The simplest, fully-offline alternative is to hand the
 * user's default mail client a pre-filled draft via the `mailto:` scheme.
 *
 * Limits: most browsers cap the URL at ~2000 characters; we truncate the
 * body if it would exceed that and append an ellipsis so the link still
 * works even when the user dumped a very long todo list.
 */

export interface MailableTodo {
  text: string;
  done?: boolean;
  priority?: number | null;
  importance?: "low" | "medium" | "high" | "critical" | null;
  dueDate?: string | null;
  sourceNoteId?: string | null;
  sourceNoteName?: string | null;
}

const MAX_URL_LENGTH = 2000;
const ELLIPSIS = "%0A%0A…(troncature)";

/**
 * `mailto:` URLs require RFC-2396 percent encoding of *every* reserved
 * character — including the ones `encodeURIComponent` leaves alone (`!`,
 * `'`, `(`, `)`, `*`). Ignoring this trips Outlook on Windows, which then
 * silently drops the body. We post-process the standard encoder's output.
 */
function rfc2396(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function importanceLabel(v: MailableTodo["importance"]): string {
  switch (v) {
    case "critical":
      return "Critique";
    case "high":
      return "Haute";
    case "medium":
      return "Moyenne";
    case "low":
      return "Basse";
    default:
      return "—";
  }
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Build a single-todo email body. Plain text — `mailto:` doesn't support
 * HTML. Lines are joined with newlines (encoded as `%0A` later).
 */
function singleBody(todo: MailableTodo, baseHref?: string): string {
  const parts: string[] = [];
  parts.push(todo.text);
  parts.push("");
  parts.push(`Priorité : P${todo.priority ?? 5}`);
  parts.push(`Importance : ${importanceLabel(todo.importance ?? null)}`);
  parts.push(`Échéance : ${fmtDate(todo.dueDate)}`);
  parts.push(`État : ${todo.done ? "Fait" : "En attente"}`);
  if (todo.sourceNoteId) {
    const url =
      baseHref && todo.sourceNoteId
        ? `${baseHref.replace(/\/$/, "")}/notes/${todo.sourceNoteId}`
        : `/notes/${todo.sourceNoteId}`;
    parts.push("");
    parts.push(`Source : ${todo.sourceNoteName ?? "Note"} → ${url}`);
  }
  return parts.join("\n");
}

export interface ComposeOptions {
  /** Optional `to:` address. When empty the user picks the recipient. */
  to?: string;
  /**
   * Origin used to absolutize note links inside the body (e.g. when the
   * user reads the email on a different device). Falls back to relative
   * paths when omitted.
   */
  baseHref?: string;
}

/** mailto for a single todo. */
export function composeTodoMailto(todo: MailableTodo, opts: ComposeOptions = {}): string {
  const subject = `Tâche : ${todo.text.slice(0, 80)}`;
  const body = singleBody(todo, opts.baseHref);
  return assembleMailto(opts.to, subject, body);
}

/** mailto for a batch — each todo gets its own bullet block. */
export function composeAllTodosMailto(
  todos: MailableTodo[],
  opts: ComposeOptions = {},
): string {
  const total = todos.length;
  const pending = todos.filter((t) => !t.done).length;
  const subject = `Mes tâches (${pending}/${total} en attente)`;
  const blocks = todos.map((t, i) => `${i + 1}. ${singleBody(t, opts.baseHref)}`);
  const body = blocks.join("\n\n---\n\n");
  return assembleMailto(opts.to, subject, body);
}

function assembleMailto(to: string | undefined, subject: string, body: string): string {
  const params: string[] = [];
  params.push(`subject=${rfc2396(subject)}`);
  let encodedBody = rfc2396(body);
  // Reserve room for the prefix `mailto:<to>?subject=…&body=`. The URL cap
  // is browser-dependent; 2000 is the safe number recommended by RFC 7230.
  const prefix = `mailto:${to ? rfc2396(to) : ""}?${params.join("&")}&body=`;
  const remaining = MAX_URL_LENGTH - prefix.length;
  if (encodedBody.length > remaining) {
    encodedBody = encodedBody.slice(0, Math.max(0, remaining - ELLIPSIS.length)) + ELLIPSIS;
  }
  return `${prefix}${encodedBody}`;
}

/** localStorage key used by the GeneralTab to remember a default `to:`. */
export const DEFAULT_EMAIL_KEY = "supernote.todos.defaultEmail";

export function readDefaultEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(DEFAULT_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeDefaultEmail(email: string): void {
  if (typeof window === "undefined") return;
  try {
    if (email.trim()) {
      window.localStorage.setItem(DEFAULT_EMAIL_KEY, email.trim());
    } else {
      window.localStorage.removeItem(DEFAULT_EMAIL_KEY);
    }
  } catch {
    /* ignore — quota / private mode */
  }
}
