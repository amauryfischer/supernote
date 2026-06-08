"use client";

/**
 * AiMarginsPanel — commentaires IA en marge, PAR BLOC.
 *
 * Chaque bloc substantiel de la note reçoit (au plus) un commentaire IA :
 * suggestion, question, incohérence ou lien manquant. Le résultat est mis en
 * cache par hash de contenu du bloc → un bloc inchangé n'est jamais
 * ré-analysé ; seuls les blocs nouveaux ou modifiés repassent par l'IA.
 *
 * Déclenchement automatique en debounce après chaque frappe. Pas de RAG ni
 * d'embeddings requis : l'analyse n'utilise que le bloc + le contexte de la
 * note (un appel Ollama generate par bloc à (re)traiter).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Button } from "@heroui/react";
import { Sparkle, ArrowsClockwise, Lightbulb, Question, Warning, LinkSimple, Check } from "@phosphor-icons/react";
import { readOllamaHost } from "@/hooks/useAutoTitle";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  splitBlocks,
  isSubstantive,
  analyzeBlock,
  listOllamaModels,
  modelInstalled,
  bestBlockMatchIndex,
  type BlockComment,
  type NoteBlock,
} from "@/lib/ai/blockComments";

const DEBOUNCE_MS = 2500;
/** Garde-fou : nombre max de blocs (re)traités par passe. */
const MAX_BLOCKS_PER_RUN = 25;

interface DisplayComment {
  block: NoteBlock;
  comment: BlockComment;
}

const KIND_ICON: Record<BlockComment["kind"], React.ReactNode> = {
  suggestion: <Lightbulb size={13} />,
  question: <Question size={13} />,
  issue: <Warning size={13} />,
  link: <LinkSimple size={13} />,
};

const KIND_COLOR: Record<BlockComment["kind"], string> = {
  suggestion: "var(--accent)",
  question: "#0ea5e9",
  issue: "var(--destructive)",
  link: "#8b5cf6",
};

export function AiMarginsPanel({
  noteTitle,
  getBody,
  bodyVersion,
  onHoverBlock,
  onApplyFix,
  activeBlockText,
}: {
  noteId: string;
  noteTitle: string;
  /** Lecture du corps courant (ref vivante côté NoteEditor). */
  getBody: () => string;
  /** Incrémenté à chaque frappe — déclenche le debounce. */
  bodyVersion: number;
  /** Survol d'un commentaire → texte du bloc à surligner dans l'éditeur (null = fin). */
  onHoverBlock?: (blockText: string | null) => void;
  /** Applique une correction : remplace `oldText` par `newText` dans la note. */
  onApplyFix?: (oldText: string, newText: string) => void;
  /** Texte du bloc où est le caret → surligne le commentaire correspondant. */
  activeBlockText?: string | null;
}): React.JSX.Element | null {
  const { settings } = useSettings();
  const model = settings.ia.ollamaModel;

  // Cache persistant : hash de bloc → commentaire (null = analysé, rien à dire).
  const cacheRef = useRef<Map<string, BlockComment | null>>(new Map());
  const [comments, setComments] = useState<DisplayComment[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "error" | "nomodel">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  // Progression visible : bloc en cours d'analyse + compteur.
  const [analyzing, setAnalyzing] = useState<{ snippet: string; done: number; total: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Petite pause abortable — donne un battement visuel entre deux blocs pour
  // que les commentaires apparaissent un par un, pas en grappe.
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
    });

  // Reconstruit la liste affichée depuis le cache, dans l'ordre des blocs.
  const rebuild = useCallback((blocks: NoteBlock[]) => {
    const cache = cacheRef.current;
    const out: DisplayComment[] = [];
    for (const b of blocks) {
      const c = cache.get(b.hash);
      if (c) out.push({ block: b, comment: c });
    }
    setComments(out);
  }, []);

  const run = useCallback(async () => {
    const body = getBody();
    const blocks = splitBlocks(body);
    const substantive = blocks.filter((b) => isSubstantive(b.text));

    // Purge le cache des blocs disparus (borne la mémoire).
    const present = new Set(blocks.map((b) => b.hash));
    for (const key of cacheRef.current.keys()) {
      if (!present.has(key)) cacheRef.current.delete(key);
    }

    rebuild(blocks);

    const toAnalyze = substantive
      .filter((b) => !cacheRef.current.has(b.hash))
      .slice(0, MAX_BLOCKS_PER_RUN);
    if (toAnalyze.length === 0) {
      setStatus("idle");
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("running");
    setErrorMsg(null);

    const host = readOllamaHost();
    // Le contexte = corps sans le bloc courant, pour repérer incohérences/liens.
    try {
      // Préflight : évite 25 appels voués au 404 si le modèle n'est pas installé.
      const installed = await listOllamaModels(host, ac.signal);
      if (ac.signal.aborted) return;
      if (!modelInstalled(model, installed)) {
        setAvailable(installed);
        setAnalyzing(null);
        setStatus("nomodel");
        return;
      }
      for (let i = 0; i < toAnalyze.length; i++) {
        const b = toAnalyze[i]!;
        if (ac.signal.aborted) return;
        // Affiche quel bloc est traité MAINTENANT (un seul à la fois).
        setAnalyzing({
          snippet: b.text.replace(/[#>*`~_[\]|-]/g, "").trim().slice(0, 48) || "bloc",
          done: i,
          total: toAnalyze.length,
        });
        const noteContext = body.replace(b.text, "…");
        const c = await analyzeBlock({
          noteTitle,
          blockText: b.text,
          noteContext,
          host,
          model,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        cacheRef.current.set(b.hash, c); // c peut être null (rien à dire)
        rebuild(blocks); // révèle ce bloc
        // Battement pour que l'apparition soit perçue une par une.
        await sleep(160, ac.signal);
      }
      if (!ac.signal.aborted) {
        setAnalyzing(null);
        setStatus("idle");
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setAnalyzing(null);
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    }
  }, [getBody, noteTitle, model, rebuild]);

  // Commentaire correspondant au bloc actif (caret) — pour le surlignage.
  const activeHash = useMemo(() => {
    if (!activeBlockText || comments.length === 0) return null;
    const idx = bestBlockMatchIndex(activeBlockText, comments.map((c) => c.block.text));
    return idx >= 0 ? comments[idx]!.block.hash : null;
  }, [activeBlockText, comments]);

  // Centre la carte active dans la marge quand le caret change de bloc.
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeHash) activeCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeHash]);

  // Déclenchement auto, debouncé, à chaque changement du corps.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void run(); }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [bodyVersion, run]);

  // Force une ré-analyse de tout (vide le cache) — bouton refresh.
  const forceRerun = useCallback(() => {
    cacheRef.current.clear();
    void run();
  }, [run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <aside
      className="flex h-full w-full flex-col gap-3 overflow-y-auto py-3 pl-3"
      aria-label="Marges IA"
    >
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          <Sparkle size={13} weight="fill" /> Marges IA
        </span>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          aria-label="Tout réanalyser"
          onPress={forceRerun}
          className="h-6 w-6 min-w-0"
        >
          {status === "running" ? (
            <Spinner size="sm" aria-hidden="true" />
          ) : (
            <ArrowsClockwise size={13} style={{ color: "var(--text-muted)" }} />
          )}
        </Button>
      </div>

      {status === "nomodel" && (
        <div className="flex flex-col gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <p>
            Modèle{" "}
            <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--destructive)" }}>{model}</code>{" "}
            introuvable sur Ollama.
          </p>
          <a href="/settings" className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
            Choisir un modèle installé (Réglages → IA)
          </a>
          {available.length > 0 && (
            <p className="text-[10.5px]">
              Disponibles : {available.filter((m) => !m.startsWith("nomic-embed")).join(", ")}
            </p>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <p>Analyse interrompue.</p>
          {errorMsg && (
            <p className="break-words font-mono text-[10.5px]" style={{ color: "var(--destructive)" }}>
              {errorMsg}
            </p>
          )}
        </div>
      )}

      {comments.length === 0 && status !== "running" && status !== "error" && status !== "nomodel" && (
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Écrivez quelques lignes : chaque bloc reçoit un commentaire de l'IA,
          mis en cache jusqu'à ce que vous le modifiiez.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {comments.map(({ block, comment }) => {
          const isActive = block.hash === activeHash;
          return (
          <div
            key={block.hash}
            ref={isActive ? activeCardRef : undefined}
            className="cursor-default rounded-lg px-2.5 py-2 transition-all"
            style={{
              background: isActive ? "color-mix(in srgb, var(--accent) 9%, var(--surface-1))" : "var(--surface-1)",
              border: isActive
                ? "1px solid color-mix(in srgb, var(--accent) 55%, var(--border-subtle))"
                : "1px solid var(--border-subtle)",
              boxShadow: isActive ? "0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
            }}
            onMouseEnter={() => onHoverBlock?.(block.text)}
            onMouseLeave={() => onHoverBlock?.(null)}
          >
            {/* Ancre : extrait du bloc commenté */}
            <div
              className="mb-1 truncate text-[10.5px]"
              style={{ color: "var(--text-muted)" }}
              title={block.text}
            >
              {block.text.replace(/[#>*`~_[\]|-]/g, "").trim().slice(0, 48) || "bloc"}
            </div>
            <div className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0" style={{ color: KIND_COLOR[comment.kind] }}>
                {KIND_ICON[comment.kind]}
              </span>
              <p className="text-[12px] leading-snug" style={{ color: "var(--text-primary)" }}>
                {comment.comment}
              </p>
            </div>
            {comment.fix && comment.fix.trim() !== block.text.trim() && (
              <div className="mt-2 flex flex-col gap-1.5">
                {/* Aperçu de la réécriture proposée */}
                <div
                  className="rounded px-2 py-1.5 text-[11px] leading-snug"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)", borderLeft: `2px solid ${KIND_COLOR.suggestion}` }}
                >
                  {comment.fix.length > 220 ? `${comment.fix.slice(0, 220)}…` : comment.fix}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onPress={() => onApplyFix?.(block.text, comment.fix!)}
                  className="h-7 min-w-0 gap-1 self-start px-2.5 text-[11px]"
                >
                  <Check size={12} />
                  Appliquer la correction
                </Button>
              </div>
            )}
          </div>
          );
        })}

        {/* Bloc en cours d'analyse — un seul à la fois, sous les terminés. */}
        {status === "running" && analyzing && (
          <div
            className="rounded-lg px-2.5 py-2"
            style={{ background: "var(--surface-1)", border: "1px dashed var(--border-subtle)" }}
          >
            <div className="mb-1 truncate text-[10.5px]" style={{ color: "var(--text-muted)" }}>
              {analyzing.snippet}
            </div>
            <div className="flex items-center gap-1.5">
              <Spinner size="sm" aria-hidden="true" />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Analyse… ({analyzing.done + 1}/{analyzing.total})
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
