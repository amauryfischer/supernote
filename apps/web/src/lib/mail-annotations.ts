import { trpcVanillaClient } from "@/lib/trpc/client";

/** Doit rester égal à `MAIL_ANNOTATION_TYPE_ID` du seed worker (non importable côté client). */
export const MAIL_ANNOTATION_TYPE_ID = "mail_annotation";
export const MAIL_ANNOTATIONS_EVENT = "supernote:mail-annotations";

export interface MailHighlight {
  messageId: string;
  text: string;
}

/** Repères posés pour soi sur un fil : rien ne part vers Gmail ni vers les correspondants. */
export interface MailAnnotation {
  accountId: string;
  threadId: string;
  title: string;
  note: string;
  highlights: MailHighlight[];
}

const isHighlight = (x: unknown): x is MailHighlight =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as MailHighlight).messageId === "string" &&
  typeof (x as MailHighlight).text === "string";

export function fromEntity(e: { fields?: Record<string, unknown> }): MailAnnotation | null {
  const f = e.fields ?? {};
  const threadId = f["ma_thread_id"];
  const accountId = f["ma_account_email"];
  if (typeof threadId !== "string" || typeof accountId !== "string") return null;
  let highlights: MailHighlight[] = [];
  try {
    const parsed: unknown = JSON.parse(typeof f["ma_highlights"] === "string" ? f["ma_highlights"] || "[]" : "[]");
    if (Array.isArray(parsed)) highlights = parsed.filter(isHighlight);
  } catch {
    highlights = [];
  }
  return {
    accountId,
    threadId,
    title: typeof f["ma_title"] === "string" ? f["ma_title"] : "",
    note: typeof f["ma_note"] === "string" ? f["ma_note"] : "",
    highlights,
  };
}

export async function saveAnnotation(
  accountId: string,
  threadId: string,
  patch: { title?: string; note?: string; highlights?: MailHighlight[] },
): Promise<void> {
  await trpcVanillaClient.mail.setAnnotation.mutate({
    accountId,
    threadId,
    title: patch.title?.trim(),
    note: patch.note?.trim(),
    highlights: patch.highlights ? JSON.stringify(patch.highlights) : undefined,
  });
  window.dispatchEvent(new CustomEvent(MAIL_ANNOTATIONS_EVENT));
}

/** Gmail préfixe « Re: », « TR: »… : sans ça, deux réponses d'un même fil n'auraient pas le même objet. */
export function baseSubject(subject: string): string {
  return subject.replace(/^\s*((re|tr|fw|fwd|réf|ref)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
}

/**
 * Objet affiché dans la liste : objet perso, sinon le vrai, sinon (note à soi sans objet)
 * le début de l'extrait — Gmail aplatit les retours à la ligne, on coupe à la première phrase.
 */
export function displaySubject(subject: string, snippet: string, annotation: MailAnnotation | undefined): string {
  if (annotation?.title) return annotation.title;
  if (subject.trim()) return subject;
  const head = snippet.trim().split(/(?<=[.!?])\s|\s[-–—•]\s/)[0] ?? "";
  return head.length > 70 ? `${head.slice(0, 70).trimEnd()}…` : head;
}
