"use client";

/**
 * Pastille d'état du tri de l'inbox, et sa porte d'entrée mobile.
 *
 * Le tri renonçait par cinq `return` muets — IA éteinte, onglet caché, aucun
 * dossier, note ouverte… Du point de vue de l'utilisateur, tous racontaient la
 * même chose : « ça ne marche pas ». La pastille reprend le langage de
 * `AiStatusIndicator` (déclencheur compact + popover qui dit l'état ET le
 * geste à faire) plutôt que d'inventer une troisième mécanique d'affichage.
 *
 * Elle est visible en permanence : un affichage qui n'apparaît qu'en cas de
 * succès ne peut, par construction, jamais expliquer un échec.
 */

import { useCallback, useState } from "react";
import { CaretRight, FolderPlus, FolderSimple } from "@phosphor-icons/react";
import { Button, Input, Tooltip, useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { AI_MOBILE_NOTICE } from "./ai-runtime";
import { cleanUserFolderName } from "./inboxSort";
import {
  type InboxSortStatus,
  type ProposedFolder,
  type SortMove,
  getSortMoves,
  openInboxSortJournal,
  pendingSortMoves,
  refuseProposedFolder,
  requestInboxSortNow,
  setBusyProposalId,
  updateProposedFolders,
  updateSortMoves,
  useBusyProposalId,
  useInboxSortStatus,
  useProposedFolders,
  useSortMovesPendingCount,
} from "./inboxSortJournal";

const TOAST_DURATION_MS = 12_000;

export interface FolderProposalActions {
  proposals: readonly ProposedFolder[];
  /** Crée le dossier au nom donné et y range les notes de la proposition. */
  accept: (proposal: ProposedFolder, name: string) => Promise<void>;
  /** Écarte la proposition ; l'IA ne reproposera plus ce nom dans ce coffre. */
  refuse: (proposal: ProposedFolder) => void;
  /** Proposition en cours d'écriture, toutes surfaces confondues. */
  busyId: string | null;
}

/**
 * Les deux gestes d'une proposition, en UNE implémentation. Le panneau droit et
 * la modale du journal offrent la même décision : la dupliquer ferait diverger
 * deux chemins d'écriture sur le disque.
 *
 * C'est le seul endroit d'où un dossier peut naître.
 */
export function useFolderProposalActions(): FolderProposalActions {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const proposals = useProposedFolders();
  const busyId = useBusyProposalId();
  const addFolder = trpc.vault.folders.add.useMutation();
  const moveIfFree = trpc.entities.moveIfFree.useMutation();

  const accept = useCallback(
    async (proposal: ProposedFolder, rawName: string) => {
      const folder = cleanUserFolderName(rawName);
      if (!folder) {
        toast({
          title: "Nom de dossier invalide",
          description: "Il ne peut pas être vide, ni reprendre un dossier système.",
          variant: "warning",
        });
        return;
      }
      setBusyProposalId(proposal.id);
      const passId = `c${Date.now().toString(36)}`;
      const done: SortMove[] = [];
      try {
        await addFolder.mutateAsync({ path: folder });
      } catch (err) {
        console.error("[InboxAutoSort] création de dossier refusée", folder, err);
        toast({
          title: "Dossier non créé",
          description: `« ${folder} » n'a pas pu être créé.`,
          variant: "danger",
        });
        setBusyProposalId(null);
        return;
      }
      for (const n of proposal.notes) {
        try {
          const res = await moveIfFree.mutateAsync({ id: n.id, folder });
          if (!res.moved) continue;
          done.push({
            noteId: n.id,
            title: n.title,
            fromFilePath: n.filePath,
            fromFolder: n.fromFolder,
            toFilePath: res.filePath,
            folder,
            passId,
            at: Date.now(),
            undone: false,
            stale: false,
          });
        } catch (err) {
          console.error("[InboxAutoSort] déplacement refusé", n.filePath, err);
        }
      }
      updateProposedFolders((prev) => prev.filter((p) => p.id !== proposal.id));
      if (done.length > 0) updateSortMoves((prev) => [...done, ...prev]);
      void utils.entities.list.invalidate({ typeId: "note" });
      void utils.entities.listSummaries.invalidate();
      void utils.vault.folders.list.invalidate();
      setBusyProposalId(null);
      toast({
        title: `Dossier « ${folder} » créé`,
        description:
          done.length > 0
            ? `${done.length} note${done.length > 1 ? "s" : ""} rangée${done.length > 1 ? "s" : ""} dedans.`
            : "Aucune note n'a pu y être déplacée.",
        variant: done.length > 0 ? "success" : "warning",
        duration: TOAST_DURATION_MS,
        actions:
          done.length > 0
            ? [
                {
                  label: "Annuler",
                  onClick: () =>
                    window.dispatchEvent(
                      new CustomEvent(UNDO_PASS_EVENT, { detail: { passId } }),
                    ),
                },
              ]
            : undefined,
      });
    },
    [addFolder, moveIfFree, toast, utils],
  );

  const refuse = useCallback(
    (proposal: ProposedFolder) => {
      refuseProposedFolder(proposal.folder);
      updateProposedFolders((prev) => prev.filter((p) => p.id !== proposal.id));
      toast({
        title: `« ${proposal.folder} » écarté`,
        description:
          "L'IA ne le proposera plus dans ce coffre. Les notes restent dans la boîte de réception.",
      });
    },
    [toast],
  );

  return { proposals, accept, refuse, busyId };
}

/**
 * Demande l'annulation d'un lot de déplacements. `InboxAutoSort` tient le
 * journal et sait remettre chaque note à sa place ; le toast, lui, peut naître
 * dans le panneau droit, hors de sa portée.
 */
export const UNDO_PASS_EVENT = "supernote:undo-inbox-sort-pass";

/** Vrai si le lot est encore annulable — l'action du toast n'a sinon rien à faire. */
export function hasUndoablePass(passId: string): boolean {
  return pendingSortMoves(getSortMoves()).some((m) => m.passId === passId);
}

/**
 * Carte d'une proposition, rendue à l'identique dans le panneau droit et dans
 * la modale du journal. Le nom reste modifiable jusqu'au clic : c'est
 * l'utilisateur qui arrête le nom du dossier, pas le modèle.
 */
export function FolderProposalCard({
  proposal,
  actions,
}: {
  proposal: ProposedFolder;
  actions: FolderProposalActions;
}) {
  const [name, setName] = useState(proposal.folder);
  const busy = actions.busyId === proposal.id;
  const locked = actions.busyId !== null;
  const preview = proposal.notes.slice(0, 3).map((n) => n.title).join(", ");

  return (
    <div
      className="rounded-lg border p-2.5"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <FolderPlus size={13} weight="fill" style={{ color: "var(--accent)" }} />
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--accent)" }}
        >
          Nouveau dossier
        </span>
      </div>
      <Input
        value={name}
        aria-label="Nom du dossier à créer"
        onChange={(e) => setName(e.target.value)}
        disabled={locked}
        className="h-8 text-[13px]"
      />
      <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {proposal.notes.length} note{proposal.notes.length > 1 ? "s" : ""} de la boîte
        de réception — {preview}
        {proposal.notes.length > 3 ? `, +${proposal.notes.length - 3}` : ""}
      </p>
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          isDisabled={locked}
          onPress={() => actions.refuse(proposal)}
        >
          Ne pas créer
        </Button>
        <Button
          variant="primary"
          size="sm"
          isLoading={busy}
          isDisabled={locked}
          onPress={() => void actions.accept(proposal, name)}
        >
          Créer et ranger
        </Button>
      </div>
    </div>
  );
}

/** Ce que raconte l'état courant, en une phrase. */
export function inboxSortStatusLabel(status: InboxSortStatus): string {
  switch (status.phase) {
    case "unknown":
      return "Tri de la boîte de réception";
    case "disabled":
      return "Tri automatique désactivé";
    case "mobile":
      return AI_MOBILE_NOTICE;
    case "hidden":
      return "En pause : onglet en arrière-plan";
    case "no-worker":
      return "Coffre pas encore prêt";
    case "ai-offline":
      return "IA locale indisponible";
    case "waiting-idle":
      return "En attente d'une pause";
    case "cooldown":
      return "Prochaine passe dans quelques minutes";
    case "peer-busy":
      return "Un autre onglet écrit ou range";
    case "running":
      return "Tri en cours…";
    case "empty-inbox":
      return "Boîte de réception vide";
    // Sans nombre : le détail donne le compte, l'intitulé doit rester juste
    // qu'il y ait une note ouverte ou six.
    case "all-open":
      return "Ouvert dans l'éditeur — rien n'est déplacé";
    case "nothing-sortable":
      return "Rien d'assez consistant à classer";
    case "no-match":
      return "Aucun rangement à la dernière passe";
    case "awaiting-confirmation":
      return "Dossier proposé, à confirmer";
    case "sorted":
      return "Notes rangées";
  }
}

/** Couleur de la pastille : le rouge est réservé à ce qui bloque vraiment. */
function statusColor(status: InboxSortStatus, hasProposals: boolean): string {
  if (hasProposals) return "var(--accent)";
  switch (status.phase) {
    case "ai-offline":
      return "var(--warning)";
    case "disabled":
    case "no-match":
    case "nothing-sortable":
      return "var(--text-muted)";
    case "sorted":
      return "oklch(0.65 0.16 150)";
    default:
      return "var(--text-muted)";
  }
}

function relative(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.round(min / 60)} h`;
}

function moveLabel(count: number): string {
  return `${count} note${count > 1 ? "s" : ""} rangée${count > 1 ? "s" : ""} par l'IA`;
}

/** Pastille de la barre du haut, à côté des indicateurs git / cloud / IA. */
export function InboxSortJournalButton() {
  const status = useInboxSortStatus();
  const proposals = useProposedFolders();
  const moves = useSortMovesPendingCount();
  const [open, setOpen] = useState(false);

  // Une proposition en attente prime sur l'état d'attente courant : c'est la
  // seule chose que l'utilisateur peut débloquer d'un clic.
  const label =
    proposals.length > 0 && status.phase !== "running"
      ? proposals.length === 1
        ? `Dossier proposé : ${proposals[0]!.folder}`
        : `${proposals.length} dossiers proposés`
      : inboxSortStatusLabel(status);
  const hint =
    proposals.length > 0 && status.phase !== "running"
      ? "Ouvre le journal pour créer le dossier et y ranger les notes."
      : status.detail;
  const color = statusColor(status, proposals.length > 0);
  const running = status.phase === "running";

  return (
    <div className="relative">
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Tri de la boîte de réception : ${label}`}
          className="relative flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]"
        >
          <FolderSimple
            size={14}
            weight={proposals.length > 0 || moves > 0 ? "fill" : "regular"}
            className={running ? "animate-pulse" : undefined}
            style={{ color }}
          />
          {proposals.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
          )}
        </Button>
      </Tooltip>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-10 z-50 w-72 rounded-xl border p-3 shadow-xl"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border-subtle)",
              boxShadow:
                "0 12px 24px -8px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: color,
                }}
              />
              <span
                className="text-[13px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {label}
              </span>
            </div>

            {hint && (
              <p
                className="mb-2 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed"
                style={{
                  backgroundColor: "var(--surface-2)",
                  color: "var(--text-secondary)",
                }}
              >
                {hint}
              </p>
            )}

            {status.lastPassAt > 0 && status.lastSummary && (
              <p className="mb-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Dernière passe {relative(status.lastPassAt)} — {status.lastSummary}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                isDisabled={running}
                onClick={() => requestInboxSortNow()}
                className="flex-1 text-[13px] font-medium"
              >
                {running ? "Tri…" : "Trier maintenant"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  openInboxSortJournal();
                }}
                className="flex-1 text-[13px] font-medium"
              >
                {proposals.length > 0 ? "Confirmer…" : "Journal"}
              </Button>
            </div>

            {moves > 0 && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {moveLabel(moves)} — annulables depuis le journal.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Ligne du tiroir « Plus » — pendant mobile de la pastille ci-dessus. */
export function InboxSortJournalRow({ onClose }: { onClose?: () => void }) {
  const status = useInboxSortStatus();
  const proposals = useProposedFolders();
  const moves = useSortMovesPendingCount();

  const headline =
    proposals.length > 0
      ? `${proposals.length} dossier${proposals.length > 1 ? "s" : ""} proposé${proposals.length > 1 ? "s" : ""}`
      : moves > 0
        ? moveLabel(moves)
        : "Tri de la boîte de réception";

  return (
    <div className="mb-6">
      <div
        className="overflow-hidden rounded-2xl border"
        style={{
          backgroundColor: "var(--surface-content)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <Button
          variant="ghost"
          onPress={() => {
            onClose?.();
            openInboxSortJournal();
          }}
          className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left"
          style={{ color: "var(--text-primary)" }}
        >
          <FolderSimple
            size={18}
            weight={proposals.length > 0 || moves > 0 ? "fill" : "regular"}
            style={{ color: statusColor(status, proposals.length > 0) }}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-medium">{headline}</span>
            <span
              className="truncate text-[12px] font-normal"
              style={{ color: "var(--text-muted)" }}
            >
              {inboxSortStatusLabel(status)}
            </span>
          </span>
          <CaretRight size={14} style={{ color: "var(--text-muted)" }} />
        </Button>
      </div>
    </div>
  );
}
