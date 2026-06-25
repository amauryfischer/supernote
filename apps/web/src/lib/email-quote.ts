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

// ─── Nettoyage du corps (pur) ────────────────────────────────────────────────

/**
 * Retire les artefacts de liens inline « LABEL<scheme:URL> » laissés par les
 * conversions HTML→texte d'Outlook/Exchange : on ne garde que le LABEL visible.
 *
 * Ex. `c.delongcamp@vortex-io.fr<mailto:c.delongcamp@vortex-io.fr>` →
 * `c.delongcamp@vortex-io.fr` ; `Prendre RDV<https://…>` → `Prendre RDV` ;
 * `[linkedin] <https://…>` → `[linkedin]`. On ne touche QUE les chevrons dont
 * le contenu est une URL mailto/http(s) (pas un « <a@b> » d'adresse d'email
 * légitime hors contexte signature, ni du markup générique). Pur.
 */
export function cleanInlineLinks(text: string): string {
  if (!text) return "";
  // Espace optionnel avant le chevron (cas « [linkedin] <https://…> ») retiré.
  return text.replace(/\s*<(?:mailto:|https?:\/\/)[^>\s]*>/gi, "");
}

/**
 * Réduit 3 lignes vides consécutives ou plus à au plus 2 (1 ligne vide visible),
 * et supprime les espaces/tabs en fin de ligne. Pur.
 */
export function collapseBlankLines(text: string): string {
  if (!text) return "";
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Nettoyage combiné du corps (liens inline + lignes vides). Pur. */
export function cleanBody(text: string): string {
  return collapseBlankLines(cleanInlineLinks(text));
}

// Lignes de salutation/clôture qui ouvrent une signature.
const SIGNOFF =
  /^(cordialement|bien (?:à|a) vous|bien cordialement|cordialement v[oô]tre|bonne (?:journée|soir[ée]e|r[ée]ception|continuation)|sinc[èe]res salutations|salutations(?: distingu[ée]es)?|merci(?: d'avance| par avance)?|[àa] bient[ôo]t|[àa] tr[èe]s bient[ôo]t|regards|best(?: regards)?|kind regards|cheers|thanks|thank you)\b[\s,.!–-]*$/i;

/** Séparateur de signature : `-- `, ou ≥3 tirets/underscores/égal répétés. */
function isSignatureDivider(line: string): boolean {
  const t = line.trim();
  return t === "--" || /^[-_=]{3,}$/.test(t);
}

// Marqueurs de « contact » (téléphone FR/international, email, URL).
const PHONE_RE = /(?:\+|00|\(0\)|\b0)[\d\s().\/-]{6,}\d/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s]+/i;

/** Une ligne porte-t-elle un marqueur de contact (tel/email/url) ? */
function isContactLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return PHONE_RE.test(t) || EMAIL_RE.test(t) || URL_RE.test(t);
}

/**
 * Cherche le DÉBUT d'un bloc signature « façon carte de visite » en fin de
 * message, SANS formule de politesse : un bloc final court dominé par des
 * marqueurs de contact (≥2 lignes contact). Coupe de façon CONSERVATRICE —
 * exige du vrai contenu (≥2 lignes non vides) avant le bloc, et borne la taille
 * du bloc (≤12 lignes) pour ne pas avaler un corps légitime. Renvoie l'index de
 * coupe (1ʳᵉ ligne de la signature) ou -1. Pur.
 */
function findContactBlock(lines: string[]): number {
  // Dernière ligne non vide.
  let end = lines.length - 1;
  while (end >= 0 && lines[end]!.trim() === "") end--;
  if (end < 0) return -1;

  // Compte les marqueurs de contact dans la fenêtre finale (≤12 lignes) et
  // remonte tant que les lignes restent « signature-like » (courtes ou contact).
  const MAX_BLOCK = 12;
  let start = end;
  let contactCount = 0;
  for (let i = end; i >= 0 && end - i < MAX_BLOCK; i--) {
    const t = lines[i]!.trim();
    if (t === "") {
      // Une ligne vide isolée à l'intérieur d'une signature est tolérée tant
      // qu'on a déjà des contacts ; deux vides consécutives stoppent.
      if (i - 1 >= 0 && lines[i - 1]!.trim() === "") break;
      continue;
    }
    const contact = isContactLine(t);
    const shortRoleLine = t.length <= 60 && !/[.!?]\s*\S/.test(t);
    if (contact || shortRoleLine) {
      if (contact) contactCount++;
      start = i;
    } else {
      break;
    }
  }

  if (contactCount < 2) return -1;

  // Du vrai contenu doit précéder le bloc (≥2 lignes non vides au-dessus).
  const realBefore = lines.slice(0, start).filter((l) => l.trim() !== "").length;
  if (realBefore < 2) return -1;

  // Recule sur les lignes vides qui séparent corps et signature.
  let cut = start;
  while (cut - 1 >= 0 && lines[cut - 1]!.trim() === "") cut--;
  return cut;
}

export interface StripSignature {
  /** Texte sans la signature. */
  body: string;
  /** Bloc signature retiré, vide s'il n'y en a pas. */
  signature: string;
}

/**
 * Sépare le texte de sa signature. Stratégie, dans l'ordre :
 *  1. Délimiteur explicite : `-- ` (RFC 3676) ou ligne de ≥3 tirets/underscores/
 *     égal répétés (`--------`, `________`, `========`) PRÉCÉDÉE de contenu.
 *  2. Première formule de politesse (« Cordialement, »…) PRÉCÉDÉE de contenu —
 *     pour ne pas masquer une réponse qui n'est qu'un « Merci ».
 *  3. Bloc « carte de visite » final (≥2 marqueurs de contact, contenu réel
 *     avant) même SANS formule de politesse — coupe conservatrice.
 * Pur. Garantit qu'on ne sur-coupe pas un message court légitime.
 */
export function stripSignature(text: string): StripSignature {
  if (!text) return { body: "", signature: "" };
  const lines = text.split(/\r?\n/);

  let cut = -1;
  // 1. Délimiteur explicite précédé de contenu.
  for (let i = 0; i < lines.length; i++) {
    if (isSignatureDivider(lines[i]!) && lines.slice(0, i).some((l) => l.trim() !== "")) {
      cut = i;
      break;
    }
  }
  // 2. Formule de politesse précédée de contenu.
  if (cut === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (SIGNOFF.test(lines[i]!.trim()) && lines.slice(0, i).some((l) => l.trim() !== "")) {
        cut = i;
        break;
      }
    }
  }
  // 3. Bloc contact final sans formule de politesse (conservateur).
  if (cut === -1) {
    cut = findContactBlock(lines);
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

/**
 * Découpe complète : retire la citation, nettoie les artefacts de liens inline /
 * lignes vides multiples, puis retire la signature du reste. Le nettoyage
 * (`cleanBody`) s'applique AVANT la détection de signature pour que les liens
 * Outlook (`mailto:`/`http`) ne perturbent pas l'heuristique de contact, et la
 * signature retirée est elle-même nettoyée.
 */
export function parseEmailBody(raw: string): ParsedBody {
  const { body: afterQuote, quoted } = splitQuotedReply(raw);
  const cleaned = cleanBody(afterQuote);
  const { body, signature } = stripSignature(cleaned);
  return { body: body.replace(/\s+$/, ""), quoted, signature: cleanBody(signature).trim() };
}
