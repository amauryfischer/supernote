/**
 * Découpe un corps d'email en { body, quoted } : le texte « neuf » de la réponse
 * vs la citation rajoutée en dessous (chaîne du message d'origine).
 *
 * Heuristique (texte brut, top-post majoritaire) : on coupe à la PREMIÈRE
 * marque de citation rencontrée — ligne préfixée `>`, ligne d'attribution
 * (« … a écrit : », « … wrote: ») ou séparateur (« -----Message d'origine----- »,
 * underscores Outlook). Si une ligne d'attribution précède immédiatement le bloc
 * `>`, on l'inclut dans la citation. Tout ce qui suit la coupe = `quoted`.
 *
 * Pur & déterministe. Si aucune marque → tout est `body`, `quoted` vide.
 */

function isAttribution(line: string): boolean {
  return (
    /\ba écrit\s*:?\s*$/i.test(line) || // "Le 24 juin 2026 à 10:00, Ada a écrit :"
    /\bwrote:\s*$/i.test(line) || // "On Tue, 23 Jun 2026, Ada <a@b> wrote:"
    /\ba écrit\s*:?\s*$/i.test(line) // espace insécable avant "écrit"
  );
}

function isDivider(line: string): boolean {
  return (
    /^_{5,}\s*$/.test(line) || // séparateur Outlook ____________
    /^-{2,}\s*(message d'origine|original message|forwarded message|message transféré)/i.test(line)
  );
}

export interface SplitReply {
  /** Texte neuf de la réponse (citation retirée). */
  body: string;
  /** Citation rajoutée (chaîne d'origine), vide s'il n'y en a pas. */
  quoted: string;
}

export function splitQuotedReply(raw: string): SplitReply {
  if (!raw) return { body: "", quoted: "" };
  const lines = raw.split(/\r?\n/);

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith(">") || isDivider(t) || isAttribution(t)) {
      cut = i;
      // Remonter pour inclure une ligne d'attribution juste avant le bloc cité
      // (« Le … a écrit : » suivie de lignes « > »).
      if (t.startsWith(">")) {
        let j = i - 1;
        while (j >= 0 && lines[j]!.trim() === "") j--;
        if (j >= 0 && isAttribution(lines[j]!.trim())) cut = j;
      }
      break;
    }
  }

  if (cut === -1) return { body: raw.replace(/\s+$/, ""), quoted: "" };

  const body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const quoted = lines.slice(cut).join("\n").trim();
  return { body, quoted };
}

// Lignes de salutation/clôture qui ouvrent une signature.
const SIGNOFF =
  /^(cordialement|bien (?:à|a) vous|bien cordialement|cordialement v[oô]tre|bonne (?:journée|soir[ée]e|r[ée]ception|continuation)|sinc[èe]res salutations|salutations(?: distingu[ée]es)?|merci(?: d'avance| par avance)?|[àa] bient[ôo]t|[àa] tr[èe]s bient[ôo]t|regards|best(?: regards)?|kind regards|cheers|thanks|thank you)\b[\s,.!–-]*$/i;

export interface StripSignature {
  /** Texte sans la signature. */
  body: string;
  /** Bloc signature retiré, vide s'il n'y en a pas. */
  signature: string;
}

/**
 * Sépare le texte de sa signature. Coupe au délimiteur standard `-- ` (RFC 3676)
 * ou, à défaut, à la première ligne de salutation (« Cordialement, »…) PRÉCÉDÉE
 * de contenu — pour ne pas masquer une réponse qui n'est qu'un « Merci ». Pur.
 */
export function stripSignature(text: string): StripSignature {
  if (!text) return { body: "", signature: "" };
  const lines = text.split(/\r?\n/);

  let cut = lines.findIndex((l) => l === "-- " || l.trim() === "--");
  if (cut === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (SIGNOFF.test(lines[i]!.trim()) && lines.slice(0, i).some((l) => l.trim() !== "")) {
        cut = i;
        break;
      }
    }
  }
  if (cut === -1) return { body: text.replace(/\s+$/, ""), signature: "" };

  const body = lines.slice(0, cut).join("\n").replace(/\s+$/, "");
  const signature = lines.slice(cut).join("\n").trim();
  return { body, signature };
}

export interface ParsedBody {
  /** Texte neuf de la réponse (citation + signature retirées). */
  body: string;
  /** Citation rajoutée. */
  quoted: string;
  /** Signature. */
  signature: string;
}

/** Découpe complète : retire la citation puis la signature du reste. */
export function parseEmailBody(raw: string): ParsedBody {
  const { body: afterQuote, quoted } = splitQuotedReply(raw);
  const { body, signature } = stripSignature(afterQuote);
  return { body, quoted, signature };
}
