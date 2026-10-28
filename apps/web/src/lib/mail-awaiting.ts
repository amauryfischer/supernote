import type { ThreadListItem } from "@/lib/gmail";
import { isMachineAddress } from "@/lib/contact-from-email";

// Gmail range déjà ici les envois automatiques (promos, réseaux, notifications, forums).
// Domaines grand public : partager le domaine n'y fait pas un collègue.
export const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.fr", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "laposte.net", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr", "proton.me", "protonmail.com"]);

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1);

const AUTOMATED_CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

const GREETING = /^(?:bonjour|bonsoir|hello|salut|coucou|hi|hey)\b[^,!.]{0,40}[,!.]?\s*/i;
const QUOTE_START = /\s(?:Le\s.{5,80}?a\s+écrit\s*:|On\s.{5,80}?wrote:|De\s*:|From:|-{2,}\s*Original)/i;
const CLOSING = /^(?:(?:un\s+)?(?:grand\s+|très\s+)?merci|thanks?|thank\s+you|parfait|super|top|génial|nickel|ok|d'accord|bien\s+reçu|reçu|noté|c'est\s+noté|avec\s+plaisir|de\s+rien|ça\s+marche|entendu)\b/i;

/** Message qui clôt l'échange (« Merci ! », « Bien reçu ») : il n'appelle pas de réponse. PUR. */
export function isClosingMessage(snippet: string): boolean {
  const own = snippet.split(QUOTE_START)[0]!.replace(GREETING, "").trim();
  // Au-delà d'une phrase courte, le remerciement introduit souvent une vraie demande.
  return own.length > 0 && own.length <= 90 && !own.includes("?") && CLOSING.test(own);
}

export function isSelfAddress(email: string, selfEmails: readonly string[]): boolean {
  const e = email.trim().toLowerCase();
  return Boolean(e) && selfEmails.some((s) => s.trim().toLowerCase() === e);
}

/**
 * « À toi de répondre » : fil encore dans la boîte dont le dernier message vient
 * d'une personne extérieure (ni moi, ni un collègue du même domaine, ni une machine) et qui
 * ne se contente pas de clore l'échange. `from` d'un ThreadListItem est
 * l'expéditeur du DERNIER message.
 */
export function awaitsMyReply(item: ThreadListItem, selfEmails: readonly string[]): boolean {
  if (!item.labelIds.includes("INBOX")) return false;
  // Étoilé = rangé par l'utilisateur, il sort du compte « à toi ».
  if (item.labelIds.includes("STARRED")) return false;
  if (item.labelIds.some((l) => AUTOMATED_CATEGORIES.includes(l))) return false;
  const from = item.from.email.trim().toLowerCase();
  if (!from || isMachineAddress(from)) return false;
  if (isSelfAddress(from, selfEmails)) return false;
  if (isClosingMessage(item.snippet)) return false;
  // Un collègue a répondu en dernier : le fil est traité côté maison.
  const d = domainOf(from);
  return PUBLIC_DOMAINS.has(d) || !selfEmails.some((s) => domainOf(s.trim().toLowerCase()) === d);
}
