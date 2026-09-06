"use client";

/**
 * AiMarginsPanel — affichage des commentaires IA par bloc.
 *
 * Purement présentationnel : le moteur (découpage, appels Ollama, cache par
 * hash) vit dans `useAiMargins`, appelé par le NoteEditor. C'est la colonne
 * intégrée, ancrée aux blocs ; quand la note est trop étroite pour elle, les
 * mêmes cartes ({@link AiCommentCard}) sont rendues par le panneau droit.
 */

import { forwardRef, useEffect, useRef } from "react";
import Link from "next/link";
import { Spinner, Button } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import {
  Sparkle,
  ArrowsClockwise,
  Lightbulb,
  Question,
  Warning,
  LinkSimple,
  PencilSimple,
  ListBullets,
  Check,
  X,
} from "@phosphor-icons/react";
import { blockKey, blockSnippet, type AiMarginsEngine } from "@/hooks/useAiMargins";
import type { BlockComment, NoteBlock } from "@/lib/ai/blockComments";

const KIND_ICON: Record<BlockComment["kind"], React.ReactNode> = {
  suggestion: <Lightbulb size={13} />,
  question: <Question size={13} />,
  issue: <Warning size={13} />,
  link: <LinkSimple size={13} />,
  rewrite: <PencilSimple size={13} />,
  format: <ListBullets size={13} />,
};

const KIND_COLOR: Record<BlockComment["kind"], string> = {
  suggestion: "var(--accent)",
  question: "var(--info)",
  issue: "var(--destructive)",
  link: "var(--link)",
  rewrite: "var(--success)",
  format: "var(--warning)",
};

const KIND_ACTION: Record<BlockComment["kind"], string> = {
  suggestion: "Appliquer la correction",
  question: "Appliquer la correction",
  issue: "Appliquer la correction",
  link: "Appliquer la correction",
  rewrite: "Remplacer",
  format: "Mettre en forme",
};


/**
 * Une carte de suggestion. Extraite pour que la colonne de marge et le panneau
 * droit rendent exactement la même chose — deux copies auraient divergé au
 * premier ajustement.
 */
export const AiCommentCard = forwardRef<
  HTMLDivElement,
  {
    block: NoteBlock;
    comment: BlockComment;
    active?: boolean;
    onHoverBlock?: (blockText: string | null) => void;
    onApplyFix?: (block: NoteBlock, newText: string) => void;
    onDismiss?: (block: NoteBlock) => void;
  }
>(function AiCommentCard({ block, comment, active = false, onHoverBlock, onApplyFix, onDismiss }, ref) {
  const fix = comment.fix && comment.fix.trim() !== block.text.trim() ? comment.fix : null;
  return (
    <div
      ref={ref}
      className="cursor-default rounded-lg px-2.5 py-2 transition-all"
      style={{
        background: active ? "color-mix(in srgb, var(--accent) 9%, var(--surface-1))" : "var(--surface-1)",
        border: active
          ? "1px solid color-mix(in srgb, var(--accent) 55%, var(--border-subtle))"
          : "1px solid var(--border-subtle)",
        boxShadow: active ? "0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
      }}
      onMouseEnter={() => onHoverBlock?.(block.text)}
      onMouseLeave={() => onHoverBlock?.(null)}
    >
      {/* Ancre : extrait du bloc commenté */}
      <div className="mb-1 truncate text-[10.5px]" style={{ color: "var(--text-muted)" }} title={block.text}>
        {blockSnippet(block.text)}
      </div>
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0" style={{ color: KIND_COLOR[comment.kind] }}>
          {KIND_ICON[comment.kind]}
        </span>
        {/* La colonne fait 260 px : une URL non coupable déborderait la carte
            et, avec elle, la page. */}
        <p className="min-w-0 break-words text-[12px] leading-snug" style={{ color: "var(--text-primary)" }}>
          {comment.comment}
        </p>
      </div>
      {fix && (
        /* Aperçu intégral de la réécriture : le bouton applique tout, tronquer
           ferait valider un remplacement non lu. */
        <div
          className="mt-2 max-h-48 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded px-2 py-1.5 text-[11px] leading-snug"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            borderLeft: `2px solid ${KIND_COLOR[comment.kind]}`,
          }}
        >
          {fix}
        </div>
      )}
      {/* Accepter / refuser en un clic : sans le refus, une suggestion écartée
          revenait à chaque passe. « Écarter » reste offert même sans correctif. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {fix && (
          <Button
            variant="primary"
            size="sm"
            onPress={() => onApplyFix?.(block, fix)}
            className="sn-hit h-7 min-w-0 gap-1 px-2.5 text-[11px]"
          >
            <Check size={12} />
            {KIND_ACTION[comment.kind]}
          </Button>
        )}
        {onDismiss && (
          <Tooltip content="Ne plus proposer cette suggestion">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onDismiss(block)}
              aria-label="Écarter la suggestion"
              className="sn-hit h-7 min-w-0 gap-1 px-2 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={12} />
              Écarter
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
});

export function AiMarginsPanel({
  engine,
  onHoverBlock,
  onApplyFix,
  onDismiss,
}: {
  engine: AiMarginsEngine;
  /** Survol d'un commentaire → texte du bloc à surligner dans l'éditeur (null = fin). */
  onHoverBlock?: (blockText: string | null) => void;
  /** Applique une correction : le bloc est désigné par identité, pas par texte. */
  onApplyFix?: (block: NoteBlock, newText: string) => void;
  /** Écarte une suggestion. */
  onDismiss?: (block: NoteBlock) => void;
}): React.JSX.Element {
  const {
    comments, status, errorMsg, available, analyzing, fullPass, activeKey, model,
    nothingToAnalyze, forceRerun,
  } = engine;

  // Centre la carte active dans la marge quand le caret change de bloc.
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activeKey) activeCardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);

  return (
    <aside
      className="flex h-full w-full flex-col gap-3 overflow-y-auto py-3 pl-3"
      aria-label="Marges IA"
    >
      <div className="flex items-center justify-between">
        <span className="sn-eyebrow sn-eyebrow--compact flex items-center gap-1.5">
          <Sparkle size={13} weight="fill" /> Marges IA
        </span>
        <Tooltip content="Tout réanalyser">
          <Button
            variant="ghost"
            size="sm"
            isIconOnly={!fullPass}
            aria-label={
              fullPass
                ? `Réanalyse complète : ${fullPass.done} bloc sur ${fullPass.total}`
                : "Tout réanalyser"
            }
            onPress={forceRerun}
            className={fullPass ? "h-6 min-w-0 gap-1 px-1.5" : "h-6 w-6 min-w-0"}
          >
            {status === "running" || fullPass ? (
              <Spinner size="sm" aria-hidden="true" />
            ) : (
              <ArrowsClockwise size={13} style={{ color: "var(--text-muted)" }} />
            )}
            {/* Sur une note longue, la boucle dure des minutes : sans compteur,
                le bouton a l'air de ne rien faire. */}
            {fullPass && (
              <span className="text-[10.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {fullPass.done}/{fullPass.total}
              </span>
            )}
          </Button>
        </Tooltip>
      </div>

      {status === "nomodel" && (
        <div className="flex flex-col gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <p>
            Modèle{" "}
            <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--destructive)" }}>{model}</code>{" "}
            introuvable sur Ollama.
          </p>
          {/* `/settings` n'existe pas dans ce routeur — la page est `/parametres`. */}
          <Link href="/parametres" className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
            Choisir un modèle installé (Réglages → IA)
          </Link>
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
          {nothingToAnalyze
            ? "Trop court pour être commenté : quelques mots de plus et l'IA prend le relais."
            : "Écrivez quelques lignes : chaque bloc reçoit un commentaire de l'IA, mis en cache jusqu'à ce que vous le modifiiez."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {comments.map(({ block, comment }) => {
          const key = blockKey(block);
          const isActive = key === activeKey;
          return (
            <AiCommentCard
              key={key}
              ref={isActive ? activeCardRef : undefined}
              block={block}
              comment={comment}
              active={isActive}
              onHoverBlock={onHoverBlock}
              onApplyFix={onApplyFix}
              onDismiss={onDismiss}
            />
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
