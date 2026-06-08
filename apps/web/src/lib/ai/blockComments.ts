/**
 * blockComments — commentaires IA par bloc.
 *
 * Découpe le corps markdown en blocs, attribue à chacun un hash stable de son
 * contenu, et produit un court commentaire IA par bloc (suggestion / question /
 * incohérence). Le hash sert de clé de cache : un bloc inchangé n'est jamais
 * ré-analysé. Les fonctions pures sont exportées et testées ; l'appel réseau
 * vit dans `analyzeBlock`.
 */

export interface NoteBlock {
  /** Hash stable du texte du bloc (clé de cache). */
  hash: string;
  /** Texte markdown du bloc. */
  text: string;
  /** Position dans la note (pour l'ordre d'affichage). */
  index: number;
}

export interface BlockComment {
  /** Commentaire affiché, vide si rien à dire. */
  comment: string;
  /** Catégorie pour l'icône/teinte. */
  kind: "suggestion" | "question" | "issue" | "link";
  /** Réécriture complète du bloc proposée, applicable en 1 clic. Optionnel. */
  fix?: string;
}

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
 * texte normalisé (trim) du bloc.
 */
export function splitBlocks(markdown: string): NoteBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  let buf: string[] = [];
  let inFence = false;
  let index = 0;

  const flush = (): void => {
    const text = buf.join("\n").trim();
    if (text) {
      blocks.push({ hash: hashText(text), text, index });
      index++;
    }
    buf = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (inFence) {
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line);
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

/** Vrai si le bloc mérite une analyse (assez de substance). */
export function isSubstantive(text: string): boolean {
  const stripped = text.replace(/[#>*`~_[\]|-]/g, "").trim();
  // Ignore titres seuls, séparateurs, lignes trop courtes.
  if (stripped.length < 40) return false;
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) return false;
  return true;
}

const KIND_VALUES: BlockComment["kind"][] = ["suggestion", "question", "issue", "link"];

function coerceKind(v: unknown): BlockComment["kind"] {
  return KIND_VALUES.includes(v as BlockComment["kind"]) ? (v as BlockComment["kind"]) : "suggestion";
}

/** Parse tolérant de la réponse JSON du modèle pour un bloc. */
export function parseBlockComment(raw: string): BlockComment | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const comment = typeof o["comment"] === "string" ? o["comment"].trim() : "";
  if (!comment) return null;
  const fixRaw = typeof o["fix"] === "string" ? o["fix"].trim() : "";
  const out: BlockComment = { comment, kind: coerceKind(o["kind"]) };
  if (fixRaw) out.fix = fixRaw;
  return out;
}

function buildBlockPrompt(noteTitle: string, blockText: string, noteContext: string): string {
  return `Tu es un relecteur qui annote UN bloc précis d'une note, en marge.

RÈGLES STRICTES :
- Réponds EXCLUSIVEMENT en FRANÇAIS.
- Le commentaire doit CITER un mot ou un passage précis DE CE BLOC (entre guillemets) — interdit les remarques génériques du type « ajoutez des détails », « clarifiez », « précisez le contexte ».
- Une seule remarque, ≤ 20 mots, concrète et spécifique à ce bloc.
- Si tu n'as rien de précis et utile à dire, renvoie un commentaire VIDE. Mieux vaut rien qu'une banalité.
- Choisis le bon "kind" :
  • "issue" = contredit un autre passage de la note,
  • "link" = devrait renvoyer à une autre note/notion citée ailleurs,
  • "question" = ambiguïté factuelle réelle dans ce bloc,
  • "suggestion" = amélioration concrète et ciblée.

Si — et seulement si — tu peux proposer une correction concrète et sûre, mets dans "fix" le BLOC ENTIER RÉÉCRIT (markdown, prêt à remplacer tel quel : corrige fautes/formulation/cohérence sans changer le sens ni inventer de faits). Sinon, omets "fix" ou laisse-le vide. Ne mets JAMAIS de fix qui supprime de l'information.

Réponds UNIQUEMENT par du JSON valide, rien d'autre :
{"comment":"<remarque en français citant le bloc, ou vide>","kind":"suggestion|question|issue|link","fix":"<bloc réécrit, ou vide>"}

TITRE DE LA NOTE : ${noteTitle}

RESTE DE LA NOTE (pour repérer incohérences/liens) :
${noteContext.slice(0, 1200)}

BLOC À ANNOTER (commente CELUI-CI uniquement) :
"""
${blockText.slice(0, 800)}
"""`;
}

/** Liste les modèles installés sur l'hôte Ollama (`/api/tags`). Peut lever. */
export async function listOllamaModels(host: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${host}/api/tags`, { signal });
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
  const res = await fetch(`${opts.host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      prompt: buildBlockPrompt(opts.noteTitle, opts.blockText, opts.noteContext),
      stream: false,
      options: { temperature: 0.45 },
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return parseBlockComment(data.response ?? "");
}
