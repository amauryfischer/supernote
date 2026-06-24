/**
 * Helpers d'URL pour le bloc embed Gmail. Un thread n'a pas d'URL « collable »
 * stable côté utilisateur ; on dérive le lien web Gmail depuis le threadId.
 */

/** Lien web Gmail vers un thread (ouvre la conversation dans Gmail). */
export function buildGmailThreadUrl(threadId: string): string {
  if (!threadId) return "";
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}
