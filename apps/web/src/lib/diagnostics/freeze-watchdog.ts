/**
 * Freeze watchdog — capture des indices sur les freezes du thread principal
 * (« figé, tactile mort ») pour diagnostiquer après coup un hang intermittent
 * et non reproductible sur le build déployé (prod), SANS débogueur attaché.
 *
 * Le défi d'un vrai freeze : une boucle synchrone infinie bloque le thread, donc
 * aucun timer / rAF / observer du thread principal ne peut s'exécuter pendant le
 * gel — impossible d'introspecter la stack depuis le JS. La parade ici repose
 * sur deux mécanismes presque gratuits :
 *
 *  1. Breadcrumbs. Appeler `breadcrumb(label)` juste avant d'entrer dans un
 *     hotspot synchrone à risque (édition, navigation, parse de formule…). Le
 *     label est écrit SYNCHRONEMENT dans localStorage (seulement quand il change
 *     — les crumbs identiques répétés sont gratuits). Si l'opération suivante
 *     gèle le thread pour toujours, le crumb survit au kill forcé de l'onglet et
 *     nomme ce qui tournait.
 *
 *  2. Observer longtask. `PerformanceObserver('longtask')` enregistre toute
 *     tâche dépassant LONGTASK_MS. Attrape les stalls lourds mais FINIS (il ne
 *     peut pas se déclencher pendant une boucle infinie — les breadcrumbs
 *     couvrent ce cas). Non supporté sur Safari/iOS → seuls les breadcrumbs
 *     marchent là-bas.
 *
 * Détection de fermeture non-propre : `pagehide`/`beforeunload` posent un flag
 * « clean ». Au boot suivant, si la session précédente ne s'est PAS terminée
 * proprement ET qu'on a un crumb, cette session a quasi-certainement gelé (un
 * freeze empêche le handler clean de tourner, puis l'utilisateur tue l'onglet).
 * On expose ce crumb + les longtasks via `getFreezeReport()`, affiché à l'écran
 * par <FreezeReportBanner/> (la console est inaccessible sur téléphone).
 */

const K = {
  crumb: "sn:freeze:crumb",
  longtasks: "sn:freeze:longtasks",
  clean: "sn:freeze:clean",
  errors: "sn:freeze:errors",
  lastAlive: "sn:freeze:lastAlive",
} as const;

/** Une tâche < ce seuil n'est pas notée (bruit). */
const LONGTASK_MS = 1000;
/** Au-delà de ce seuil, un stall fini est traité comme un freeze à signaler. */
const FREEZE_GRADE_MS = 2500;
/** Anneau borné de longtasks conservées. */
const MAX_LONGTASKS = 25;
/** Anneau borné d'erreurs (render React, promesses rejetées, window.onerror). */
const MAX_ERRORS = 10;
/** Cadence du battement de cœur : dater le dernier signe de vie du thread. */
const HEARTBEAT_MS = 5000;

export interface FreezeCrumb {
  label: string;
  /** Epoch ms (Date.now) au moment du crumb. */
  t: number;
}

export interface LongTaskRec {
  t: number;
  /** Durée arrondie en ms. */
  dur: number;
  /** Attribution du longtask (containerType:name / script), si disponible. */
  src?: string;
}

export interface ErrorRec {
  t: number;
  /** Origine : "react" (ErrorBoundary), "unhandledrejection", "window". */
  source: string;
  message: string;
  /** Début de la stack (tronquée), si disponible. */
  stack?: string;
}

export interface FreezeReport {
  /** Dernière activité connue avant le gel. */
  crumb: FreezeCrumb | null;
  /** Stalls finis enregistrés pendant la session précédente. */
  longTasks: LongTaskRec[];
  /** True si la session précédente ne s'est pas terminée proprement. */
  unclean: boolean;
  /** Erreurs capturées pendant la session précédente (contexte du gel). */
  errors: ErrorRec[];
  /** Dernier battement de cœur de la session précédente (epoch ms) — datent le
   *  gel : crumb.t = dernier changement de label, pas dernier signe de vie. */
  lastAlive: number | null;
}

let lastWrittenLabel: string | null = null;
let report: FreezeReport | null = null;

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* quota dépassé / mode privé / SSR — best-effort */
  }
}
function safeRemove(k: string): void {
  try {
    localStorage.removeItem(k);
  } catch {
    /* idem */
  }
}

/**
 * Marque le hotspot synchrone qu'on s'apprête à exécuter. À placer JUSTE avant
 * l'opération à risque. Écriture localStorage uniquement quand le label change,
 * donc appelable à haute fréquence (ex. onChange éditeur) sans coût.
 */
export function breadcrumb(label: string): void {
  if (label === lastWrittenLabel) return;
  lastWrittenLabel = label;
  safeSet(K.crumb, JSON.stringify({ label, t: Date.now() } satisfies FreezeCrumb));
}

/**
 * Enregistre une erreur dans l'anneau borné (écriture localStorage synchrone,
 * survit au kill de l'onglet). Alimenté par l'ErrorBoundary React et les
 * handlers globaux `error`/`unhandledrejection` : fournit le contexte des
 * erreurs qui précèdent souvent un gel. Best-effort, jamais d'exception.
 */
export function recordError(source: string, message: string, stack?: string): void {
  const arr = parseErrors(safeGet(K.errors));
  arr.push({
    t: Date.now(),
    source,
    message: String(message).slice(0, 500),
    ...(stack ? { stack: String(stack).slice(0, 1000) } : {}),
  });
  const capped = arr.length > MAX_ERRORS ? arr.slice(-MAX_ERRORS) : arr;
  safeSet(K.errors, JSON.stringify(capped));
}

/** Rapport sur le freeze présumé de la session précédente (null si rien). */
export function getFreezeReport(): FreezeReport | null {
  return report;
}

/** Efface le rapport courant + le store persistant (bouton « Ignorer »). */
export function clearFreezeReport(): void {
  report = null;
  safeRemove(K.crumb);
  safeRemove(K.longtasks);
  safeRemove(K.errors);
}

function parseCrumb(raw: string | null): FreezeCrumb | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (
      typeof v === "object" &&
      v !== null &&
      typeof (v as FreezeCrumb).label === "string" &&
      typeof (v as FreezeCrumb).t === "number"
    ) {
      return v as FreezeCrumb;
    }
  } catch {
    /* corrompu — ignoré */
  }
  return null;
}

function parseLongTasks(raw: string | null): LongTaskRec[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return v.filter(
        (e): e is LongTaskRec =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as LongTaskRec).t === "number" &&
          typeof (e as LongTaskRec).dur === "number",
      );
    }
  } catch {
    /* corrompu — ignoré */
  }
  return [];
}

function parseErrors(raw: string | null): ErrorRec[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) {
      return v.filter(
        (e): e is ErrorRec =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as ErrorRec).t === "number" &&
          typeof (e as ErrorRec).source === "string" &&
          typeof (e as ErrorRec).message === "string",
      );
    }
  } catch {
    /* corrompu — ignoré */
  }
  return [];
}

function parseLastAlive(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * À appeler une fois au boot, AVANT le rendu React. Calcule le rapport de la
 * session précédente, démarre une session propre, et branche l'observer.
 */
export function installFreezeWatchdog(): void {
  if (typeof window === "undefined") return;

  // ── 1. Lire la session précédente AVANT de toucher au store. ───────────────
  const prevClean = safeGet(K.clean) === "1";
  const prevCrumb = parseCrumb(safeGet(K.crumb));
  const prevLongTasks = parseLongTasks(safeGet(K.longtasks));
  const prevErrors = parseErrors(safeGet(K.errors));
  const prevLastAlive = parseLastAlive(safeGet(K.lastAlive));
  const bigStall = prevLongTasks.some((lt) => lt.dur >= FREEZE_GRADE_MS);
  // Erreurs capturées + fermeture non-propre = crash probable (l'ErrorBoundary
  // a rendu son fallback, l'utilisateur a rechargé). Un log d'erreur suivi d'une
  // fermeture PROPRE = géré/non-fatal, on ne dérange pas.
  const hadFatalish = prevErrors.length > 0 && !prevClean;
  // On ne signale que si ça ressemble à un gel/crash : fermeture non-propre avec
  // une dernière activité connue, OU un stall de grade-freeze, OU des erreurs
  // suivies d'une fermeture non-propre.
  if ((!prevClean && prevCrumb) || bigStall || hadFatalish) {
    report = {
      crumb: prevCrumb,
      longTasks: prevLongTasks,
      unclean: !prevClean,
      errors: prevErrors,
      lastAlive: prevLastAlive,
    };
  }

  // ── 2. Démarrer une session : pas-encore-propre, stores remis à zéro.
  safeSet(K.clean, "0");
  safeRemove(K.crumb);
  safeRemove(K.longtasks);
  safeRemove(K.errors);
  lastWrittenLabel = null;

  // Battement de cœur : dater le dernier signe de vie du thread principal. Un
  // gel infini stoppe l'interval → au boot suivant, `lastAlive` borne le début
  // du gel (impossible à déduire du seul crumb, qui date le dernier label).
  const beat = () => safeSet(K.lastAlive, String(Date.now()));
  beat();
  window.setInterval(beat, HEARTBEAT_MS);

  // Capture globale des erreurs — contexte des crashs/gels. Best-effort.
  window.addEventListener("error", (ev) => {
    const err = (ev as ErrorEvent).error;
    recordError(
      "window",
      (ev as ErrorEvent).message || String(err),
      err instanceof Error ? err.stack : undefined,
    );
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    recordError(
      "unhandledrejection",
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    );
  });

  const markClean = () => safeSet(K.clean, "1");
  // pagehide est le signal fiable sur mobile ; beforeunload en complément desktop.
  window.addEventListener("pagehide", markClean);
  window.addEventListener("beforeunload", markClean);
  // Passer en arrière-plan = sortie « propre » (l'OS peut tuer l'onglet sans
  // que ce soit un freeze) ; revenir au premier plan ré-arme la session. Ainsi
  // « unclean au boot » signifie spécifiquement « mort en avant-plan actif » —
  // exactement le profil d'un gel, ce qui élimine les kills OS en arrière-plan.
  document.addEventListener("visibilitychange", () => {
    safeSet(K.clean, document.visibilityState === "hidden" ? "1" : "0");
  });

  // ── 3. Observer longtask (stalls finis). ───────────────────────────────────
  if ("PerformanceObserver" in window) {
    try {
      const obs = new PerformanceObserver((list) => {
        const arr = parseLongTasks(safeGet(K.longtasks));
        for (const e of list.getEntries()) {
          if (e.duration >= LONGTASK_MS) {
            // Attribution : quel conteneur/script est responsable du stall.
            const attr = (
              e as PerformanceEntry & {
                attribution?: Array<{
                  containerType?: string;
                  containerName?: string;
                  containerSrc?: string;
                }>;
              }
            ).attribution;
            const first = Array.isArray(attr) ? attr[0] : undefined;
            const src = first
              ? [first.containerType, first.containerName || first.containerSrc]
                  .filter(Boolean)
                  .join(":")
              : e.name || undefined;
            arr.push({
              t: Date.now(),
              dur: Math.round(e.duration),
              ...(src ? { src } : {}),
            });
          }
        }
        const capped = arr.length > MAX_LONGTASKS ? arr.slice(-MAX_LONGTASKS) : arr;
        if (capped.length > 0) safeSet(K.longtasks, JSON.stringify(capped));
      });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {
      /* 'longtask' non supporté (Safari/iOS) — les breadcrumbs suffisent. */
    }
  }
}
