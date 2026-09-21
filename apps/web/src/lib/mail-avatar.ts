/**
 * mail-avatar — monogramme d'expéditeur (PUR) : initiales + couleur déterministe
 * sobre dérivée d'une clé (email ou nom). Aucune I/O, testable.
 */

/**
 * 1–2 lettres MAJUSCULES : initiales du `name` (initiales des 2 premiers mots, ou
 * 2 premières lettres d'un mot unique) ; sinon 1ʳᵉ lettre de la partie locale de
 * l'`email` ; sinon « ? ». Pur.
 */
export function initials(name: string, email: string): string {
  const n = (name ?? "").trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
    const w = words[0] ?? "";
    if (w) return w.slice(0, w.length >= 2 ? 2 : 1).toUpperCase();
  }
  const e = (email ?? "").replace(/^mailto:/i, "").trim();
  if (e) {
    const local = e.split("@")[0] ?? "";
    const c = (local.replace(/[^a-zA-Z0-9]/g, "")[0] ?? e[0]) ?? "";
    if (c) return c.toUpperCase();
  }
  return "?";
}

export interface AvatarColor {
  bg: string;
  fg: string;
}

/** Hash entier stable (non cryptographique) d'une chaîne. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Teinte déterministe (0–359) d'une personne, partagée avatar ↔ bulle de fil. */
export function senderHue(key: string): number {
  return hashKey((key ?? "").trim().toLowerCase()) % 360;
}

/**
 * Couleur déterministe et SOBRE (faible saturation) pour un monogramme, dérivée
 * d'une clé (email/nom). Fond clair, texte foncé même teinte → contraste
 * suffisant. Pur.
 */
export function avatarColor(key: string): AvatarColor {
  const h = senderHue(key);
  return { bg: `hsl(${h} 42% 90%)`, fg: `hsl(${h} 40% 34%)` };
}
