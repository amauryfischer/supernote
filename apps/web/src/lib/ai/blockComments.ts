/**
 * blockComments — commentaires IA par bloc.
 *
 * Découpe le corps markdown en blocs, attribue à chacun un hash stable de son
 * contenu, et produit un court commentaire IA par bloc (suggestion / question /
 * incohérence / reformulation / mise en forme). Le hash sert de clé de cache :
 * un bloc inchangé n'est jamais ré-analysé. Seul `analyzeBlock` touche le
 * réseau, le reste est pur.
 */

/** Réglage global des marges IA (surchargeable par note). */
export const AI_MARGINS_ENABLED_KEY = "supernote.ai.margins";

/**
 * Lit le réglage global. Défaut : activé — c'est un opt-out, pas un opt-in.
 * Ne dit QUE ce que l'utilisateur a choisi : le garde mobile porte sur la
 * valeur effective côté NoteEditor, pas ici, sinon l'interrupteur des réglages
 * afficherait « off » sur un écran étroit alors que la préférence est « on ».
 */
export function isAiMarginsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(AI_MARGINS_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Surcharge par note lue depuis `note.fields.aiMargins` : `null` = la note
 * hérite du réglage global, `true`/`false` = choix explicite de l'utilisateur.
 * Tolère les formes texte, le frontmatter YAML pouvant remonter des chaînes.
 */
export function parseAiMarginsOverride(raw: unknown): boolean | null {
  if (raw === true || raw === "true" || raw === "1") return true;
  if (raw === false || raw === "false" || raw === "0") return false;
  return null;
}


/** Suggestions écartées à la main, persistées d'une session à l'autre. */
export const AI_MARGINS_DISMISSED_KEY = "supernote.ai.margins.dismissed";
/**
 * Plafond d'entrées conservées. Au-delà, les plus anciennes sautent : le
 * stockage ne doit pas croître indéfiniment pour une fonction de confort.
 */
const MAX_DISMISSED = 500;

/**
 * Clé d'un écartement : note + hash du bloc, **sans le modèle ni le texte du
 * commentaire**. Le texte varie d'une génération à l'autre pour la même
 * remarque ; le hash, lui, change dès que l'utilisateur modifie le bloc — et
 * une nouvelle suggestion redevient alors légitime.
 */
export function dismissedKey(noteId: string, blockHash: string): string {
  return `${noteId}:${blockHash}`;
}

/** Écartements persistés : clé → date (ms) de l'écartement. */
export function loadDismissedComments(): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(AI_MARGINS_DISMISSED_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const out = new Map<string, number>();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number") out.set(k, v);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveDismissedComments(entries: Map<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    let kept: Iterable<[string, number]> = entries;
    if (entries.size > MAX_DISMISSED) {
      kept = [...entries].sort((a, b) => b[1] - a[1]).slice(0, MAX_DISMISSED);
    }
    window.localStorage.setItem(AI_MARGINS_DISMISSED_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota / stockage désactivé — l'écartement reste valable pour la session */
  }
}

export interface NoteBlock {
  /** Hash stable du texte du bloc (clé de cache). */
  hash: string;
  /** Texte markdown du bloc. */
  text: string;
  /** Position dans la note (pour l'ordre d'affichage). */
  index: number;
  /** Offset du premier caractère du bloc dans le corps normalisé (`\n`). */
  start: number;
  /** Offset de fin, exclu : `normalizeEol(body).slice(start, end) === text`. */
  end: number;
}

/** Normalise les fins de ligne — les offsets de `splitBlocks` s'y réfèrent. */
export function normalizeEol(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n");
}

export interface BlockComment {
  /** Commentaire affiché, vide si rien à dire. */
  comment: string;
  /** Catégorie pour l'icône/teinte. */
  kind: "suggestion" | "question" | "issue" | "link" | "rewrite" | "format";
  /** Réécriture complète du bloc proposée, applicable en 1 clic. Optionnel. */
  fix?: string;
}

/** Catégories dont la remarque n'a aucun sens sans texte de remplacement. */
const KINDS_REQUIRING_FIX: ReadonlySet<BlockComment["kind"]> = new Set(["rewrite", "format"]);

/** Hash FNV-1a 32 bits → hex. Déterministe, pas de Math.random. */
export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Découpe le markdown en blocs : groupes de lignes séparés par une ligne vide,
 * en gardant les blocs de code (``` ```) entiers. Le hash est calculé sur le
 * texte normalisé (trim) du bloc ; `start`/`end` situent ce texte dans le corps,
 * ce qui permet de remplacer LE bloc visé même si un bloc identique existe
 * ailleurs dans la note.
 */
export function splitBlocks(markdown: string): NoteBlock[] {
  const src = normalizeEol(markdown);
  const lines = src.split("\n");
  const blocks: NoteBlock[] = [];
  let buf = 0;
  let bufStart = 0;
  let bufEnd = 0;
  let inFence = false;
  let index = 0;
  let pos = 0;

  const push = (line: string, lineStart: number): void => {
    if (buf === 0) bufStart = lineStart;
    buf++;
    bufEnd = lineStart + line.length;
  };

  const flush = (): void => {
    if (buf > 0) {
      const raw = src.slice(bufStart, bufEnd);
      const text = raw.trim();
      if (text) {
        const start = bufStart + (raw.length - raw.trimStart().length);
        blocks.push({ hash: hashText(text), text, index, start, end: start + text.length });
        index++;
      }
    }
    buf = 0;
  };

  for (const line of lines) {
    const lineStart = pos;
    pos += line.length + 1;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      push(line, lineStart);
      continue;
    }
    if (inFence) {
      push(line, lineStart);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    push(line, lineStart);
  }
  flush();
  return blocks;
}

/** Normalise un texte pour comparer markdown source ↔ texte rendu du DOM. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`~_[\]|()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Index du meilleur élément candidat (textContent rendu) correspondant au bloc
 * markdown. Compare des préfixes normalisés dans les deux sens. -1 si rien.
 */
export function bestBlockMatchIndex(blockText: string, candidates: readonly string[]): number {
  const needle = normalizeForMatch(blockText);
  if (needle.length < 6) return -1;
  const nPrefix = needle.slice(0, 24);
  for (let i = 0; i < candidates.length; i++) {
    const hay = normalizeForMatch(candidates[i] ?? "");
    if (hay.length < 6) continue;
    if (hay.includes(nPrefix) || needle.includes(hay.slice(0, 24))) return i;
  }
  return -1;
}

/**
 * Contexte envoyé au modèle : une fenêtre AUTOUR du bloc, le bloc lui-même
 * élidé. Envoyer le début du document rendait `issue` (« contredit un autre
 * passage ») quasi impossible à déclencher au-delà des premiers caractères
 * d'une note longue. Même budget de caractères, mieux placé.
 */
export function contextAround(body: string, start: number, end: number, budget = 1100): string {
  const half = Math.floor(budget / 2);
  const from = Math.max(0, start - half);
  const to = Math.min(body.length, end + half);
  const head = from > 0 ? "…" : "";
  const tail = to < body.length ? "…" : "";
  return `${head}${body.slice(from, start)}…${body.slice(end, to)}${tail}`;
}

/** Texte du bloc débarrassé de son balisage, pour en mesurer la substance. */
function strippedLength(text: string): number {
  return text.replace(/[#>*`~_[\]|-]/g, "").trim().length;
}

/**
 * Plancher d'une unité d'analyse. Bas volontairement : « J'ai fait un reve ce
 * soir » fait 25 caractères et c'est exactement le genre de ligne qu'un
 * relecteur doit reprendre. Au-dessous, il n'y a plus de phrase à commenter.
 */
const MIN_UNIT_CHARS = 20;
/**
 * Au-dessus, un bloc se suffit à lui-même et part seul chez le modèle.
 * En-dessous, il est agrégé à ses voisins courts — sinon les notes écrites en
 * lignes brèves (listes, jets de pensée) n'étaient jamais analysées.
 */
const SOLO_BLOCK_CHARS = 40;
/** Taille visée d'un groupe de blocs courts : au-delà, on coupe. */
const MAX_GROUP_CHARS = 400;

/** Vrai si l'unité mérite une analyse (assez de substance). */
export function isSubstantive(text: string): boolean {
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return false;
  return strippedLength(text) >= MIN_UNIT_CHARS;
}

/**
 * Unités d'analyse : un bloc long part seul, les blocs courts CONSÉCUTIFS sont
 * regroupés en un seul passage (jusqu'à {@link MAX_GROUP_CHARS}).
 *
 * Un groupe est un `NoteBlock` synthétique dont `start`/`end` couvrent tous ses
 * membres et dont le `text` est relu depuis le corps : `body.slice(start, end)`
 * doit rester égal à `text`, sinon appliquer un `fix` réécrirait autre chose que
 * ce que le modèle a lu. Le `hash` porte sur ce texte fusionné, ce qui donne au
 * groupe sa propre entrée de cache et l'invalide dès qu'une de ses lignes bouge.
 *
 * Coûte MOINS d'appels que le découpage bloc à bloc : cinq lignes courtes font
 * désormais une requête au lieu de cinq (ou de zéro, quand elles étaient toutes
 * sous le seuil).
 */
export function analysisUnits(body: string, blocks: NoteBlock[]): NoteBlock[] {
  const src = normalizeEol(body);
  const out: NoteBlock[] = [];
  let group: NoteBlock[] = [];

  const flush = (): void => {
    if (group.length === 0) return;
    if (group.length === 1) {
      out.push(group[0]!);
    } else {
      const first = group[0]!;
      const last = group[group.length - 1]!;
      const text = src.slice(first.start, last.end);
      out.push({ hash: hashText(text), text, index: first.index, start: first.start, end: last.end });
    }
    group = [];
  };

  for (const b of blocks) {
    if (strippedLength(b.text) >= SOLO_BLOCK_CHARS) {
      flush();
      out.push(b);
      continue;
    }
    group.push(b);
    if (src.slice(group[0]!.start, b.end).length >= MAX_GROUP_CHARS) flush();
  }
  flush();
  return out;
}

const KIND_VALUES: BlockComment["kind"][] = [
  "suggestion",
  "question",
  "issue",
  "link",
  "rewrite",
  "format",
];

function coerceKind(v: unknown): BlockComment["kind"] {
  return KIND_VALUES.includes(v as BlockComment["kind"]) ? (v as BlockComment["kind"]) : "suggestion";
}

/**
 * Échappe les caractères de contrôle bruts restés DANS une chaîne JSON. Un
 * « fix » de mise en forme est multi-ligne par nature et les petits modèles y
 * laissent de vrais sauts de ligne, que `JSON.parse` refuse — sans ça, les
 * réponses `format` sont précisément celles qu'on ne sait jamais lire.
 */
function escapeRawControls(json: string): string {
  const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    out += inString && ESCAPES[ch] ? ESCAPES[ch] : ch;
  }
  return out;
}

/**
 * Échappe les guillemets restés bruts DANS une valeur (« le mot "périmètre" »).
 * Un guillemet ne ferme la chaîne que si le prochain caractère significatif
 * pourrait suivre une chaîne en JSON ; sinon il appartient au texte.
 */
function escapeRawQuotes(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === "\\") { out += ch; escaped = true; continue; }
    if (ch !== '"') { out += ch; continue; }
    if (!inString) { inString = true; out += ch; continue; }
    const next = json.slice(i + 1).replace(/^\s*/, "")[0];
    if (next === undefined || next === ":" || next === "," || next === "}" || next === "]") {
      inString = false;
      out += ch;
    } else {
      out += '\\"';
    }
  }
  return out;
}

/** Objets JSON de premier niveau contenus dans `s`, dans l'ordre. */
function topLevelObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; }
    }
  }
  return out;
}

/** Extrait un objet de la réponse du modèle, en réparant les écarts courants. */
function parseLooseObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const span = raw.slice(start, end + 1);
  const repaired = escapeRawControls(span);
  for (const candidate of [span, repaired, escapeRawQuotes(repaired)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // essai suivant
    }
  }
  // Réponse rendue en plusieurs objets collés. Un modèle bavard peut émettre
  // deux PROPOSITIONS distinctes : croiser leurs champs fabriquerait une carte
  // qui n'a jamais existé, et surtout un « fix » sans rapport avec le
  // commentaire affiché — qui réécrirait la note. On retient donc UNE
  // proposition entière : la première qui porte un commentaire.
  const objects: Record<string, unknown>[] = [];
  for (const chunk of topLevelObjects(repaired)) {
    try {
      objects.push(JSON.parse(chunk) as Record<string, unknown>);
    } catch {
      // fragment ignoré
    }
  }
  if (objects.length === 0) return null;
  const withComment = objects.find(
    (o) => typeof o["comment"] === "string" && o["comment"].trim() !== "",
  );
  if (!withComment) return objects[0]!;
  if (typeof withComment["fix"] === "string" && withComment["fix"].trim() !== "") {
    return withComment;
  }
  // Le « fix » n'est empruntable qu'à un fragment qui ne porte AUCUN
  // commentaire : il prolonge la même proposition, il n'en ouvre pas une autre.
  const orphanFix = objects.find(
    (o) =>
      o !== withComment &&
      (typeof o["comment"] !== "string" || o["comment"].trim() === "") &&
      typeof o["fix"] === "string" &&
      o["fix"].trim() !== "",
  );
  if (!orphanFix) return withComment;
  return {
    ...withComment,
    fix: orphanFix["fix"],
    // Le kind vient du fragment qui porte le fix quand celui-ci en propose un :
    // c'est lui qui décrit l'action réellement appliquée.
    kind: typeof orphanFix["kind"] === "string" ? orphanFix["kind"] : withComment["kind"],
  };
}


/**
 * Tournures par lesquelles un modèle dit « je n'ai rien à dire » tout en
 * remplissant le champ commentaire. Testées sur le texte sans accents.
 */
const EMPTY_PRAISE =
  /(ne necessite (aucune|pas|d)|(aucune|pas de) (correction|modification|reformulation|amelioration|remarque|suggestion|erreur|faute)|rien a (signaler|redire|corriger|ajouter|dire|reformuler|modifier)|(est|semble|parait|reste) (deja )?(correct|correcte|clair|claire|bien |bon |bonne|coherent|coherente|complet|complete|lisible|precis|precise|approprie|appropriee|satisfaisant|satisfaisante|comprehensible|explicite|valide)|aucun (probleme|souci|defaut)|tout (va bien|est correct)|phrase complete|n.appelle aucun|pas d.(erreur|ambiguite|incoherence|probleme)|ne pose (pas|aucun) |(bloc|passage|paragraphe|texte) (est|semble) vide|aucun contenu a commenter|rien (a|de) commenter|pas de contenu a commenter)/;

/** Marqueurs d'une vraie réserve : « c'est clair MAIS trop long » reste utile. */
const HAS_RESERVE = /\b(mais|toutefois|cependant|neanmoins|en revanche|pourtant|sauf)\b/;

function deaccent(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Vrai quand le commentaire se contente de constater que le bloc va bien.
 * Une carte qui annonce n'avoir rien à annoncer pousse les vraies suggestions
 * vers le bas et apprend à l'utilisateur que le panneau contient du bruit —
 * après quoi il cesse de le lire. Zéro carte vaut mieux qu'une carte creuse.
 */
export function isEmptyPraise(comment: string): boolean {
  const flat = deaccent(comment);
  if (HAS_RESERVE.test(flat)) return false;
  return EMPTY_PRAISE.test(flat);
}

/**
 * Parse tolérant de la réponse JSON du modèle pour un bloc. `blockText` permet
 * de rejeter un « fix » qui rend le bloc à l'identique.
 */
export function parseBlockComment(raw: string, blockText?: string): BlockComment | null {
  const o = parseLooseObject(raw);
  if (!o) return null;
  const comment = typeof o["comment"] === "string" ? o["comment"].trim() : "";
  if (!comment) return null;
  const fixRaw = typeof o["fix"] === "string" ? o["fix"].trim() : "";
  const kind = coerceKind(o["kind"]);
  // Un fix qui rend le bloc à l'identique n'offre aucune action : il serait
  // masqué à l'affichage, autant le traiter comme absent dès ici.
  const fix = fixRaw && fixRaw !== (blockText ?? "").trim() ? fixRaw : "";
  // « Reformule ceci » sans la reformulation ne laisse à l'utilisateur qu'un
  // reproche : on jette plutôt que d'afficher une remarque non actionnable.
  if (!fix && KINDS_REQUIRING_FIX.has(kind)) return null;
  // Rien à appliquer ET rien à reprocher : le modèle a rempli le champ pour ne
  // rien dire. `null` = « analysé, rien à signaler », le chemin prévu pour ça.
  if (!fix && isEmptyPraise(comment)) return null;
  const out: BlockComment = { comment, kind };
  if (fix) out.fix = fix;
  return out;
}

/**
 * Prompt d'annotation d'un bloc. Exporté pour pouvoir mesurer hors application
 * ce que le modèle renvoie réellement (répartition des `kind`, taux de rejet).
 */
export function buildBlockPrompt(noteTitle: string, blockText: string, noteContext: string): string {
  return `Tu es un relecteur qui annote UN bloc précis d'une note, en marge.

RÈGLES STRICTES :
- Réponds EXCLUSIVEMENT en FRANÇAIS.
- Le commentaire doit CITER un mot ou un passage précis DE CE BLOC (entre guillemets) — interdit les remarques génériques du type « ajoutez des détails », « clarifiez », « précisez le contexte ».
- Une seule remarque, ≤ 20 mots, concrète et spécifique à ce bloc.
- LE SILENCE EST LA RÉPONSE NORMALE : la plupart des blocs n'appellent aucune remarque. Dans ce cas renvoie {"comment":"","kind":"suggestion","fix":""} et rien d'autre.
- N'écris JAMAIS un commentaire pour dire que le bloc est correct, clair, complet, bien écrit, ou qu'il ne nécessite pas de correction. Ces réponses sont INTERDITES : le commentaire doit alors être VIDE.
- Ne commente que si tu proposes une amélioration précise. Mieux vaut rien qu'une banalité.
- Choisis le "kind" en descendant cette liste et en t'arrêtant au PREMIER qui s'applique :
  1. "format" = la structure ne colle pas : énumération en prose qui doit devenir une liste, lignes parallèles qui forment un tableau, ligne d'annonce qui doit devenir un titre markdown,
  2. "rewrite" = phrase lourde, verbeuse, passive ou à rallonge, qui dirait la même chose en bien moins de mots,
  3. "issue" = contredit un autre passage de la note,
  4. "link" = devrait renvoyer à une autre note/notion citée ailleurs,
  5. "question" = ambiguïté factuelle réelle dans ce bloc,
  6. "suggestion" = DERNIER RECOURS, uniquement si aucun des cinq précédents ne s'applique.

"fix" contient le BLOC ENTIER RÉÉCRIT (markdown, prêt à remplacer tel quel : ni commentaire, ni guillemets autour, ni explication). OBLIGATOIRE pour "rewrite" (version reformulée, même sens) et pour "format" (même contenu, structure markdown corrigée). Pour les autres "kind", ne le mets que si la correction est sûre. Ne mets JAMAIS de fix qui supprime de l'information ou invente un fait.

Réponds UNIQUEMENT par du JSON valide, rien d'autre :
{"comment":"<remarque en français citant le bloc, ou vide>","kind":"suggestion|question|issue|link|rewrite|format","fix":"<bloc réécrit, ou vide>"}

TITRE DE LA NOTE : ${noteTitle}

RESTE DE LA NOTE (pour repérer incohérences/liens) :
${noteContext.slice(0, 1200)}

BLOC À ANNOTER (commente CELUI-CI uniquement) :
"""
${blockText.slice(0, 800)}
"""`;
}

/**
 * Plafonds de temps. `withOllamaTurn` est un verrou de module : un fetch qui ne
 * se règle jamais gèlerait les marges de TOUTES les notes, et rien ne viendrait
 * le débloquer une fois que l'utilisateur a cessé de taper.
 */
const TAGS_TIMEOUT_MS = 10_000;
/**
 * 120 s : mesuré sur `qwen3.5:9b`, un bloc coûte 4 à 85 s selon la longueur du
 * `fix` à produire — mais un bloc a aussi mis 626 s. C'est ce genre de blocage
 * que le plafond doit couper, pas les réponses longues légitimes.
 */
const ANALYZE_TIMEOUT_MS = 120_000;

/**
 * Fetch borné dans le temps ET annulable par l'appelant. `fetchWithTimeout`
 * (useAutoTitle) impose son propre signal et perdrait celui du run : une passe
 * abandonnée continuerait d'occuper Ollama jusqu'au bout de sa réponse.
 */
async function fetchOllama(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const relay = (): void => ctrl.abort();
  signal?.addEventListener("abort", relay, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw new Error(`Ollama n'a pas répondu en ${Math.round(timeoutMs / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

/** Liste les modèles installés sur l'hôte Ollama (`/api/tags`). Peut lever. */
export async function listOllamaModels(host: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetchOllama(`${host}/api/tags`, {}, TAGS_TIMEOUT_MS, signal);
  if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
  const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
  const out: string[] = [];
  for (const m of data.models ?? []) {
    if (typeof m.name === "string") out.push(m.name);
    else if (typeof m.model === "string") out.push(m.model);
  }
  return out;
}

/** Vrai si `model` correspond à un modèle installé (tolère l'absence de `:tag`). */
export function modelInstalled(model: string, installed: readonly string[]): boolean {
  const want = model.includes(":") ? model : `${model}:latest`;
  return installed.some((m) => m === model || m === want || m.split(":")[0] === model);
}

export interface AnalyzeBlockOptions {
  noteTitle: string;
  blockText: string;
  noteContext: string;
  host: string;
  model: string;
  signal?: AbortSignal;
}

/** Analyse un bloc via Ollama. Retourne null si rien à signaler. Peut lever. */
export async function analyzeBlock(opts: AnalyzeBlockOptions): Promise<BlockComment | null> {
  const res = await fetchOllama(
    `${opts.host}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        prompt: buildBlockPrompt(opts.noteTitle, opts.blockText, opts.noteContext),
        stream: false,
        // Jusqu'à 25 blocs sérialisés par note : sans ces deux options, un
        // modèle à raisonnement réfléchit avant chaque bloc (~57 s au lieu de
        // ~1,3 s) et son raisonnement pollue la réponse que le parseur lit.
        think: false,
        keep_alive: "2h",
        // Mesuré sur qwen3.5:9b : une réponse réelle tient en 26 à 64 tokens
        // (commentaire + `fix` de 128 caractères au plus). Le pire cas légitime
        // — un bloc de 800 caractères entièrement remis en forme — reste sous
        // ~350. Au-delà, c'est une génération qui déraille : la coupure produit
        // un JSON invalide, donc aucune carte, ce qui est le bon échec.
        options: { temperature: 0.45, num_predict: 512 },
      }),
    },
    ANALYZE_TIMEOUT_MS,
    opts.signal,
  );
  if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return parseBlockComment(data.response ?? "", opts.blockText);
}
