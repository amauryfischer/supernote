"use client";

/**
 * MountSyncProvider — câble le {@link MountSyncManager} au runtime du coffre.
 *
 * Vit À L'INTÉRIEUR de {@link OnlineSyncProvider} (cf. RootLayout) pour partager
 * le contexte vault et démarrer APRÈS que la synchro du père soit en place. Une
 * fois le coffre « ready », il :
 *
 *   - liste les entités `vault_mount` du père (montages directs déclarés par
 *     l'utilisateur) via `entities.list`,
 *   - pour chaque salon résolu, ouvre un {@link OnlineSyncClient} dédié qui
 *     réplique l'op-log du salon monté dans le coffre père (préfixe `@mounts/`
 *     posé côté worker), en appliquant les ops via `sync.applyOps` avec la
 *     provenance `sourceVaultId`,
 *   - écoute les `ENTITY_CHANGE` du worker : une mutation locale d'une entité
 *     montée (sourceVaultId non nul) est routée vers le client de sa provenance ;
 *     une mutation d'une entité `vault_mount` native (sourceVaultId nul) force
 *     un `refresh()` (un montage ajouté/retiré reconcilie les clients).
 *
 * Les coffres sans montage ne paient rien : le manager se résout en zéro client.
 */

import { useEffect, useRef } from "react";
import type { EntityOp } from "@supernote/sync";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { onWorkerMessage } from "@/lib/trpc/browser-link";
import { trpcVanillaClient, isCloudVaultActive } from "@/lib/trpc/client";
import { loadOnlineSyncConfig, getOrCreateClientId } from "../config-storage";
import { cloudVaultId } from "../room-id";
import { OnlineSyncClient } from "../client";
import { loadMountCursor, saveMountCursor, clearMountCursor } from "./mount-cursors";
import { loadPendingOps, savePendingOps } from "../pendingStore";
import { MountSyncManager, type MountClient } from "./MountSyncManager";
import type { MountNode } from "./resolve-mounts";

/**
 * Lit les montages directs du père : les entités `vault_mount` natives (NON
 * montées elles-mêmes). `entities.list` renvoie `{ items, total }` ; chaque item
 * porte ses champs à plat sous `.fields`.
 */
async function listMountEntities(): Promise<MountNode[]> {
  try {
    const res = await trpcVanillaClient.entities.list.query({
      typeId: "vault_mount",
      limit: 200,
    });
    return res.items
      .map((e): MountNode => {
        const f = e.fields;
        return {
          serverUrl: String(f["serverUrl"] ?? ""),
          vaultKey: String(f["vaultKey"] ?? ""),
          token: String(f["token"] ?? ""),
          label: String(f["label"] ?? f["vaultKey"] ?? ""),
        };
      })
      .filter((m) => m.vaultKey);
  } catch {
    return [];
  }
}

export function MountSyncProvider({ children }: { children: React.ReactNode }) {
  const vault = useVault();
  const managerRef = useRef<MountSyncManager | null>(null);

  useEffect(() => {
    // Tear down any previous manager (vault switch / unready) first.
    managerRef.current?.stop();
    managerRef.current = null;
    if (vault?.state !== "ready") return;

    const parentVaultId = vault.activeVaultId ?? "local";
    // Si le père est lui-même un salon cloud, ne jamais le re-monter (skip-self
    // dans resolveMounts). Sinon (coffre dossier/git), pas de salon « soi ».
    const selfId = isCloudVaultActive()
      ? (() => {
          const c = loadOnlineSyncConfig();
          return cloudVaultId(c.serverUrl, c.vaultKey);
        })()
      : null;
    const clientId = getOrCreateClientId();

    const makeClient = (cloudId: string, node: MountNode): MountClient => {
      const cur = loadMountCursor(parentVaultId, cloudId);
      return new OnlineSyncClient({
        serverUrl: node.serverUrl,
        vaultKey: node.vaultKey,
        token: node.token,
        clientId,
        initialSeq: cur.lastSeq,
        // Un montage ne sème JAMAIS : ses entités appartiennent au salon monté,
        // jamais au coffre père. On ne pousse que les éditions locales d'entités
        // déjà montées (routées par onEntityChange), pas un snapshot du père.
        seeded: true,
        epoch: cur.epoch,
        applyOps: async (ops: EntityOp[]) => {
          await trpcVanillaClient.sync.applyOps.mutate({ ops, sourceVaultId: cloudId });
          // Réveille TanStack Query pour refléter immédiatement les changements
          // des pairs montés (même hook que la synchro du père).
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("supernote:index-progress", {
                detail: { indexed: ops.length, total: ops.length },
              }),
            );
          }
        },
        // Un montage ne sème pas → getSnapshot ne doit jamais être appelé
        // (seeded:true court-circuite le seed dans OnlineSyncClient.openStream).
        getSnapshot: async () => {
          throw new Error("un montage ne sème jamais");
        },
        onSeq: (seq) =>
          saveMountCursor(parentVaultId, cloudId, {
            ...loadMountCursor(parentVaultId, cloudId),
            lastSeq: seq,
          }),
        onSeeded: () => {},
        // Epoch serveur changé (op-log purgé) : le curseur du montage est
        // obsolète, on le remet à zéro avec la nouvelle epoch.
        onEpochChange: (epoch) => saveMountCursor(parentVaultId, cloudId, { lastSeq: 0, epoch }),
        pending: {
          load: () => loadPendingOps(`mount.${cloudId}`),
          save: (ops) => savePendingOps(`mount.${cloudId}`, ops),
        },
        onStatus: () => {},
      });
    };

    const manager = new MountSyncManager({
      parentVaultId,
      selfId,
      getDirectMounts: listMountEntities,
      // V1 : pas de résolution transitive proactive (un salon monté ne déclare
      // pas ses propres montages côté serveur). Les montages d'un salon monté
      // arrivent comme des entités `vault_mount` via applyOps → ENTITY_CHANGE →
      // refresh() les reprend au prochain tour. Voir la note de tâche.
      getMountsIn: async () => [],
      applyOps: async (ops, src) =>
        void (await trpcVanillaClient.sync.applyOps.mutate({ ops, sourceVaultId: src })),
      purgeMounted: async (src) => {
        await trpcVanillaClient.sync.purgeMounted.mutate({ sourceVaultId: src });
        clearMountCursor(parentVaultId, src);
      },
      makeClient,
    });
    managerRef.current = manager;
    void manager.start();

    // Route les mutations locales du worker vers le bon client de montage, et
    // re-résout les montages quand une entité `vault_mount` native change.
    const unsub = onWorkerMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: string; sourceVaultId?: string | null; op?: EntityOp };
      if (m.type !== "ENTITY_CHANGE" || !m.op) return;
      // Une entité `vault_mount` NATIVE (provenance nulle) ajoutée/modifiée/
      // supprimée → reconcilier les clients (ajout/retrait de montage).
      if (m.op.payload?.typeId === "vault_mount" && m.sourceVaultId == null) {
        void manager.refresh();
        return;
      }
      manager.onEntityChange({ sourceVaultId: m.sourceVaultId ?? null, op: m.op });
    });

    return () => {
      unsub();
      manager.stop();
      managerRef.current = null;
    };
    // Re-câblage sur l'identité du coffre actif uniquement.
  }, [vault?.state, vault?.activeVaultId]);

  return <>{children}</>;
}
