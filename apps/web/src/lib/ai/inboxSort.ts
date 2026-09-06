/**
 * inboxSort — choix d'un dossier pour une note d'inbox.
 *
 * Deux étages, et la frontière entre eux est l'invariant du module :
 *   - `classifyNoteFolder` choisit dans une liste FERMÉE de dossiers existants.
 *     Toute réponse hors liste est rejetée côté client, donc ce chemin ne peut
 *     structurellement pas faire apparaître un dossier ;
 *   - `proposeNoteFolder` ne range rien : il rend un NOM à soumettre à
 *     l'utilisateur quand aucun dossier existant ne convient (ou qu'il n'en
 *     existe aucun — un coffre neuf n'en a pas). Rien n'atteint le disque sans
 *     un clic. La barrière contre la prolifération n'est plus l'interdiction de
 *     proposer, c'est la confirmation.
 *
 * Même discipline que `useAutoTag` : la liste fermée d'abord, la suggestion à
 * confirmer ensuite.
 *
 * Deux appels sont faits, le second avec la liste des dossiers inversée. Ce
 * ne sont PAS deux votes indépendants : même modèle, même prompt à l'ordre
 * près, `temperature: 0`. Le désaccord ne mesure qu'une chose — la
 * sensibilité de la réponse à l'ordre de la liste, biais réel des petits
 * modèles. Un désaccord suffit à laisser la note dans l'inbox ; l'accord ne
 * prouve rien de plus que la stabilité positionnelle.
 *
 * `CONFIDENCE_THRESHOLD` filtre en pratique les réponses mal formées (repli
 * `confidence = 0`), pas les classements douteux : à température nulle, un
 * modèle s'auto-déclare entre 0,95 et 1,0 même quand il se trompe. C'est une
 * garde de format, pas une mesure de certitude.
 */

import { isSystemFolder } from "@/lib/system-folders";
import { isAttachmentPath } from "@/lib/attachments-path";

/** Dossier fourre-tout d'où part le tri. Aucun autre dossier n'est balayé. */
export const INBOX_FOLDER = "Inbox";

/** Préfixe des sous-arbres montés (miroir de `MOUNT_PATH_PREFIX` du worker). */
const MOUNT_PREFIX = "@mounts";

export function isMountedFolder(path: string): boolean {
  return path === MOUNT_PREFIX || path.startsWith(`${MOUNT_PREFIX}/`);
}

/**
 * Nettoie le nom saisi par l'utilisateur au moment de confirmer. Plus permissif
 * que `sanitizeProposedFolder`, qui borde le modèle et non la main humaine : on
 * ne refuse que ce que le worker ou l'arborescence ne supportent pas.
 */
export function cleanUserFolderName(raw: string): string | null {
  const name = raw.trim().replace(/^\/+|\/+$/g, "").replace(/\s+/g, " ");
  if (!name) return null;
  if (name.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
  if (name === INBOX_FOLDER || name.startsWith(`${INBOX_FOLDER}/`)) return null;
  if (isSystemFolder(name) || isAttachmentPath(name) || isMountedFolder(name)) return null;
  return name;
}

/** Clé localStorage du réglage « tri automatique de l'inbox » (défaut : actif). */
export const INBOX_SORT_ENABLED_KEY = "supernote.ai.inboxSort";

/** Plancher de format : sous ce seuil, la réponse est mal formée (cf. en-tête). */
export const CONFIDENCE_THRESHOLD = 0.7;

// La passe tourne en fond, personne n'attend : mieux vaut laisser un gros
// modèle local finir que d'abandonner un classement correct sur un timeout.
const REQUEST_TIMEOUT_MS = 60_000;
/** `listSummaries` tronque déjà le corps à 240 caractères côté worker : ce
 *  plafond ne sert qu'aux appelants qui passeraient un corps entier. */
const MAX_BODY_CHARS = 1_200;
/** Au-delà, on refuse de classer : une liste tronquée ferait choisir le modèle
 *  parmi les survivants, confiance intacte et rangement franchement faux. */
const MAX_FOLDERS = 80;
const CACHE_MAX_ENTRIES = 200;
/** En deçà, la note n'a pas assez de matière pour être classée honnêtement. */
const MIN_TEXT_CHARS = 40;

/** Forme admise d'un nom de dossier proposé — cf. `sanitizeProposedFolder`. */
const PROPOSAL_MIN_CHARS = 3;
const PROPOSAL_MAX_CHARS = 32;
const PROPOSAL_MAX_WORDS = 3;
/** Extrait par note dans le prompt de groupement : le lot entier doit tenir. */
const PROPOSAL_BODY_CHARS = 300;
/** Au-delà, le prompt de groupement devient trop long pour un modèle local. */
const MAX_PROPOSAL_NOTES = 12;

export interface FolderDecision {
  /** Chemin canonique tel qu'il existe dans le coffre. */
  folder: string;
  confidence: number;
}

/** Une note soumise au groupement, repérée par un numéro dans le prompt. */
export interface ProposalCandidate {
  ref: number;
  title: string;
  body: string;
  tags: readonly string[];
}

/**
 * Dossier à CRÉER, proposé quand aucun existant ne convient. `folder` n'est PAS
 * un chemin canonique : c'est un nom qui n'existe pas encore et que
 * l'utilisateur doit confirmer. `refs` désigne les notes qu'il couvre.
 */
export interface FolderProposal {
  folder: string;
  refs: readonly number[];
}

export function isInboxSortEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INBOX_SORT_ENABLED_KEY) !== "0";
  } catch {
    return false;
  }
}

/** Vrai si la note porte assez de texte pour qu'un classement veuille dire quelque chose. */
export function isSortable(title: string, body: string): boolean {
  const text = `${title}\n${body}`.replace(/[#>*`~_[\]|-]/g, "").trim();
  return text.length >= MIN_TEXT_CHARS;
}

function normalizeFolder(raw: string): string {
  return raw
    .trim()
    .replace(/^[«"'`\s]+|[»"'`\s.]+$/g, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

/** Ramène une confiance exprimée en pourcentage ou en fraction sur [0, 1]. */
function coerceConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return n / 100;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Extrait `{folder, confidence}` du JSON noyé dans la réponse du modèle. */
function parseFolderJson(raw: string): { folder: string; confidence: number } {
  let folder = "";
  let confidence = 0;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
      if (typeof parsed === "object" && parsed !== null) {
        const o = parsed as Record<string, unknown>;
        const f = o["folder"] ?? o["dossier"];
        if (typeof f === "string") folder = f;
        confidence = coerceConfidence(o["confidence"] ?? o["confiance"]);
      }
    } catch {
      /* on retombe sur la lecture en clair */
    }
  }
  return { folder, confidence };
}

/**
 * Parse tolérant de la réponse du modèle, puis rattachement au chemin
 * canonique. Toute valeur qui ne correspond à aucun dossier de `folders` est
 * rejetée — c'est la garde anti-hallucination : un dossier inventé ne peut
 * pas atteindre le disque.
 */
export function parseFolderAnswer(
  raw: string,
  folders: readonly string[],
): FolderDecision | null {
  // Deux dossiers qui ne diffèrent que par la casse ("Travail" / "travail")
  // sont indiscernables pour le modèle : la clé devient ambiguë (null) et on
  // refuse, au lieu d'en désigner un au hasard.
  const lookup = new Map<string, string | null>();
  for (const f of folders) {
    const k = normalizeFolder(f);
    lookup.set(k, lookup.has(k) && lookup.get(k) !== f ? null : f);
  }

  let { folder: folderRaw, confidence } = parseFolderJson(raw);

  // Repli : certains petits modèles répondent le chemin nu, sans JSON.
  if (!folderRaw) {
    const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? "";
    folderRaw = firstLine;
    // Sans confiance déclarée on ne peut pas franchir le seuil : la note reste
    // dans l'inbox plutôt que de bouger sur une réponse mal formée.
    confidence = 0;
  }

  const canonical = lookup.get(normalizeFolder(folderRaw));
  if (!canonical) return null;
  return { folder: canonical, confidence };
}

function buildPrompt(
  title: string,
  body: string,
  tags: readonly string[],
  folders: readonly string[],
): string {
  const list = folders.map((f) => `- ${f}`).join("\n");
  const tagLine = tags.length > 0 ? `\nTAGS : ${tags.join(", ")}` : "";
  return `Tu ranges une note dans UN dossier existant d'un coffre de notes.

RÈGLES STRICTES :
- Le dossier choisi DOIT être copié EXACTEMENT depuis la liste ci-dessous. Tu ne peux pas en inventer un, ni en créer un, ni en composer un nouveau.
- Si aucun dossier ne convient clairement, réponds avec un dossier vide : la note restera dans la boîte de réception, c'est une réponse correcte.
- "confidence" est ta certitude réelle entre 0 et 1. Sois honnête : en dessous de ${CONFIDENCE_THRESHOLD}, la note ne bougera pas.

DOSSIERS DISPONIBLES :
${list}

Réponds UNIQUEMENT par du JSON valide, rien d'autre :
{"folder":"<chemin exact d'un dossier de la liste, ou vide>","confidence":<nombre entre 0 et 1>}

TITRE : ${title}${tagLine}

CONTENU :
"""
${body.slice(0, MAX_BODY_CHARS)}
"""`;
}

/**
 * Nettoie un nom de dossier proposé, ou rend `null`. C'est ici que vit la
 * garde contre la prolifération redoutée par la spec : un seul niveau (un
 * chemin imbriqué créerait deux dossiers d'un coup), trois mots au plus, ni
 * date ni paraphrase du titre — bref, un thème réutilisable, pas un tiroir
 * jetable par note.
 */
export function sanitizeProposedFolder(
  raw: string,
  opts: {
    title?: string;
    /** Dossiers déjà présents : le classement les a déjà écartés. */
    existing?: readonly string[];
    /** Noms que l'utilisateur a refusés. */
    refused?: readonly string[];
  } = {},
): string | null {
  const name = raw
    .trim()
    .replace(/^[«"'`\s/]+|[»"'`\s./]+$/g, "")
    .replace(/\s+/g, " ");
  if (!name) return null;
  if (name.includes("/") || name.includes("\\")) return null;
  if (name.length < PROPOSAL_MIN_CHARS || name.length > PROPOSAL_MAX_CHARS) return null;
  if (name.split(" ").length > PROPOSAL_MAX_WORDS) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’&-]*$/u.test(name)) return null;
  // Une année dans le nom trahit un dossier daté : il ne se réutilisera pas.
  if (/\d{4}/.test(name)) return null;

  const key = normalizeFolder(name);
  if (key === normalizeFolder(INBOX_FOLDER)) return null;
  if ((opts.existing ?? []).some((f) => normalizeFolder(f) === key)) return null;
  if ((opts.refused ?? []).some((f) => normalizeFolder(f) === key)) return null;

  const title = normalizeFolder(opts.title ?? "");
  if (title && (title === key || (title.includes(key) && key.length >= title.length * 0.6))) {
    return null;
  }
  return name;
}

function buildProposalPrompt(
  notes: readonly ProposalCandidate[],
  existing: readonly string[],
  refused: readonly string[],
  maxGroups: number,
): string {
  const existingBlock =
    existing.length > 0
      ? `DOSSIERS EXISTANTS — aucun ne convient à ces notes, n'en repropose aucun :\n${existing.map((f) => `- ${f}`).join("\n")}`
      : `Ce coffre n'a encore AUCUN dossier : tout est à créer.`;
  const refusedBlock =
    refused.length > 0
      ? `\n\nNOMS DÉJÀ REFUSÉS par l'utilisateur — interdits :\n${refused.map((f) => `- ${f}`).join("\n")}`
      : "";
  const list = notes
    .map((n) => {
      const tagLine = n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : "";
      return `${n.ref}. ${n.title}${tagLine}\n   ${n.body.slice(0, PROPOSAL_BODY_CHARS).replace(/\s+/g, " ")}`;
    })
    .join("\n");

  return `Tu regroupes des notes en attente de rangement et tu proposes les dossiers à créer pour les accueillir. L'utilisateur validera d'un clic : ne propose que ce que tu proposerais à un collègue.

RÈGLES STRICTES :
- ${maxGroups} dossier${maxGroups > 1 ? "s" : ""} AU PLUS pour l'ensemble des notes.
- REGROUPE : deux notes du même sujet vont dans le MÊME dossier. C'est l'attendu principal.
- Chaque dossier est un THÈME durable et réutilisable — un domaine, un projet, un client, une activité. D'autres notes, futures, devront pouvoir y entrer.
- JAMAIS la reformulation du titre d'une note, jamais une date, jamais un dossier taillé pour une seule note.
- 1 à ${PROPOSAL_MAX_WORDS} mots, ${PROPOSAL_MAX_CHARS} caractères au plus, UN SEUL niveau (pas de "/"), majuscule initiale.
- Une note qui ne relève d'aucun thème net n'est citée dans aucun dossier : la laisser dans la boîte de réception est une réponse correcte.

${existingBlock}${refusedBlock}

Réponds UNIQUEMENT par du JSON valide, rien d'autre :
{"folders":[{"folder":"<nom du dossier à créer>","notes":[<numéros des notes>]}]}

NOTES :
${list}`;
}

/**
 * Lit `{"folders":[{folder, notes:[…]}]}` en tolérant les écarts habituels des
 * petits modèles : clés françaises, numéros rendus en chaîne, objet unique au
 * lieu d'un tableau.
 */
function parseGroupsJson(raw: string): { folder: string; refs: number[] }[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const root = parsed as Record<string, unknown>;
  const rawList = root["folders"] ?? root["dossiers"];
  const list = Array.isArray(rawList) ? rawList : [parsed];

  const out: { folder: string; refs: number[] }[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const name = o["folder"] ?? o["dossier"] ?? o["nom"];
    if (typeof name !== "string") continue;
    const refsRaw = o["notes"] ?? o["refs"] ?? o["numeros"];
    if (!Array.isArray(refsRaw)) continue;
    const refs = refsRaw
      .map((v) => (typeof v === "number" ? v : Number.parseInt(String(v), 10)))
      .filter((n) => Number.isInteger(n));
    out.push({ folder: name, refs });
  }
  return out;
}

/**
 * Appel Ollama borné par un délai ET par le signal de l'appelant. On n'utilise
 * pas `fetchWithTimeout` de useAutoTitle : il écrase le `signal` de l'init par
 * le sien, donc une frappe n'interrompait rien et deux requêtes continuaient
 * jusqu'au bout du délai.
 */
async function askFolder(
  host: string,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", relay, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // Deux appels par note : sans ces deux options, un modèle à
        // raisonnement réfléchit avant chaque vote et Ollama décharge le
        // modèle entre deux passes espacées de 5 min. Mesuré : 1,3 s l'appel
        // avec, 15 à 57 s sans.
        think: false,
        keep_alive: "2h",
        options: { temperature: 0 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);
    const data = (await res.json()) as { response?: string };
    return data.response ?? "";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

/** Clé de cache : le contenu lui-même. Un hash 32 bits collisionne, et une
 *  collision ici rendrait la décision d'une AUTRE note, en silence. */
function cacheKey(parts: readonly string[]): string {
  return parts.join("");
}


const cache = new Map<string, FolderDecision | null>();

function cacheGet(key: string): FolderDecision | null | undefined {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key) ?? null;
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, value: FolderDecision | null): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Vide le cache des décisions — utile quand l'utilisateur change de coffre. */
export function clearInboxSortCache(): void {
  cache.clear();
}

export interface ClassifyInput {
  host: string;
  model: string;
  title: string;
  body: string;
  tags: readonly string[];
  /** Dossiers candidats, déjà filtrés (ni Inbox, ni dossiers système). */
  folders: readonly string[];
  signal?: AbortSignal;
}

/**
 * Décide du dossier d'une note, ou `null` pour « laisse-la dans l'inbox ».
 * Les deux appels doivent tomber sur le même dossier et franchir le plancher
 * de format ; toute erreur réseau se traduit par `null`, jamais par une levée.
 */
export async function classifyNoteFolder(
  input: ClassifyInput,
): Promise<FolderDecision | null> {
  const folders = input.folders;
  if (folders.length === 0 || folders.length > MAX_FOLDERS) return null;
  if (!isSortable(input.title, input.body)) return null;

  const key = cacheKey([
    input.model,
    [...folders].sort().join("|"),
    input.title,
    input.tags.join(","),
    input.body.slice(0, MAX_BODY_CHARS),
  ]);
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  try {
    const first = parseFolderAnswer(
      await askFolder(
        input.host,
        input.model,
        buildPrompt(input.title, input.body, input.tags, folders),
        input.signal,
      ),
      folders,
    );
    if (!first || first.confidence < CONFIDENCE_THRESHOLD) {
      cacheSet(key, null);
      return null;
    }

    const second = parseFolderAnswer(
      await askFolder(
        input.host,
        input.model,
        buildPrompt(input.title, input.body, input.tags, [...folders].reverse()),
        input.signal,
      ),
      folders,
    );
    if (
      !second ||
      second.folder !== first.folder ||
      second.confidence < CONFIDENCE_THRESHOLD
    ) {
      cacheSet(key, null);
      return null;
    }

    const decision: FolderDecision = {
      folder: first.folder,
      confidence: Math.min(first.confidence, second.confidence),
    };
    cacheSet(key, decision);
    return decision;
  } catch {
    // Échec silencieux : Ollama éteint ou timeout ne doit rien casser, et
    // surtout ne rien mettre en cache (la prochaine passe réessaiera).
    return null;
  }
}

export interface ProposeInput {
  host: string;
  model: string;
  /** Notes non classées de la passe, numérotées pour le prompt. */
  notes: readonly ProposalCandidate[];
  /** Dossiers déjà présents (peut être vide : coffre neuf). */
  existing: readonly string[];
  /** Noms de dossiers que l'utilisateur a déjà refusés dans ce coffre. */
  refused: readonly string[];
  /** Plafond de propositions rendues, groupes les plus fournis d'abord. */
  maxGroups: number;
  signal?: AbortSignal;
}

/**
 * Propose des dossiers à créer pour un LOT de notes, ou `[]`. Ne déplace ni ne
 * crée rien : l'appelant doit passer par une confirmation explicite.
 *
 * Le lot, et non une note à la fois : interrogé note par note, le modèle nomme
 * chaque dossier d'après le sujet de la note qu'il a sous les yeux et rend
 * autant de tiroirs jetables que de notes — exactement la prolifération que la
 * spec redoutait (mesuré : six notes de deux thèmes, deux dossiers d'UNE note,
 * « Tomates » et « Maintenance Arbres Fruitiers »). Vu ensemble, il doit couvrir
 * plusieurs notes d'un même nom, ce qui force un thème. Accessoirement, c'est un
 * appel par passe au lieu de N.
 *
 * Un seul appel, contrairement à `classifyNoteFolder` : le second vote y mesure
 * la sensibilité à l'ordre de la liste, et il n'y a pas de liste fermée ici. Le
 * garde-fou est ailleurs — `sanitizeProposedFolder` sur la forme, et
 * l'utilisateur sur le fond.
 */
export async function proposeFolderGroups(
  input: ProposeInput,
): Promise<FolderProposal[]> {
  const notes = input.notes.slice(0, MAX_PROPOSAL_NOTES);
  if (notes.length === 0) return [];

  try {
    const raw = await askFolder(
      input.host,
      input.model,
      buildProposalPrompt(notes, input.existing, input.refused, input.maxGroups),
      input.signal,
    );

    const byRef = new Map(notes.map((n) => [n.ref, n]));
    const seen = new Set<string>();
    const groups: FolderProposal[] = [];

    for (const g of parseGroupsJson(raw)) {
      const refs = [...new Set(g.refs)].filter((r) => byRef.has(r));
      if (refs.length === 0) continue;
      const clean = sanitizeProposedFolder(g.folder, {
        existing: input.existing,
        refused: input.refused,
        // Un dossier taillé pour UNE note ne doit pas recopier son titre. À
        // plusieurs, la question ne se pose plus : le nom les couvre toutes.
        title: refs.length === 1 ? byRef.get(refs[0]!)?.title : undefined,
      });
      if (!clean) continue;
      const key = normalizeFolder(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ folder: clean, refs });
    }

    // Un dossier réclamé par trois notes est un thème ; par une seule, un pari.
    groups.sort((a, b) => b.refs.length - a.refs.length);
    return groups.slice(0, input.maxGroups);
  } catch {
    // Ollama éteint ou timeout : rien à proposer, rien à casser.
    return [];
  }
}
