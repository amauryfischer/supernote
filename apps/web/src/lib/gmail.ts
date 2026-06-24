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
