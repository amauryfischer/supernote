/**
 * signature-extract — extraction PURE de coordonnées depuis le bloc signature
 * d'un email. On isole d'abord la signature via `stripSignature` (email-quote),
 * puis on parse ce bloc avec des regex robustes (formats FR/EN variés) pour en
 * tirer { phone, mobile, role, company, website, linkedin }.
 *
 * Aucun effet de bord, aucune dépendance React/IPC → testable isolément.
 *
 * Heuristiques volontairement conservatrices : on ne renvoie un champ que si on
 * est raisonnablement sûr (préfixe explicite, motif d'URL, mot-clé de rôle…),
 * pour ne JAMAIS proposer d'écraser un contact avec du bruit. Un champ absent
 * est simplement `undefined`.
 */

import { stripSignature } from "./email-quote";

export interface ExtractedSignature {
  /** Téléphone fixe / standard (premier numéro non-mobile rencontré). */
  phone?: string;
  /** Mobile (numéro explicitement marqué mobile/portable/cell, ou motif 06/07). */
  mobile?: string;
  /** Intitulé de poste (« Directeur marketing », « Head of Sales »…). */
  role?: string;
  /** Société / employeur. */
  company?: string;
  /** Site web (hors LinkedIn). */
  website?: string;
  /** Profil LinkedIn (URL complète normalisée). */
  linkedin?: string;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/** Normalise un numéro brut : garde +, chiffres et séparateurs lisibles. */
function normalizePhone(raw: string): string {
  // Conserve un éventuel "+", supprime les libellés, compacte les espaces.
  const trimmed = raw.trim();
  // Retire un préfixe textuel résiduel (ex "Tel :", "M.").
  return trimmed.replace(/\s{2,}/g, " ").trim();
}

/**
 * Compte les chiffres d'une chaîne — sert à valider qu'un « numéro » candidat
 * a une longueur plausible (8 à 15 chiffres, couvre national + international).
 */
function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

/**
 * Motif d'un numéro de téléphone : séquence de chiffres avec séparateurs
 * usuels (espace, ., -, /), parenthèses, et préfixe international optionnel.
 * On exige au moins 8 chiffres pour éviter de capturer des nombres parasites
 * (codes postaux, années, numéros de TVA partiels…).
 */
const PHONE_TOKEN = /(\+?[\d(]\(?[\d\s.\-/().]{6,}\d)/;

/** Vrai si le numéro (nettoyé) ressemble à un mobile FR (06/07) ou +33 6/7. */
function looksLikeFrenchMobile(digits: string): boolean {
  // digits = uniquement chiffres, éventuellement préfixé "00"/"33".
  // Cas national : commence par 06 ou 07.
  if (/^0[67]\d{8}$/.test(digits)) return true;
  // Cas international FR : 33 6/7 …  (+33 6 …)
  if (/^33[67]\d{8}$/.test(digits)) return true;
  if (/^0033[67]\d{8}$/.test(digits)) return true;
  return false;
}

/** Extrait les chiffres bruts (pour les heuristiques mobile FR). */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// ─── Téléphones ───────────────────────────────────────────────────────────────

// Libellés explicites de mobile (FR/EN), insensibles à la casse.
const MOBILE_LABEL = /\b(mobile|mob|portable|port|cell(?:ulaire|phone)?|gsm|m)\b/i;
// Libellés explicites de fixe / standard / fax (fax exclu du résultat).
const PHONE_LABEL = /\b(t[ée]l[ée]phone|t[ée]l|tel|phone|ph|fixe|bureau|office|direct|standard|tel\.?)\b/i;
const FAX_LABEL = /\bfax\b/i;

interface PhoneHit {
  value: string;
  kind: "mobile" | "phone";
}

/**
 * Parcourt les lignes et collecte les numéros, en les classant mobile vs fixe.
 * Classement : libellé explicite > motif mobile FR > défaut "phone".
 * Les lignes de fax sont ignorées (on ne veut pas polluer phone/mobile).
 */
function extractPhones(lines: string[]): PhoneHit[] {
  const hits: PhoneHit[] = [];
  for (const line of lines) {
    const m = line.match(PHONE_TOKEN);
    if (!m) continue;
    const candidate = normalizePhone(m[1]!);
    const dc = digitCount(candidate);
    if (dc < 8 || dc > 15) continue;

    // Le contexte = portion de ligne AVANT le numéro (là où vit le libellé).
    const before = line.slice(0, m.index ?? 0);
    if (FAX_LABEL.test(before)) continue; // fax → on jette

    const digits = digitsOnly(candidate);
    let kind: "mobile" | "phone";
    if (MOBILE_LABEL.test(before)) kind = "mobile";
    else if (PHONE_LABEL.test(before)) kind = "phone";
    else if (looksLikeFrenchMobile(digits)) kind = "mobile";
    else kind = "phone";

    hits.push({ value: candidate, kind });
  }
  return hits;
}

// ─── URLs : website & linkedin ──────────────────────────────────────────────

// Capture une URL http(s) OU un domaine nu (www.x.y / x.y/path).
const URL_TOKEN =
  /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s]*)?)/i;

/** Ajoute https:// si absent ; trim une ponctuation finale parasite. */
function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/[.,;)]+$/, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function isLinkedin(url: string): boolean {
  return /(^|\.|\/)linkedin\.[a-z]+/i.test(url) || /lnkd\.in/i.test(url);
}

/** Vrai si le token est en fait un fragment d'adresse email (a@b.c). */
function isEmailLike(token: string, line: string, index: number): boolean {
  // Fin d'email : le caractère juste avant le token est "@" (domaine d'email).
  const prev = line[index - 1];
  if (prev === "@") return true;
  // Début d'email : le caractère juste après le token est "@" (locale-part qui
  // contient un point, ex "jean.dupont" dans "jean.dupont@acme.fr").
  const next = line[index + token.length];
  if (next === "@") return true;
  return false;
}

interface UrlHits {
  website?: string;
  linkedin?: string;
}

function extractUrls(lines: string[]): UrlHits {
  const out: UrlHits = {};
  for (const line of lines) {
    // Une ligne peut contenir plusieurs URLs : on balaie en avançant.
    let rest = line;
    let offsetInLine = 0;
    while (rest.length > 0) {
      const m = rest.match(URL_TOKEN);
      if (!m || m.index === undefined) break;
      const token = m[1]!;
      const absoluteIndex = offsetInLine + m.index;
      const after = rest.slice(m.index + token.length);
      // Avance le curseur pour la prochaine itération.
      offsetInLine = absoluteIndex + token.length;
      rest = after;

      // Écarte les fragments qui sont en fait des emails (xxx@domaine.tld).
      if (isEmailLike(token, line, absoluteIndex)) continue;
      // Un domaine nu doit contenir un "." et au moins un TLD plausible.
      if (!/\.[a-z]{2,}/i.test(token)) continue;

      const url = normalizeUrl(token);
      if (isLinkedin(url)) {
        if (!out.linkedin) out.linkedin = url;
      } else if (!out.website) {
        out.website = url;
      }
    }
  }
  return out;
}

// ─── Rôle & société ───────────────────────────────────────────────────────────

// Mots-clés de poste (FR/EN) — déclenchent la capture de la ligne entière.
const ROLE_KEYWORDS =
  /\b(directeur|directrice|dirigeant|président|présidente|pdg|dg|daf|drh|cto|ceo|cfo|coo|cmo|cio|fondateur|fondatrice|co-?fondateur|gérant|gérante|associé|associée|responsable|chef(?:fe)?|manager|consultant|consultante|ingénieur|ingénieure|développeur|développeuse|developer|engineer|head\s+of|chief|founder|owner|partner|lead|architect|architecte|commercial|commerciale|chargé[e]?\s+de|account\s+executive|sales|marketing|product|designer|avocat|avocate|notaire|expert[- ]comptable|comptable|assistant[e]?|secrétaire|chargée?\s+d['e]|vice[- ]president|vp|svp)\b/i;

// Marqueurs de société (suffixes juridiques / mots-clés).
const COMPANY_MARKER =
  /\b(sas|sasu|sarl|eurl|sa|sci|scop|snc|gie|inc|ltd|llc|gmbh|ag|corp|co\.|group|groupe|company|société|societe|agence|cabinet|studio|labs?|technologies|tech|consulting|partners|solutions|services|industries|holding|associés|associes)\b/i;

// Lignes à ignorer pour rôle/société (bruit signature). Les mots-clés sont
// bornés par `\b` pour ne pas matcher à l'intérieur d'un mot (« commercial »
// contient « merci », « portable » contient « port »…).
const NOISE_LINE =
  /(@|https?:\/\/|www\.|\.com|\.fr|\.io|\.net|\.org|\b\d{2}[\s.\-]\d{2}\b|\bt[ée]l[ée]?\b|\bmobile\b|\bportable\b|\bfax\b|sent from|envoy[ée] de|envoy[ée] depuis|\bcordialement\b|\bregards\b|\bmerci\b|\bbest\b)/i;

/**
 * Sépare « Rôle — Société » sur une même ligne (séparateurs courants
 * `|`, `–`, `—`, ` - `, `,`, ` chez `, ` at `). Renvoie [gauche, droite?].
 */
function splitRoleCompany(line: string): [string, string | undefined] {
  const sep = line.match(/\s+(?:\||–|—|·|•)\s+|\s+-\s+|,\s+|\s+chez\s+|\s+@\s+|\s+at\s+/i);
  if (sep && sep.index !== undefined) {
    const left = line.slice(0, sep.index).trim();
    const right = line.slice(sep.index + sep[0].length).trim();
    return [left, right || undefined];
  }
  return [line.trim(), undefined];
}

function looksLikeRole(s: string): boolean {
  return ROLE_KEYWORDS.test(s);
}
function looksLikeCompany(s: string): boolean {
  return COMPANY_MARKER.test(s);
}

interface RoleCompany {
  role?: string;
  company?: string;
}

/**
 * Cherche rôle & société dans les lignes « propres » (sans tel/url/email).
 * Stratégie :
 *  1. Pour chaque ligne candidate, tenter un split « Rôle — Société ».
 *  2. Si la gauche ressemble à un rôle → role ; si la droite à une société →
 *     company. Sinon, classer la ligne entière par mots-clés.
 *  3. On garde la PREMIÈRE occurrence de chaque champ.
 */
function extractRoleCompany(lines: string[]): RoleCompany {
  const out: RoleCompany = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (NOISE_LINE.test(line)) continue;
    if (line.length > 90) continue; // ligne trop longue → probablement de la prose

    const [left, right] = splitRoleCompany(line);

    if (!out.role && looksLikeRole(left)) out.role = left;
    if (!out.company && right && looksLikeCompany(right)) out.company = right;

    // Si pas de split exploitable, classer la ligne entière.
    if (!right) {
      if (!out.role && looksLikeRole(line)) out.role = line;
      else if (!out.company && looksLikeCompany(line)) out.company = line;
    } else {
      // Cas « Société | Rôle » (ordre inversé) : si la droite est un rôle et la
      // gauche une société.
      if (!out.role && looksLikeRole(right)) out.role = right;
      if (!out.company && looksLikeCompany(left)) out.company = left;
    }

    if (out.role && out.company) break;
  }
  return out;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Extrait les coordonnées du bloc signature d'un corps d'email (texte brut).
 * Isole d'abord la signature via `stripSignature`, puis parse ce bloc. Si
 * aucune signature n'est détectée, retombe sur l'analyse du texte entier (un
 * email ultra-court peut n'être qu'une signature).
 */
export function extractSignatureFields(rawBody: string): ExtractedSignature {
  const { signature } = stripSignature(rawBody ?? "");
  // Fallback : pas de délimiteur de signature détecté → analyser tout le corps
  // (cas « bloc de coordonnées sans formule de politesse »).
  const block = signature.trim().length > 0 ? signature : (rawBody ?? "");
  return parseSignatureBlock(block);
}

/**
 * Parse un bloc signature DÉJÀ isolé. Exposé séparément pour tester la logique
 * de parsing sans dépendre de la détection de signature.
 */
export function parseSignatureBlock(block: string): ExtractedSignature {
  const lines = block.split(/\r?\n/);

  const phones = extractPhones(lines);
  const urls = extractUrls(lines);
  const rc = extractRoleCompany(lines);

  const result: ExtractedSignature = {};

  const mobile = phones.find((p) => p.kind === "mobile");
  const phone = phones.find((p) => p.kind === "phone");
  if (mobile) result.mobile = mobile.value;
  if (phone) result.phone = phone.value;

  if (urls.website) result.website = urls.website;
  if (urls.linkedin) result.linkedin = urls.linkedin;

  if (rc.role) result.role = rc.role;
  if (rc.company) result.company = rc.company;

  return result;
}

/** Vrai si l'extraction a produit au moins un champ exploitable. */
export function hasAnyExtractedField(s: ExtractedSignature): boolean {
  return Boolean(s.phone || s.mobile || s.role || s.company || s.website || s.linkedin);
}

// ─── Mapping vers les champs du type « personne » ───────────────────────────────

/**
 * Une ligne d'application : un champ du contact (clé `personne`), son libellé
 * d'affichage, la valeur extraite, et la valeur actuelle (si le contact existe
 * déjà). `conflict` = le contact a déjà une valeur DIFFÉRENTE pour ce champ.
 */
export interface FieldApplication {
  /** Clé du champ dans le type `personne` (name=…, ex "phone", "company"). */
  fieldName: "phone" | "role" | "company" | "linkedin";
  /** Libellé humain (FR). */
  label: string;
  /** Valeur extraite de la signature. */
  extracted: string;
  /** Valeur actuelle du contact (string), si renseignée. */
  current?: string;
  /** Vrai si `current` existe et diffère de `extracted`. */
  conflict: boolean;
}

/** Normalise une FieldValue (du worker) en string pour comparaison/affichage. */
function fieldToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  return "";
}

/**
 * Construit la liste des champs applicables sur un contact `personne`.
 *
 * Mapping vers les champs seedés du type `personne` (cf. seed-default-types) :
 *   - mobile/phone → `phone`  (le type n'a qu'un seul champ téléphone ; on
 *     préfère le mobile, sinon le fixe)
 *   - role         → `role`
 *   - company      → `company`
 *   - linkedin     → `linkedin`
 *   - website      → ignoré (pas de champ site web sur `personne`, c'est sur
 *     `organisation`) — signalé en limite.
 *
 * `currentFields` = fields actuels du contact (peut être vide pour une création).
 * Pur & testable.
 */
export function buildContactApplications(
  extracted: ExtractedSignature,
  currentFields: Record<string, unknown> = {},
): FieldApplication[] {
  const out: FieldApplication[] = [];
  const phone = extracted.mobile ?? extracted.phone;

  const candidates: Array<{ fieldName: FieldApplication["fieldName"]; label: string; value?: string }> = [
    { fieldName: "phone", label: "Téléphone", value: phone },
    { fieldName: "role", label: "Rôle", value: extracted.role },
    { fieldName: "company", label: "Entreprise", value: extracted.company },
    { fieldName: "linkedin", label: "LinkedIn", value: extracted.linkedin },
  ];

  for (const c of candidates) {
    if (!c.value) continue;
    const current = fieldToString(currentFields[c.fieldName]);
    out.push({
      fieldName: c.fieldName,
      label: c.label,
      extracted: c.value,
      current: current || undefined,
      conflict: current.length > 0 && current.trim() !== c.value.trim(),
    });
  }
  return out;
}

/** Normalise un email pour comparaison (trim + minuscules). */
export function normalizeEmailKey(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Cherche, parmi des contacts, celui dont le champ `email` correspond (insensible
 * à la casse) à l'adresse donnée. Renvoie `null` si aucun. Pur & testable.
 */
export function findContactByEmail<T extends { fields: Record<string, unknown> }>(
  contacts: T[],
  email: string | undefined,
): T | null {
  const key = normalizeEmailKey(email);
  if (!key) return null;
  return contacts.find((c) => normalizeEmailKey(fieldToString(c.fields.email)) === key) ?? null;
}
