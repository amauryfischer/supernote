import { cloudVaultId } from "../room-id";

export interface MountNode {
  serverUrl: string;
  vaultKey: string;
  token: string;
  label: string;
}

export interface ResolvedMount extends MountNode {
  cloudId: string;
}

export interface ResolveOptions {
  /** Renvoie les montages déclarés DANS un salon donné (pour la récursion). */
  fetch: (cloudId: string) => Promise<MountNode[]>;
  /** Salon du père (si le père est lui-même cloud) — jamais re-monté. */
  selfId: string | null;
  maxDepth?: number;
  maxMounts?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_MOUNTS = 16;

/**
 * Résout l'ensemble transitif des salons à monter à partir des montages
 * directs du père. Gardes : visited (boucles + diamants), profondeur,
 * skip-self, budget de montages.
 */
export async function resolveMounts(
  direct: MountNode[],
  opts: ResolveOptions,
): Promise<ResolvedMount[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxMounts = opts.maxMounts ?? DEFAULT_MAX_MOUNTS;
  const visited = new Set<string>();
  if (opts.selfId) visited.add(opts.selfId);
  const out: ResolvedMount[] = [];

  type Frame = { node: MountNode; depth: number };
  const queue: Frame[] = direct.map((node) => ({ node, depth: 1 }));

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const cloudId = cloudVaultId(node.serverUrl, node.vaultKey);
    if (visited.has(cloudId)) continue;
    visited.add(cloudId);
    if (out.length >= maxMounts) {
      console.warn(`[mounts] budget de ${maxMounts} montages atteint — ${cloudId} ignoré`);
      continue;
    }
    out.push({ ...node, cloudId });
    if (depth >= maxDepth) continue;
    let children: MountNode[] = [];
    try {
      children = await opts.fetch(cloudId);
    } catch (err) {
      console.warn(`[mounts] résolution récursive échouée pour ${cloudId}`, err);
    }
    for (const child of children) queue.push({ node: child, depth: depth + 1 });
  }
  return out;
}
