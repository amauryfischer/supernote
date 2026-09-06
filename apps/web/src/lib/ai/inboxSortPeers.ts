/**
 * Coordination inter-onglets du tri de l'inbox.
 *
 * La garde « pas de frappe, aucune note d'inbox ouverte » est locale à un
 * onglet, et rien dans `browser-link` / `worker.ts` n'élit de leader : deux
 * fenêtres visibles sur le même coffre et l'onglet A range pendant que
 * l'utilisateur écrit dans l'onglet B. Avant chaque passe, on interroge donc
 * les autres onglets et on renonce si l'un d'eux est occupé.
 *
 * Dégradation : sans `BroadcastChannel`, il n'y a pas de pairs — le
 * comportement retombe exactement sur celui d'un onglet unique.
 */

const CHANNEL_NAME = "supernote:inbox-sort";
/** Délai d'écoute des réponses : au-delà, on considère l'onglet absent. */
const PROBE_WINDOW_MS = 400;

export interface PeerState {
  /** Horodatage de la dernière frappe dans cet onglet. */
  lastInputAt: number;
  /** Ids de notes ouvertes dans un éditeur de cet onglet. */
  openNoteIds: string[];
  /** Une passe y tourne déjà. */
  busy: boolean;
}

type Message =
  | { kind: "probe"; nonce: string }
  | ({ kind: "state"; nonce: string } & PeerState);

function isMessage(v: unknown): v is Message {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (o["kind"] === "probe" || o["kind"] === "state") &&
    typeof o["nonce"] === "string"
  );
}

export interface InboxSortPeers {
  /** États renvoyés par les autres onglets, ou [] s'il n'y en a pas. */
  probe: () => Promise<PeerState[]>;
  close: () => void;
}

/**
 * Ouvre le canal et répond aux sondes des autres onglets avec l'état lu à
 * l'instant via `readLocalState`.
 */
export function openInboxSortPeers(
  readLocalState: () => PeerState,
): InboxSortPeers {
  if (typeof BroadcastChannel === "undefined") {
    return { probe: async () => [], close: () => {} };
  }

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return { probe: async () => [], close: () => {} };
  }

  const waiting = new Map<string, PeerState[]>();

  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    const msg = event.data;
    if (!isMessage(msg)) return;
    if (msg.kind === "probe") {
      const local = readLocalState();
      const reply: Message = { kind: "state", nonce: msg.nonce, ...local };
      channel.postMessage(reply);
      return;
    }
    const bucket = waiting.get(msg.nonce);
    if (bucket) {
      bucket.push({
        lastInputAt: msg.lastInputAt,
        openNoteIds: msg.openNoteIds,
        busy: msg.busy,
      });
    }
  });

  return {
    probe: async () => {
      const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const bucket: PeerState[] = [];
      waiting.set(nonce, bucket);
      try {
        channel.postMessage({ kind: "probe", nonce } satisfies Message);
      } catch {
        waiting.delete(nonce);
        return [];
      }
      await new Promise((r) => setTimeout(r, PROBE_WINDOW_MS));
      waiting.delete(nonce);
      return bucket;
    },
    close: () => {
      try {
        channel.close();
      } catch {
        /* canal déjà fermé */
      }
    },
  };
}
