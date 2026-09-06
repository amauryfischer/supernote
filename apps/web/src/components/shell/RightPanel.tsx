"use client";

import { Clock, GitBranch, Sparkle, X } from "@phosphor-icons/react";
import { memo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useShellChrome } from "./shell-chrome-context";
import { useUiMode } from "@/hooks/useUiMode";
import { PrioritiesWidget } from "@/components/todos/PrioritiesWidget";
import { AiCommentCard } from "@/components/notes/AiMarginsPanel";
import { blockKey } from "@/hooks/useAiMargins";
import {
  FolderProposalCard,
  useFolderProposalActions,
} from "@/lib/ai/InboxSortJournalEntry";
import { Button, Skeleton } from "@supernote/ui";

// ── Fixtures used when tRPC is unavailable (browser without IPC) ─────────────

interface FallbackItem {
  id: string;
  label: string;
  href: string;
  time: string;
}

const FALLBACK_ITEMS: FallbackItem[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "à l'instant";
  if (diffMins < 60) return `il y a ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `il y a ${diffDays} j`;
}

function entityLabel(entity: { typeName: string; fields: Record<string, unknown> }): string {
  const title = entity.fields["title"] ?? entity.fields["name"] ?? entity.fields["subject"];
  if (typeof title === "string" && title.trim()) return title;
  return entity.typeName;
}

function entityHref(entity: { id: string; typeName: string }): string {
  const type = entity.typeName.toLowerCase();
  if (type === "contact") return `/contacts/${entity.id}`;
  if (type === "note") return `/notes/${entity.id}`;
  return `/notes/${entity.id}`;
}


/**
 * Les suggestions de la note ouverte, rendues avec les MÊMES cartes que la
 * colonne intégrée. Elles restent visibles pendant qu'on écrit — c'est tout
 * l'intérêt d'un commentaire de marge, que la feuille modale qu'elles
 * remplacent supprimait.
 */
function AiMarginsSection({
  margins,
  title = "Suggestions IA",
}: {
  margins: NonNullable<ReturnType<typeof useShellChrome>["aiMargins"]>;
  /** « Sur cette note » quand un rangement occupe déjà l'intitulé au-dessus. */
  title?: string;
}) {
  return (
    // `min-h-0` : sans lui, un enfant en `overflow-y-auto` refuse de rétrécir
    // et c'est le panneau entier qui déborde.
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <Sparkle size={12} style={{ color: "var(--accent)" }} weight="fill" />
        <span className="sn-eyebrow sn-eyebrow--compact">{title}</span>
        <span className="ml-auto text-[10.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {margins.comments.length}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {margins.comments.map(({ block, comment }) => (
          <AiCommentCard
            key={blockKey(block)}
            block={block}
            comment={comment}
            onApplyFix={margins.onApply}
            onDismiss={margins.onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Rangement proposé par le tri de l'inbox. Même contrat que les commentaires de
 * marge — l'IA propose, l'utilisateur accepte ou écarte d'un clic — donc même
 * endroit. Visible qu'une note soit ouverte ou non : c'est en écrivant qu'on
 * tombe dessus, et c'est le seul moment où le tri a besoin d'une décision.
 *
 * `shrink-0` : le bloc passe AVANT les commentaires de marge sans manger la
 * hauteur qui leur est réservée, ni le repli priorités / récents hors note.
 */
function FolderProposalsSection({
  actions,
}: {
  actions: ReturnType<typeof useFolderProposalActions>;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5 px-1 pb-1">
        <Sparkle size={12} style={{ color: "var(--accent)" }} weight="fill" />
        <span className="sn-eyebrow sn-eyebrow--compact">Suggestions IA</span>
        <span className="ml-auto text-[10.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {actions.proposals.length}
        </span>
      </div>
      <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto">
        {actions.proposals.map((p) => (
          <FolderProposalCard key={p.id} proposal={p} actions={actions} />
        ))}
      </div>
    </div>
  );
}

// ── Git status footer ─────────────────────────────────────────────────────────

function GitStatusFooter() {
  const { data, isError } = trpc.git.status.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const text =
    !data || isError
      ? "vault · aucun changement"
      : data.changes.length === 0
        ? `vault · aucun changement · ${data.branch}`
        : `${data.changes.length} fichier${data.changes.length > 1 ? "s" : ""} modifié${data.changes.length > 1 ? "s" : ""} · ${data.branch}`;

  return (
    <div className="flex items-center gap-1.5 px-1">
      <GitBranch size={11} className="text-[var(--text-muted)]" />
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {text}
      </span>
    </div>
  );
}

// ── Recent items list ─────────────────────────────────────────────────────────

function RecentList() {
  const router = useRouter();
  const { data, isError, isLoading } = trpc.entities.list.useQuery(
    { limit: 5, sortBy: "updatedAt", sortOrder: "desc" },
    { retry: false, staleTime: 120_000, gcTime: 10 * 60_000 },
  );

  if (isLoading) {
    // Skeleton de lignes récentes plutôt qu'un « Chargement… » texte : sur des
    // entités locales, le chargement doit se ressentir instantané (local-first).
    return (
      <div aria-hidden="true" className="flex flex-col">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1 px-3 py-2.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || !data) {
    if (FALLBACK_ITEMS.length === 0) {
      return (
        <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Aucun fichier récent
        </p>
      );
    }
    return (
      <>
        {FALLBACK_ITEMS.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={() => router.push(item.href)}
            className="flex h-auto w-full flex-col items-start rounded-[var(--radius-md)] px-3 py-2.5 text-left"
          >
            <span className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
              {item.label}
            </span>
            <span className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {item.time}
            </span>
          </Button>
        ))}
      </>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Aucun fichier récent
      </p>
    );
  }

  return (
    <>
      {data.items.map((entity) => (
        <Button
          key={entity.id}
          variant="ghost"
          size="sm"
          onClick={() => router.push(entityHref(entity))}
          className="flex h-auto w-full flex-col items-start rounded-[var(--radius-md)] px-3 py-2.5 text-left"
        >
          <span className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
            {entityLabel(entity)}
          </span>
          <span className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {relativeTime(entity.updatedAt)}
          </span>
        </Button>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const RightPanel = memo(function RightPanel() {
  const { setRightPanelVisible , aiMargins } = useShellChrome();
  const marginComments = aiMargins && aiMargins.comments.length > 0 ? aiMargins : null;
  const proposalActions = useFolderProposalActions();
  const hasProposals = proposalActions.proposals.length > 0;
  // Dire ce que fait l'IA plutôt que d'inviter à « ouvrir un fichier » alors
  // qu'un fichier est déjà ouvert.
  const aiMarginsHint = !aiMargins
    ? "Ouvre une note pour voir les suggestions de l'IA sur ce que tu écris."
    : aiMargins.status === "running"
      ? "Analyse en cours…"
      : aiMargins.status === "error"
        ? "Analyse interrompue — Ollama est-il joignable ?"
        : aiMargins.status === "nomodel"
          ? "Modèle Ollama introuvable (Réglages → IA)."
          : aiMargins.nothingToAnalyze
            ? "Trop court pour être commenté : quelques mots de plus et l'IA prend le relais."
            : "Rien à signaler sur cette note pour l'instant.";
  const isNext = useUiMode().mode === "next";

  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        width: "var(--panel-width)",
        borderColor: "var(--border-subtle)",
        // Registre next : le panneau vit DANS la feuille inset, même surface
        // que le contenu, seul un filet le sépare.
        backgroundColor: isNext ? "var(--surface-content)" : "var(--surface-chrome)",
      }}
    >
      {/* Panel header — pas de libellé « Contexte » : eyebrow redondant, le
          contenu (priorités, récents) se présente lui-même */}
      <div
        className="flex items-center justify-end px-4"
        style={{ height: "var(--header-height)" }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRightPanelVisible(false)}
          aria-label="Fermer le panneau"
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={13} />
        </Button>
      </div>

      <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Une note ouverte qui a des suggestions prend TOUT le panneau : c'est la
          surface la plus actionnable du moment, et des cartes coincées dans un
          tiers de la hauteur se lisent mal. Hors note, ou sans suggestion, le
          panneau reprend son contenu habituel — rien n'est perdu. */}
      {/* Le rangement en premier : il attend une décision, un commentaire de
          style peut patienter. */}
      {hasProposals && <FolderProposalsSection actions={proposalActions} />}

      {marginComments ? (
        <AiMarginsSection
          margins={marginComments}
          title={hasProposals ? "Sur cette note" : "Suggestions IA"}
        />
      ) : (
        <>
          <PrioritiesWidget />

          <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />

          {/* Recent */}
          <div className="flex flex-col gap-1 p-3">
            <div className="flex items-center gap-1.5 px-3 pb-2">
              <Clock size={12} className="text-[var(--text-muted)]" />
              <span className="sn-eyebrow sn-eyebrow--compact">Récent</span>
            </div>
            <RecentList />
          </div>

          <div className="border-b" style={{ borderColor: "var(--border-subtle)" }} />
        </>
      )}

      {/* AI / Suggestions — l'état quand il n'y a pas (encore) de carte. Muet
          quand un rangement est déjà proposé au-dessus : « ouvre une note pour
          voir les suggestions » sous une suggestion se contredit. */}
      {!marginComments && !hasProposals && (
        <div className="flex flex-col gap-1 p-3">
          <div className="flex items-center gap-1.5 px-3 pb-2">
            <Sparkle size={12} style={{ color: "var(--icon-decorative)" }} />
            <span className="sn-eyebrow sn-eyebrow--compact">Suggestions IA</span>
          </div>
          <p className="px-3 py-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {aiMarginsHint}
          </p>
        </div>
      )}

      {/* Spacer — inutile en mode suggestions, la liste prend déjà la hauteur. */}
      {!marginComments && <div className="flex-1" />}

      {/* Git status footer */}
      <div className="border-t p-3" style={{ borderColor: "var(--border-subtle)" }}>
        <GitStatusFooter />
      </div>
    </aside>
  );
});
