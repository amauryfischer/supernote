import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { COLLAB_FRAGMENT, type EditorCollaboration } from "@supernote/editor";
import { collabUrl } from "@/lib/share/collab";

export interface Peer { name: string; color: string }
export interface NoteCollab {
  status: "off" | "connecting" | "offline" | "ready";
  collaboration?: EditorCollaboration;
  peers: Peer[];
}

const OFFLINE_GRACE_MS = 3000;

export function collabDbName(shareId: string): string {
  return `supernote-collab-${shareId}`;
}

export function useNoteCollab(
  share: { id: string; key: string } | null,
  user: Peer,
  onGone: () => void,
): NoteCollab {
  const [state, setState] = useState<NoteCollab>({ status: "off", peers: [] });
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!share) {
      setState({ status: "off", peers: [] });
      return undefined;
    }
    setState({ status: "connecting", peers: [] });
    let alive = true;
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(collabDbName(share.id), doc);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: share.id,
      document: doc,
      token: `owner:${share.key}`,
      // Seul `gone` efface la clé : une panne (`unavailable`) ou un refus transitoire laisse éditer la copie locale.
      onAuthenticationFailed: ({ reason }) => {
        if (reason === "gone") onGoneRef.current();
      },
    });
    const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
    let ready = false;
    const markReady = () => {
      if (ready || !alive) return;
      ready = true;
      setState((s) => ({
        ...s,
        status: "ready",
        collaboration: { fragment, provider: { awareness: provider.awareness ?? undefined }, user: userRef.current },
      }));
    };
    provider.on("synced", markReady);
    // Hors ligne : on édite la copie locale, fusionnée (CRDT) à la reconnexion.
    const timer = window.setTimeout(() => {
      void local.whenSynced.then(() => {
        if (fragment.length > 0) markReady();
        else if (!ready && alive) setState((s) => ({ ...s, status: "offline" }));
      });
    }, OFFLINE_GRACE_MS);

    const awareness = provider.awareness;
    let lastPeers = "";
    const onAwareness = () => {
      if (!awareness) return;
      const peers: Peer[] = [];
      awareness.getStates().forEach((s, clientId) => {
        const u = (s as { user?: Peer }).user;
        // L'awareness d'un invité n'est pas fiable : une couleur hors hex irait telle quelle dans `style`.
        if (clientId !== awareness.clientID && typeof u?.name === "string" && u.name) {
          peers.push({ name: u.name.slice(0, 40), color: /^#[0-9a-f]{3,8}$/i.test(u.color) ? u.color : "#888" });
        }
      });
      // `change` part à chaque déplacement de curseur : ne re-rendre la note que si la liste bouge.
      const key = JSON.stringify(peers);
      if (key === lastPeers) return;
      lastPeers = key;
      setState((st) => ({ ...st, peers }));
    };
    awareness?.on("change", onAwareness);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      awareness?.off("change", onAwareness);
      provider.destroy();
      void local.destroy();
      doc.destroy();
    };
  }, [share?.id, share?.key]);

  return state;
}
