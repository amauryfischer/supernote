"use client";

/**
 * useCreateMount — crée l'entité `vault_mount` qui déclare un salon monté dans
 * le coffre père.
 *
 * Un montage est matérialisé par une entité système (`typeId: "vault_mount"`,
 * champs `serverUrl` / `vaultKey` / `token` / `label`) écrite dans le coffre
 * père. Le {@link MountSyncProvider} la découvre seul : la mutation émet un
 * `ENTITY_CHANGE` qui déclenche son `refresh()`, puis la synchro du salon
 * démarre. Ce hook se contente donc de créer l'entité.
 *
 * On sonde le serveur AVANT de créer l'entité (comme le boot du coffre cloud,
 * cf. PwaVaultSetup) : `/api/sync/info` est non authentifié et indique si une
 * base est configurée. Échec → erreur claire et immédiate plutôt qu'un montage
 * orphelin qui ne synchronise jamais.
 */

import { useCallback } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { normalizeServerUrl, normalizeVaultKey } from "../room-id";

export interface CreateMountArgs {
  serverUrl: string;
  vaultKey: string;
  token: string;
  label: string;
}

export function useCreateMount() {
  const createMount = useCallback(async (args: CreateMountArgs) => {
    const serverUrl = normalizeServerUrl(args.serverUrl);
    // Case-folded : un clavier mobile qui auto-capitalise ne doit pas forker la
    // paire en deux salons distincts (cf. normalizeVaultKey).
    const vaultKey = normalizeVaultKey(args.vaultKey);
    if (!vaultKey) throw new Error("Une clé de salon est requise.");
    // serverUrl vide = même origine que l'app (cf. modèle de données : "" =
    // même origine). La sonde ci-dessous tape alors `/api/sync/info` en
    // relatif, soit le serveur de l'app lui-même.

    // Sonde le serveur avant de créer le montage (erreur immédiate et lisible).
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/api/sync/info`);
    } catch {
      throw new Error("Serveur injoignable.");
    }
    if (!res.ok) throw new Error(`Serveur injoignable (HTTP ${res.status}).`);
    const info = (await res.json()) as { enabled?: boolean };
    if (!info.enabled) {
      throw new Error(
        "Le serveur n'a pas de base de données configurée — la synchronisation en ligne y est indisponible.",
      );
    }

    // Le worker dérive seul le chemin du fichier depuis le `defaultPath` du type
    // `vault_mount` (« VaultMounts ») : on n'a qu'à fournir typeId + fields.
    await trpcVanillaClient.entities.create.mutate({
      typeId: "vault_mount",
      fields: {
        serverUrl,
        vaultKey,
        token: args.token.trim(),
        label: args.label.trim() || vaultKey,
      },
    });
  }, []);

  return { createMount };
}
