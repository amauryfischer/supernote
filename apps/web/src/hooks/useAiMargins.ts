"use client";

/**
 * useAiMargins — moteur des commentaires IA par bloc.
 *
 * Découpe le corps de la note en blocs, envoie à Ollama ceux qui ne sont pas
 * déjà en cache (clé = hash du contenu) et expose l'état pour affichage. Le
 * moteur vit dans un hook plutôt que dans le panneau parce que sous 1024 px les
 * commentaires sont dans un tiroir : le panneau n'est monté qu'à l'ouverture,
 * l'analyse doit tourner quand même.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readOllamaHost } from "./useAutoTitle";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  splitBlocks,
  analysisUnits,
  isSubstantive,
  analyzeBlock,
  listOllamaModels,
  modelInstalled,
  bestBlockMatchIndex,
  contextAround,
  normalizeEol,
  dismissedKey,
  loadDismissedComments,
  saveDismissedComments,
  type BlockComment,
  type NoteBlock,
} from "@/lib/ai/blockComments";

const DEBOUNCE_MS = 2500;
/**
 * Blocs (re)traités par passe. Volontairement bas : ce qui intéresse
 * l'utilisateur, c'est le bloc où il a les doigts et son voisinage immédiat, pas
 * l'analyse du document entier. Le tri par caret ci-dessous s'applique AVANT
 * cette troncature ; les blocs lointains seront traités quand le caret s'y
 * déplacera, et le cache par hash garantit qu'aucun ne l'est deux fois.
 */
const MAX_BLOCKS_PER_RUN = 4;
/**
 * Second déclencheur, plus lent que la frappe : avec un plafond aussi bas, les
 * blocs lointains ne seraient jamais atteints si seule la frappe relançait une
 * passe. Plus long que `DEBOUNCE_MS` pour que, après une salve de frappe, la
 * passe déclenchée par le corps parte la première.
 */
const CARET_DEBOUNCE_MS = 3500;
/** Battement entre deux blocs, pour que les commentaires apparaissent un par un. */
const BEAT_MS = 160;
/** Borne dure de la boucle « Tout réanalyser » : 4 blocs par lot. */
const MAX_FULL_PASS_BATCHES = 200;

/**
 * Les colonnes empilées montent un NoteEditor — donc un moteur — par note
 * ouverte. Sans file d'attente, trois colonnes lancent trois séries d'appels de
 * front sur un Ollama local qui, lui, sérialise et sature sa VRAM. Un seul
 * appel à la fois pour toute l'application.
 */
let ollamaQueue: Promise<unknown> = Promise.resolve();
function withOllamaTurn<T>(fn: () => Promise<T>): Promise<T> {
  const turn = ollamaQueue.then(fn, fn);
  ollamaQueue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

export interface DisplayComment {
  block: NoteBlock;
  comment: BlockComment;
}

export type AiMarginsStatus = "idle" | "running" | "error" | "nomodel";

/**
 * Issue d'une passe. La boucle « Tout réanalyser » doit distinguer une panne
 * (à signaler) d'une annulation (silencieuse) et d'une file déjà occupée
 * (à réessayer) — sans ça elle s'arrêtait dans les trois cas sans un mot.
 */
type RunOutcome = "done" | "busy" | "aborted" | "error" | "nomodel";

export interface AiMarginsProgress {
  snippet: string;
  done: number;
  total: number;
}

/** Avancement d'un « Tout réanalyser », en blocs de la note. */
export interface FullPassProgress {
  done: number;
  total: number;
}

export interface AiMarginsEngine {
  /** Commentaires disponibles, dans l'ordre des blocs de la note. */
  comments: DisplayComment[];
  status: AiMarginsStatus;
  errorMsg: string | null;
  /** Modèles installés sur l'hôte — rempli seulement en statut `nomodel`. */
  available: string[];
  /** Bloc en cours d'analyse (un seul à la fois). */
  analyzing: AiMarginsProgress | null;
  /** Avancement d'un « Tout réanalyser » en cours, `null` sinon. */
  fullPass: FullPassProgress | null;
  /** Clé du bloc portant le caret, pour surligner sa carte. */
  activeKey: string | null;
  /** Modèle Ollama visé — affiché dans le message « modèle introuvable ». */
  model: string;
  /**
   * La note contient du texte, mais rien d'assez consistant pour être commenté.
   * Sans ça, « je n'ai rien regardé » et « je n'ai rien à dire » s'affichaient
   * exactement pareil : un panneau vide.
   */
  nothingToAnalyze: boolean;
  /** Écarte une suggestion : elle disparaît et ne revient pas à la passe suivante. */
  dismiss: (block: NoteBlock) => void;
  /** Marque tous les blocs à refaire et relance jusqu'à épuisement. */
  forceRerun: () => void;
}

export interface UseAiMarginsOptions {
  /** Faux = aucun timer, aucun appel réseau ; les cartes déjà obtenues restent. */
  enabled: boolean;
  /** Note analysée — change ⇒ file annulée et cache invalidé. */
  noteId: string;
  noteTitle: string;
  /** Lecture du corps courant (ref vivante côté NoteEditor). */
  getBody: () => string;
  /** Incrémenté à chaque frappe — planifie la passe suivante. */
  bodyVersion: number;
  /** Texte rendu du bloc portant le caret. */
  activeBlockText?: string | null;
}

/** Extrait lisible d'un bloc markdown, pour l'ancre affichée sur la carte. */
export function blockSnippet(text: string): string {
  return text.replace(/[#>*`~_[\]|-]/g, "").trim().slice(0, 48) || "bloc";
}

/**
 * Identifie une carte : le hash seul ne suffit pas, deux blocs au contenu
 * identique le partagent (clés React dupliquées, mauvaise cible à l'application).
 */
export function blockKey(block: NoteBlock): string {
  return `${block.hash}:${block.index}`;
}

export function useAiMargins({
  enabled,
  noteId,
  noteTitle,
  getBody,
  bodyVersion,
  activeBlockText,
}: UseAiMarginsOptions): AiMarginsEngine {
  const { settings } = useSettings();
  const model = settings.ia.ollamaModel;

  // Le commentaire dépend du bloc MAIS aussi du titre et du contexte de sa note
  // et du modèle interrogé : deux entrées de journal partagent des blocs de
  // gabarit identiques, et changer de modèle doit tout réanalyser.
  const cacheKey = useCallback(
    (hash: string) => `${noteId}:${model}:${hash}`,
    [noteId, model],
  );

  // Cache persistant : clé de bloc → commentaire (null = analysé, rien à dire).
  const cacheRef = useRef<Map<string, BlockComment | null>>(new Map());
  // Clés à refaire malgré leur présence en cache (« Tout réanalyser »). La
  // carte existante reste affichée jusqu'à l'arrivée de son remplaçante.
  const staleRef = useRef<Set<string>>(new Set());
  // Suggestions écartées à la main : ni affichées, ni re-demandées au modèle
  // tant que le bloc n'a pas changé (la clé porte son hash). Persisté — une
  // remarque écartée qui revient au rechargement, c'est un bouton qui ne marche
  // pas, et le panneau qu'on cesse de lire.
  const dismissedRef = useRef<Map<string, number> | null>(null);
  if (dismissedRef.current === null) dismissedRef.current = loadDismissedComments();
  // Le modèle n'entre PAS dans cette clé : l'utilisateur a écarté une remarque
  // sur un bloc, pas sur un moteur d'inférence.
  const dismissKey = useCallback(
    (hash: string) => dismissedKey(noteId, hash),
    [noteId],
  );
  const [comments, setComments] = useState<DisplayComment[]>([]);
  const [status, setStatus] = useState<AiMarginsStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState<AiMarginsProgress | null>(null);
  const [fullPass, setFullPass] = useState<FullPassProgress | null>(null);
  const [nothingToAnalyze, setNothingToAnalyze] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const rerunPendingRef = useRef(false);
  // Jeton de propriété de la boucle « Tout réanalyser » : un second clic prend
  // la main, et l'ancienne boucle ne doit plus toucher à l'état commun.
  const fullPassTokenRef = useRef<object | null>(null);
  // Note réellement affichée, lisible depuis la boucle de réanalyse complète.
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  // Le titre est lu par ref : dans les deps de `run`, chaque frappe dans le
  // champ titre recréait la callback et relançait les deux debounces.
  const noteTitleRef = useRef(noteTitle);
  noteTitleRef.current = noteTitle;

  // Le bloc actif change à chaque mouvement du caret : le lire par ref évite de
  // recréer `run` et donc de relancer le debounce à chaque clic dans le texte.
  const activeTextRef = useRef<string | null>(null);
  activeTextRef.current = activeBlockText ?? null;

  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(t);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const t = setTimeout(done, ms);
      signal.addEventListener("abort", done, { once: true });
    });

  // Reconstruit la liste affichée depuis le cache, dans l'ordre des blocs.
  const rebuild = useCallback((blocks: NoteBlock[]) => {
    const cache = cacheRef.current;
    const out: DisplayComment[] = [];
    for (const b of blocks) {
      if (dismissedRef.current?.has(dismissKey(b.hash))) continue;
      const c = cache.get(cacheKey(b.hash));
      if (c) out.push({ block: b, comment: c });
    }
    setComments(out);
  }, [cacheKey, dismissKey]);

  const run = useCallback(async (): Promise<RunOutcome> => {
    // Sérialisé, jamais interrompu par la frappe : un bloc coûte ~13 s, et
    // abandonner la passe à chaque touche ne produisait aucun commentaire tant
    // que l'utilisateur écrivait — soit exactement l'inverse de ce qu'on veut.
    // Une demande arrivée pendant une passe est mise en attente et repart à sa
    // fin. Seuls le changement de note, l'extinction et le démontage abortent.
    if (runningRef.current) {
      rerunPendingRef.current = true;
      return "busy";
    }
    const ac = new AbortController();
    abortRef.current = ac;
    runningRef.current = true;

    try {
      // Normalisé une fois : les offsets de `splitBlocks` s'y réfèrent.
      const body = normalizeEol(getBody());
      const blocks = splitBlocks(body);
      // Les cartes sont ancrées sur les UNITÉS d'analyse (bloc long seul, ou
      // groupe de lignes courtes), pas sur les blocs bruts.
      const units = analysisUnits(body, blocks);
      const substantive = units.filter((b) => isSubstantive(b.text));
      setNothingToAnalyze(blocks.length > 0 && substantive.length === 0);

      // Purge le cache des entrées disparues — y compris celles d'une autre note
      // ou d'un autre modèle, puisque la clé les porte (borne la mémoire).
      const present = new Set(units.map((b) => cacheKey(b.hash)));
      for (const key of cacheRef.current.keys()) {
        if (!present.has(key)) cacheRef.current.delete(key);
      }
      for (const key of staleRef.current) {
        if (!present.has(key)) staleRef.current.delete(key);
      }
      // Purge ciblée : les écartements de cette note dont le bloc a disparu.
      // Les autres notes ne sont pas lisibles d'ici — le plafond global s'en
      // charge (cf. `saveDismissedComments`).
      const presentDismiss = new Set(units.map((b) => dismissKey(b.hash)));
      const prefix = `${noteIdRef.current}:`;
      let purged = false;
      for (const key of dismissedRef.current?.keys() ?? []) {
        if (key.startsWith(prefix) && !presentDismiss.has(key)) {
          dismissedRef.current?.delete(key);
          purged = true;
        }
      }
      if (purged && dismissedRef.current) saveDismissedComments(dismissedRef.current);

      rebuild(units);

      const pending = substantive.filter((b) => {
        if (dismissedRef.current?.has(dismissKey(b.hash))) return false;
        const key = cacheKey(b.hash);
        return !cacheRef.current.has(key) || staleRef.current.has(key);
      });
      // Le bloc sous le caret passe en tête : c'est celui qu'on écrit, donc celui
      // dont le commentaire a une chance d'arriver pendant qu'il est encore utile.
      const activeText = activeTextRef.current;
      const activeIdx = activeText ? bestBlockMatchIndex(activeText, pending.map((b) => b.text)) : -1;
      const ordered =
        activeIdx > 0
          ? [pending[activeIdx]!, ...pending.filter((_, i) => i !== activeIdx)]
          : pending;
      const toAnalyze = ordered.slice(0, MAX_BLOCKS_PER_RUN);
      if (toAnalyze.length === 0) {
        setStatus("idle");
        return "done";
      }

      setStatus("running");
      setErrorMsg(null);

      const host = readOllamaHost();
      // Préflight : évite des appels voués au 404 si le modèle n'est pas installé.
      const installed = await listOllamaModels(host, ac.signal);
      if (ac.signal.aborted) return "aborted";
      if (!modelInstalled(model, installed)) {
        setAvailable(installed);
        setAnalyzing(null);
        setStatus("nomodel");
        return "nomodel";
      }
      for (let i = 0; i < toAnalyze.length; i++) {
        const b = toAnalyze[i]!;
        if (ac.signal.aborted) return "aborted";
        setAnalyzing({ snippet: blockSnippet(b.text), done: i, total: toAnalyze.length });
        // Fenêtre autour du bloc, bloc élidé — pour repérer incohérences et
        // liens dans SON voisinage plutôt qu'en tête de document.
        const noteContext = contextAround(body, b.start, b.end);
        const c = await withOllamaTurn(() =>
          ac.signal.aborted
            ? Promise.resolve(null)
            : analyzeBlock({
                noteTitle: noteTitleRef.current,
                blockText: b.text,
                noteContext,
                host,
                model,
                signal: ac.signal,
              }),
        );
        if (ac.signal.aborted) return "aborted";
        // Seul CE bloc peut avoir été périmé par la frappe : on relit le corps
        // et on ne jette que lui. Les autres blocs de la passe restent valides,
        // c'est ce qui permet aux commentaires d'arriver pendant qu'on écrit
        // ailleurs.
        const freshBody = normalizeEol(getBody());
        const fresh = analysisUnits(freshBody, splitBlocks(freshBody));
        if (!fresh.some((fb) => fb.hash === b.hash)) continue;
        cacheRef.current.set(cacheKey(b.hash), c); // c peut être null (rien à dire)
        staleRef.current.delete(cacheKey(b.hash));
        rebuild(fresh); // révèle ce bloc
        await sleep(BEAT_MS, ac.signal);
      }
      if (ac.signal.aborted) return "aborted";
      setAnalyzing(null);
      setStatus("idle");
      return "done";
    } catch (e) {
      if (ac.signal.aborted) return "aborted";
      setAnalyzing(null);
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus("error");
      return "error";
    } finally {
      runningRef.current = false;
      // Frappe survenue pendant la passe : on la replanifie au lieu de l'avoir
      // tuée en vol.
      if (rerunPendingRef.current && !ac.signal.aborted) {
        rerunPendingRef.current = false;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { void runRef.current?.(); }, BEAT_MS);
      }
    }
  }, [getBody, model, rebuild, cacheKey, dismissKey]);

  // La replanification et la boucle de réanalyse appellent la dernière version
  // de `run` sans avoir à figurer dans ses dépendances.
  const runRef = useRef<(() => Promise<RunOutcome>) | null>(null);
  runRef.current = run;

  const activeKey = useMemo(() => {
    if (!activeBlockText || comments.length === 0) return null;
    const idx = bestBlockMatchIndex(activeBlockText, comments.map((c) => c.block.text));
    return idx >= 0 ? blockKey(comments[idx]!.block) : null;
  }, [activeBlockText, comments]);

  // Changement de note : NoteEditor ne remonte pas, c'est donc ici qu'on coupe
  // la file en cours et qu'on vide l'affichage — sinon les commentaires de la
  // note précédente restent, puis se repeignent, sur la nouvelle.
  useEffect(() => {
    abortRef.current?.abort();
    fullPassTokenRef.current = null;
    rerunPendingRef.current = false;
    staleRef.current.clear();
    setComments([]);
    setAnalyzing(null);
    setStatus("idle");
    setErrorMsg(null);
    setFullPass(null);
    setNothingToAnalyze(false);
    return () => {
      abortRef.current?.abort();
      // Couvre aussi le démontage : une réanalyse complète ne doit pas survivre
      // à la note qui l'a demandée.
      fullPassTokenRef.current = null;
    };
  }, [noteId]);

  // Extinction : on coupe la file mais on garde les cartes déjà obtenues. Une
  // sonde Ollama ratée fait clignoter `enabled` le temps d'un hoquet réseau,
  // ce n'est pas une raison de perdre le travail déjà affiché.
  useEffect(() => {
    if (enabled) return undefined;
    abortRef.current?.abort();
    fullPassTokenRef.current = null;
    rerunPendingRef.current = false;
    setAnalyzing(null);
    setFullPass(null);
    setStatus((s) => (s === "running" ? "idle" : s));
    return undefined;
  }, [enabled]);

  // Déclenchement auto, debouncé, à chaque changement du corps. Le debounce
  // planifie la passe SUIVANTE ; il n'annule plus celle qui tourne.
  useEffect(() => {
    if (!enabled) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void run(); }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, bodyVersion, run]);

  // Déplacer le caret est le second déclencheur. Sans lui, le plafond de 4 blocs
  // laisserait le reste d'une note longue éternellement sans commentaire : la
  // frappe seule ne ramène jamais l'analyse vers là où l'utilisateur regarde.
  useEffect(() => {
    if (!enabled || !activeBlockText) return undefined;
    const t = setTimeout(() => { void run(); }, CARET_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [enabled, activeBlockText, run]);

  /**
   * Écarter une suggestion. L'entrée reste en cache (pour ne pas la redemander)
   * mais la clé est marquée : `rebuild` la saute et `pending` ne la reprend pas.
   */
  const dismissComment = useCallback(
    (block: NoteBlock) => {
      dismissedRef.current?.set(dismissKey(block.hash), Date.now());
      if (dismissedRef.current) saveDismissedComments(dismissedRef.current);
      setComments((prev) => prev.filter((c) => c.block.hash !== block.hash));
    },
    [dismissKey],
  );

  /**
   * « Tout réanalyser » réanalyse vraiment tout : le plafond de 4 protège la
   * frappe d'une passe de fond, pas un clic délibéré. On enchaîne donc des lots
   * de 4 — plutôt qu'une passe unique qui monopoliserait le verrou Ollama —
   * jusqu'à épuisement des blocs substantiels.
   */
  const forceRerun = useCallback(() => {
    // Une passe complète tourne déjà : le second clic de l'inévitable
    // double-clic (bouton icône seule, rien ne bouge pendant plusieurs
    // secondes) ne doit pas en lancer une seconde. Mesuré : sans ce garde,
    // chaque bloc partait deux fois chez Ollama.
    if (fullPassTokenRef.current) return;
    // Geste délibéré de tout refaire : les suggestions écartées de CETTE note
    // reviennent dans le jeu, sinon « Tout réanalyser » ne réanalyserait pas
    // tout. Les autres notes gardent les leurs.
    const prefix = `${noteIdRef.current}:`;
    for (const key of dismissedRef.current?.keys() ?? []) {
      if (key.startsWith(prefix)) dismissedRef.current?.delete(key);
    }
    if (dismissedRef.current) saveDismissedComments(dismissedRef.current);
    const token = {};
    fullPassTokenRef.current = token;
    const noteAtStart = noteIdRef.current;
    const isStale = (b: NoteBlock): boolean => {
      const key = cacheKey(b.hash);
      return staleRef.current.has(key) || !cacheRef.current.has(key);
    };
    const substantive = (): NoteBlock[] => {
      const b = normalizeEol(getBody());
      return analysisUnits(b, splitBlocks(b)).filter((u) => isSubstantive(u.text));
    };
    // Le cache n'est PAS vidé d'entrée : chaque carte est remplacée à l'arrivée
    // de son remplaçante. Vider d'abord faisait perdre tout l'existant dès que
    // la boucle s'interrompait (frappe, panne, onglet en arrière-plan).
    for (const b of substantive()) staleRef.current.add(cacheKey(b.hash));
    void (async () => {
      try {
        for (let batch = 0; batch < MAX_FULL_PASS_BATCHES; batch++) {
          if (fullPassTokenRef.current !== token || noteIdRef.current !== noteAtStart) return;
          // Onglet en arrière-plan : les timers y sont bridés et personne ne
          // regarde — on rend la main plutôt que de tenir la file Ollama.
          if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
          const blocks = substantive();
          const remaining = blocks.filter(isStale);
          setFullPass({ done: blocks.length - remaining.length, total: blocks.length });
          if (remaining.length === 0) return;
          const outcome = (await runRef.current?.()) ?? "aborted";
          // La file était prise par la passe de frappe : ce n'est pas un échec,
          // on la laisse finir et on recompte.
          if (outcome === "busy") {
            await new Promise((r) => setTimeout(r, BEAT_MS * 4));
            continue;
          }
          // `error` / `nomodel` : `status` et `errorMsg` portent déjà le
          // message, la boucle s'arrête sans le masquer. `aborted` est
          // volontaire (changement de note, extinction), donc silencieux.
          if (outcome !== "done") return;
        }
      } finally {
        // Symétrique du `finally` de `run` : ne pas arracher son drapeau à une
        // boucle plus récente — un double-clic sur la pastille en lançait deux
        // qui s'entretuaient, laissant MOINS de cartes qu'avant le clic.
        if (fullPassTokenRef.current === token) {
          fullPassTokenRef.current = null;
          setFullPass(null);
        }
      }
    })();
  }, [getBody, cacheKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    comments, status, errorMsg, available, analyzing, fullPass, activeKey, model,
    nothingToAnalyze, dismiss: dismissComment, forceRerun,
  };
}
